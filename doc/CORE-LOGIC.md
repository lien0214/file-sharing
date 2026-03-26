# CORE-LOGIC.md

---

## 1. Chunked Upload with Checksum Verification

### Step-by-step Flow

```
Browser                     NestJS (backend)              MinIO
   |                               |                          |
   | 1. Stream SHA-256 over file   |                          |
   |    (16 MB slices, @noble/hashes)                         |
   |                               |                          |
   | 2. POST /files/upload/init ──►|                          |
   |    { fileName, size,          |  CreateMultipartUpload ──►|
   |      mimeType, checksum }     |◄── s3UploadId ───────────|
   |                               |  Save File (PENDING)     |
   |                               |  Save UploadSession      |
   |◄── { fileId, totalParts,  ───|                          |
   |      presignedUrl (part 1) }  |                          |
   |                               |                          |
   | 3. For each 16 MB chunk:      |                          |
   |    PUT presignedUrl ─────────────────────────────────────►|
   |    (direct browser → MinIO, backend not involved)        |
   |◄── ETag (per-part hash) ────────────────────────────────|
   |                               |                          |
   |    GET /files/:id/presign/N ─►|  (for parts 2..N)        |
   |◄── presignedUrl for part N ───|                          |
   |    PUT presignedUrl ─────────────────────────────────────►|
   |◄── ETag ────────────────────────────────────────────────|
   |                               |                          |
   | 4. POST /files/:id/complete ─►|                          |
   |    { parts: [                 |  CompleteMultipartUpload ►|
   |        { partNumber, etag }   |  (MinIO assembles parts) |
   |      ] }                      |◄── assembled object ─────|
   |                               |  HeadObject → checksum   |
   |                               |  compare stored vs MinIO |
   |                               |  mismatch → abort + 422  |
   |                               |  match → status = READY  |
   |                               |  delete UploadSession    |
   |◄── { slug, url } ────────────|                          |
```

Progress reported to the UI: **0–10%** = hashing, **10–100%** = uploading parts.

### Why the browser PUTs directly to MinIO

The backend generates a **presigned URL** — a time-limited signed URL that authorises one specific PUT. The browser calls MinIO directly with this URL. The backend never handles the raw bytes, which means:

- No memory pressure on the backend
- No bandwidth cost on the backend (MinIO handles raw I/O)
- Presigned URLs expire after 1 hour

### Frontend: Streaming SHA-256 (`@noble/hashes`)

```typescript
// frontend/src/lib/upload.ts
async function computeChecksum(file: File, onProgress?) {
  const hash = sha256.create();
  let offset = 0;
  while (offset < file.size) {
    const buffer = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
    hash.update(new Uint8Array(buffer));
    offset += CHUNK_SIZE;
    onProgress?.(Math.min(offset / file.size, 1) * 0.1); // first 10%
  }
  return bytesToHex(hash.digest());
}
```

`@noble/hashes` is used instead of `SubtleCrypto` because `SubtleCrypto.digest()` requires the entire file buffer in memory. The sliced approach keeps peak memory at ~16 MB regardless of file size.

### Backend: ETag collection and why it matters

MinIO stores each part independently until `CompleteMultipartUpload` is called. At that point MinIO needs the `(partNumber, ETag)` list to verify it received every part in order before assembling the final object. The frontend collects each ETag from the PUT response header and sends them all in the `complete` call.

### Whole-file checksum verification

After assembly, the backend calls `HeadObject` on the completed object to read the checksum MinIO computed. This is compared against the SHA-256 the client declared at `init`. A mismatch means the file was corrupted in transit:

```
stored checksum (from init) ≠ MinIO checksum (after complete)
  → abortMultipartUpload
  → File.status = DELETED
  → 422 Unprocessable Entity
```

### Two S3 endpoints

The backend maintains two MinIO connections:

| Connection | Env var | Used for |
|---|---|---|
| Internal | `MINIO_ENDPOINT` | Backend-to-MinIO API calls (create, complete, head, delete) — uses Docker service name, e.g. `http://minio:9000` |
| Public | `MINIO_PUBLIC_ENDPOINT` | Signing presigned URLs that the **browser** will call — must be a hostname the browser can reach, e.g. `http://localhost:9000` |

If presigned URLs were signed with the internal hostname, the browser could not reach MinIO.

---

## 2. Lazy Expiry (No Cron Job)

Expiry is enforced **at read time** rather than by a background scheduler.

```
GET /files/:slug
  └─ fetch File from DB
      └─ if expiresAt && expiresAt < NOW():
          ├─ deleteObject(s3Key) from MinIO
          ├─ File.status = DELETED
          ├─ if owner: User.usedStorage -= File.size
          └─ return HTTP 410 Gone
```

**Trade-offs:**
- Pro: zero infrastructure overhead, no UTC/timezone config needed.
- Con: expired files linger in MinIO until someone accesses the slug. Acceptable for MVP; a cleanup cron (UTC 00:00) can be added post-MVP.

---

## 3. Password-Protected Files

```
Creator:
  POST /files/upload/init { password: "secret" }
    └─ NestJS: argon2.hash("secret") → stored in File.passwordHash

Recipient:
  GET /files/:slug → { isPasswordProtected: true }
  POST /files/:slug/access { password: "secret" }
    └─ NestJS: argon2.verify(File.passwordHash, "secret")
       ├─ fail → 403 (no info about file existence)
       └─ pass → return short-lived accessToken (signed JWT, exp: 5min)
  GET /files/:slug/download?accessToken=<accessToken>
    └─ NestJS: verify accessToken → issue presigned MinIO GET URL (Content-Disposition: attachment) → 302
```

---

## 4. Anonymous Upload Constraint

Anonymous uploads (no JWT) **must** include `expiresAt`. Permanent storage is a privilege for authenticated users only.

```
POST /files/upload/init (no token)
  └─ if expiresAt missing → 400 Bad Request
```

The frontend enforces this in the UI: the "Permanent quota" storage option is hidden for guests, who are forced to pick a TTL. The backend enforces it independently as a safety net.

---

## 5. Quota Enforcement

Checked in `POST /files/upload/init` for authenticated users only:

```typescript
if (user.usedStorage + dto.size > user.storageLimit) {
  throw new ForbiddenException('Storage quota exceeded');
}
```

`usedStorage` is updated **after** successful `complete-upload`, not at init, to avoid counting failed/abandoned uploads.

---

## 6. Slug Generation

```typescript
import { nanoid } from 'nanoid';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const slug = nanoid.customAlphabet(ALPHABET, 12)();
```

Retry on the rare DB unique constraint violation (expected frequency: negligible at MVP scale).

---

## 7. `UploadSession` Lifecycle

`UploadSession` is a **temporary row** — it only exists while an upload is in progress. The table is normally nearly empty.

| Event | DB | MinIO |
|---|---|---|
| `init-upload` | Create `File (PENDING)` + `UploadSession` | `CreateMultipartUpload` → `s3UploadId` |
| `complete-upload` success | Delete `UploadSession`, `File → READY`, increment `usedStorage` | `CompleteMultipartUpload` |
| `complete-upload` checksum mismatch | Delete `UploadSession`, `File → DELETED` | `AbortMultipartUpload` |
| File deleted mid-upload | `File → DELETED`; `UploadSession` cascade-deleted via Prisma `onDelete: Cascade` | `AbortMultipartUpload` |
| Abandoned uploads (future) | Cron: find `File.status = PENDING AND createdAt < 24h ago`, abort + clean | `AbortMultipartUpload` |

The `onDelete: Cascade` on `UploadSession.fileId` means deleting the `File` row automatically deletes the session — no manual cleanup needed.

## 8. File Expiry

Expiry is enforced through three complementary layers: lazy cleanup on access,
a background sweep for files that are never accessed again, and a reconciliation
job that retries S3 deletions that previously failed.

### State model

A `File` row uses two fields to represent its cleanup state:

| `status`  | `s3Key`    | Meaning                                      |
|-----------|------------|----------------------------------------------|
| `READY`   | non-null   | Live file, accessible by slug                |
| `READY`   | non-null   | Expired but not yet cleaned up (expiresAt < now) |
| `DELETED` | `null`     | Fully cleaned: DB soft-deleted, S3 object gone |
| `DELETED` | non-null   | Orphan: DB soft-deleted but S3 deletion failed — pending reconciliation |

---

### Layer 1 — Lazy expiry (on access)

Triggered by `GET /files/:slug` (metadata) or `GET /files/:slug/download`.

```
Client request
    │
    ▼
findUnique(slug)
    │
    ├─ not found or status ≠ READY → 404 Not Found
    │
    ├─ expiresAt < NOW()
    │       │
    │       ▼
    │   expireFile()           ← see cleanup flow below
    │       │
    │       └──→ 410 Gone
    │
    └─ valid → return metadata / presigned download URL
```

**Why lazy?** No background job is needed for files that are still being accessed;
the cleanup happens inline and the caller gets a clean 410 immediately.

---

### Layer 2 — Hourly sweep (`sweepExpiredFiles`)

Runs every hour via `@Cron`. Catches files that expired but were never accessed
again (so lazy expiry never fired).

```
Every hour
    │
    ▼
findMany({ status: READY, expiresAt < NOW() }, take: 500)
    │
    └─ for each file → expireFile()
```

Processes up to 500 per run to bound memory. If more than 500 are expired,
subsequent runs will catch the remainder.

---

### Layer 3 — Daily reconciliation (`reconcileOrphanedObjects`)

Runs at 3 AM via `@Cron`. Retries S3 deletion for rows where `expireFile` (or
`deleteFile`) ran but the S3 `deleteObject` call failed, leaving `s3Key` set on
a `DELETED` row.

```
Every day at 3 AM
    │
    ▼
findMany({ status: DELETED, s3Key: { not: null } }, take: 1000)
    │
    └─ for each orphan
            │
            ├─ deleteObject(s3Key)  ← idempotent; safe even if object is already gone
            │       │
            │       ├─ success → file.update({ s3Key: null })
            │       │
            │       └─ failure → log warning, continue (retry next day)
```

`DeleteObject` is idempotent per the S3 spec — it returns success even if the
object no longer exists, so there is no risk of double-error.

---

### `expireFile` — shared cleanup helper

Used by both lazy expiry and the hourly sweep.

```
expireFile(file)
    │
    ├─ file.s3Key === null → skip S3 call (already clean)
    │
    ├─ deleteObject(s3Key)
    │       ├─ success → s3Deleted = true
    │       └─ failure → log warning, s3Deleted = false
    │                     (s3Key stays set → reconciliation will retry)
    │
    └─ $transaction (atomic)
            │
            ├─ updateMany({ id, status: READY } → { status: DELETED, s3Key: null? })
            │       ├─ count = 1 → row was READY, we own this cleanup
            │       │       └─ if ownerId → decrement usedStorage
            │       └─ count = 0 → another concurrent call already cleaned it
            │                       skip quota decrement (idempotency guard)
            │
            └─ s3Key set to null only when s3Deleted = true
```

The `updateMany` with `where: { status: READY }` acts as a compare-and-swap:
only one concurrent caller will see `count = 1` and decrement the quota.
This prevents double-decrement under concurrent access.

---

### `listByOwner` — expired file filtering

`GET /files` for authenticated users filters out expired files at the DB query
level so they do not appear in the list even if not yet cleaned up:

```sql
WHERE status IN ('READY', 'PENDING')
  AND (expiresAt IS NULL OR expiresAt > NOW())
```

---

### `deleteFile` — user-initiated deletion

Owner-triggered deletes follow the same S3-then-DB pattern:

```
deleteObject(s3Key)   ← throws on failure (caller gets 5xx, file stays READY)
    │
    ▼
$transaction
    ├─ file.update({ status: DELETED, s3Key: null })
    └─ if status was READY → decrement usedStorage
```

Unlike expiry, a failed `deleteObject` here is not swallowed — the transaction
is never reached, so the file stays `READY` and the user can retry.

---

### Schedule summary

| Job                        | Trigger          | Scope                            |
|----------------------------|------------------|----------------------------------|
| Lazy expiry                | On access        | Single file, inline              |
| `sweepExpiredFiles`        | Every hour       | Up to 500 expired READY files    |
| `reconcileOrphanedObjects` | Daily at 3 AM    | Up to 1000 DELETED orphaned keys |

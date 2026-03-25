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

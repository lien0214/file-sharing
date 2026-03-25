# CORE-LOGIC.md

---

## 1. Chunked Upload with Checksum Verification

### Step-by-step Flow

```
Frontend                          NestJS                        MinIO
   |                                 |                             |
   |-- SHA-256 (SubtleCrypto) -----> |                             |
   |   (stream file in 16MB slices) |                             |
   |                                 |                             |
   |-- POST /files/upload/init ----> |                             |
   |   { fileName, size, checksum } |                             |
   |                                 |-- CreateMultipartUpload --> |
   |                                 |<-- s3UploadId ------------- |
   |                                 |                             |
   |                                 | (save File + UploadSession) |
   |<-- { fileId, presignedUrl[1] } -|                             |
   |                                 |                             |
   | [For each 16MB chunk, 1..N]     |                             |
   |-- PUT presignedUrl (chunk) ----------------------------> MinIO|
   |   x-amz-checksum-sha256 per chunk (MinIO validates)          |
   |<-- ETag ------------------------------------------------ MinIO|
   |                                 |                             |
   |-- POST /upload/:id/complete --> |                             |
   |   { parts: [{partNumber, etag}]}|                             |
   |                                 |-- CompleteMultipartUpload-> |
   |                                 |<-- full object checksum ---- |
   |                                 |                             |
   |                                 | compare stored vs MinIO SHA |
   |                                 | if mismatch: abort + 422    |
   |                                 | if match: status = READY    |
   |<-- { slug, url } -------------- |                             |
```

### Frontend Checksum (Streaming SHA-256)

```typescript
async function computeSHA256(file: File): Promise<string> {
  // IMPORTANT: Do NOT load the whole file into memory.
  // Stream through 16MB slices to avoid OOM on large files.
  const CHUNK = 16 * 1024 * 1024; // 16MB
  // SubtleCrypto does not support streaming natively.
  // Use a WASM SHA-256 library (e.g. @noble/hashes) for true streaming.
  // Fallback: slice → arrayBuffer → update hash object sequentially.
}
```

Use `@noble/hashes` (pure-JS, tree-shakeable) for streaming SHA-256 rather than `SubtleCrypto`, which requires the full buffer in memory.

### Per-chunk integrity
Include `x-amz-checksum-sha256` header on each PUT to MinIO. MinIO validates the chunk hash immediately and rejects corrupted transit data before the chunk is stored.

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

| Event | Action |
|---|---|
| `init-upload` | Create `UploadSession` with `s3UploadId` + `totalParts` |
| `complete-upload` success | Delete `UploadSession` |
| `complete-upload` checksum fail | Delete `UploadSession`, abort MinIO multipart, set `File.status = DELETED` |
| User deletes file mid-upload | Abort MinIO multipart, cascade-delete `UploadSession` via Prisma |
| Abandoned uploads (future) | Cron: find `File.status = PENDING AND createdAt < 24h ago`, abort + clean |

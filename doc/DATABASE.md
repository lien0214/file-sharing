# DATABASE.md

ORM: **Prisma** | DB: **PostgreSQL 15**

---

## Schema

```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  passwordHash String                          // Argon2
  storageLimit BigInt   @default(5368709120)   // 5 GB
  usedStorage  BigInt   @default(0)
  files        File[]
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
}

model File {
  id            String         @id @default(uuid())
  slug          String         @unique          // NanoID, alphanumeric, 12 chars
  fileName      String
  s3Key         String?                         // Object path in MinIO bucket; null once S3 object is confirmed deleted
  size          BigInt
  mimeType      String
  checksum      String                          // SHA-256, provided by client before upload
  passwordHash  String?                         // Argon2, optional file-level password
  isAnonymous   Boolean        @default(true)
  status        FileStatus     @default(PENDING)
  expiresAt     DateTime?                       // null = never expires
  viewCount     Int            @default(0)
  ownerId       String?
  owner         User?          @relation(fields: [ownerId], references: [id])
  uploadSession UploadSession?
  createdAt     DateTime       @default(now())
  updatedAt     DateTime       @updatedAt
}

// Tracks an in-progress S3 multipart upload.
// Deleted once the upload is completed or aborted.
model UploadSession {
  id          String   @id @default(uuid())
  fileId      String   @unique
  file        File     @relation(fields: [fileId], references: [id], onDelete: Cascade)
  s3UploadId  String                          // MinIO multipart uploadId
  totalParts  Int                             // Expected total number of 16MB parts
  createdAt   DateTime @default(now())
}

enum FileStatus {
  PENDING   // Multipart upload in progress
  READY     // Upload verified; file is publicly accessible
  DELETED   // Soft-deleted; s3Key is null once the MinIO object is confirmed deleted
}
```

---

## Design Notes

### Why `UploadSession` is a separate table
The multipart `s3UploadId` is only needed during the upload window. Separating it from `File` keeps the `File` table clean after uploads complete and makes it easy to find abandoned uploads for cleanup.

### `usedStorage` accounting
- **Increment** on `complete-upload` success (after checksum verified).
- **Decrement** on file deletion (user-triggered or lazy expiry).
- Quota check happens in `init-upload` before any presigned URL is issued:
  ```
  user.usedStorage + newFile.size <= user.storageLimit
  ```
  Anonymous files skip this check.

### File Expiry
Expiry is enforced through three layers — see [CORE_LOGIC.md](CORE_LOGIC.md) for the full flow.

- **Lazy** — checked inline on `GET /files/:slug` and `GET /files/:slug/download`; returns 410 Gone.
- **Hourly sweep** — `sweepExpiredFiles` cron catches files that expired but were never accessed.
- **Daily reconciliation** — `reconcileOrphanedObjects` retries S3 deletions that previously failed (identified by `status = DELETED AND s3Key IS NOT NULL`).

### Slug
- Library: `nanoid`
- Alphabet: `0-9a-zA-Z` (alphanumeric, 62 chars)
- Length: 12
- Collision probability at 1M files: ~0.0001% — acceptable for MVP.

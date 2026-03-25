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
  s3Key         String                          // Object path in MinIO bucket
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
  DELETED   // Soft-deleted; object removed from MinIO
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

### Lazy Expiry (no cron job)
When `GET /files/:slug` is called:
1. Fetch the `File` record.
2. If `expiresAt` is set and `expiresAt < NOW()`:
   - Delete the object from MinIO.
   - Set `status = DELETED`.
   - Decrement `owner.usedStorage` if applicable.
3. Return 410 Gone to the client.

This avoids any background job while still respecting TTLs.

### Slug
- Library: `nanoid`
- Alphabet: `0-9a-zA-Z` (alphanumeric, 62 chars)
- Length: 12
- Collision probability at 1M files: ~0.0001% — acceptable for MVP.

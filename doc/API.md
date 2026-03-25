# API.md

Base URL: `http://localhost:3000`
Auth header: `Authorization: Bearer <jwt>`

---

## Conventions

### Error Response Shape
All errors use the NestJS default envelope:
```json
{
  "statusCode": 403,
  "message": "Storage quota exceeded",
  "error": "Forbidden"
}
```

Common status codes used in this API:
| Code | Meaning |
|---|---|
| `400` | Bad request / validation failure |
| `401` | Missing or invalid JWT |
| `403` | Forbidden (wrong password, quota exceeded, not owner) |
| `404` | Resource not found |
| `410` | Gone (expired file — triggers lazy cleanup) |
| `422` | Checksum mismatch after upload |

### Success Response Shape
Endpoints return data directly (no envelope). `204 No Content` for deletes.

---

## Auth

### `POST /auth/register`
Create a new account.

**Body**
```json
{ "email": "user@example.com", "password": "..." }
```

**Response** `201`
```json
{ "accessToken": "..." }
```

---

### `POST /auth/login`
**Body**
```json
{ "email": "user@example.com", "password": "..." }
```

**Response** `200`
```json
{ "accessToken": "..." }
```

---

### `GET /auth/me`
Returns current user profile + quota. Requires auth.

**Response** `200`
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "storageLimit": 5368709120,
  "usedStorage": 104857600
}
```

---

## Files — Upload Pipeline

### `POST /files/upload/init`
Initiates a new multipart upload. Creates `File` (status=PENDING) and `UploadSession` records.

**Auth:** Optional (anonymous if no token)

**Body**
```json
{
  "fileName": "video.mp4",
  "size": 1073741824,
  "mimeType": "video/mp4",
  "checksum": "<sha256-hex>",
  "expiresAt": "2026-04-01T00:00:00Z",  // optional
  "password": "secret"                   // optional, plaintext — hashed server-side
}
```

**Logic**
1. If authenticated: enforce quota (`usedStorage + size <= storageLimit`).
2. Generate `slug` (NanoID 12).
3. Generate `s3Key` (e.g. `uploads/<uuid>`).
4. Call MinIO `CreateMultipartUpload` → receive `s3UploadId`.
5. Compute `totalParts = ceil(size / 16MB)`.
6. Persist `File` + `UploadSession`.
7. Return metadata and presigned URL for part 1.

**Response** `201`
```json
{
  "fileId": "uuid",
  "slug": "aB3xY7qR2mKp",
  "totalParts": 64,
  "presignedUrl": "http://minio:9000/...",
  "partNumber": 1
}
```

---

### `GET /files/upload/:fileId/presign/:partNumber`
Returns a presigned PUT URL for the given chunk. The frontend calls this sequentially for each part.

**Auth:** Same user or anonymous session that initiated.

**Response** `200`
```json
{ "presignedUrl": "http://minio:9000/..." }
```

---

### `POST /files/upload/:fileId/complete`
Finalizes the multipart upload. Verifies checksum, updates `File.status` to `READY`, deletes `UploadSession`.

**Body**
```json
{
  "parts": [
    { "partNumber": 1, "etag": "\"abc123\"" },
    { "partNumber": 2, "etag": "\"def456\"" }
  ]
}
```

**Logic**
1. Call MinIO `CompleteMultipartUpload` with ETags.
2. Retrieve object checksum from MinIO (`x-amz-checksum-sha256`).
3. Compare with `File.checksum` stored in DB.
4. If mismatch: abort, delete object, set `status = DELETED`, return 422.
5. If match: set `status = READY`, increment `owner.usedStorage`, delete `UploadSession`.

**Response** `200`
```json
{ "slug": "aB3xY7qR2mKp", "url": "/f/aB3xY7qR2mKp" }
```

---

## Files — Read & Access

### `GET /files/:slug`
Returns public metadata for a file. Performs **lazy expiry check**.

**Response** `200`
```json
{
  "slug": "aB3xY7qR2mKp",
  "fileName": "video.mp4",
  "size": 1073741824,
  "mimeType": "video/mp4",
  "isPasswordProtected": true,
  "expiresAt": "2026-04-01T00:00:00Z",
  "createdAt": "2026-03-23T10:00:00Z"
}
```

**Errors**
- `404` — slug not found or status is not READY.
- `410` — file existed but TTL has expired (triggers lazy cleanup).

---

### `POST /files/:slug/access`
Verifies the file password. Returns a short-lived access token on success.

**Body**
```json
{ "password": "secret" }
```

**Response** `200`
```json
{ "accessToken": "<short-lived-token>" }
```

**Errors**
- `403` — wrong password (does not reveal whether file exists).

---

### `GET /files/:slug/download`
Issues a short-lived (e.g. 60s) presigned MinIO GET URL and redirects the client.

**Auth:** If password-protected, requires `accessToken` from `/access` as query param or header.

**Response** `302 Found` → MinIO presigned URL

---

## Files — Management (Auth Required)

### `GET /files`
Lists all files owned by the current user.

**Response** `200`
```json
[
  {
    "id": "uuid",
    "slug": "aB3xY7qR2mKp",
    "fileName": "video.mp4",
    "size": 1073741824,
    "status": "READY",
    "expiresAt": null,
    "isPasswordProtected": true,
    "createdAt": "2026-03-23T10:00:00Z"
  }
]
```

---

### `PATCH /files/:id`
Update file metadata (password or expiry). Owner only.

**Body** (all fields optional)
```json
{
  "password": "newpassword",   // null to remove password
  "expiresAt": "2026-05-01T00:00:00Z"
}
```

**Response** `200` — updated file object.

---

### `DELETE /files/:id`
Deletes the file object from MinIO, sets `status = DELETED`, decrements `usedStorage`. Owner only.

**Response** `204 No Content`

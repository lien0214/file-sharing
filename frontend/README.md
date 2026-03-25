# FileShare — Frontend

Next.js 16 (App Router) client for the FileShare platform.

## Tech Stack

| Concern | Library |
|---|---|
| Framework | Next.js 16 · App Router · React 19 |
| Language | TypeScript |
| Styling | Tailwind CSS v4 |
| Server state | @tanstack/react-query v5 |
| HTTP client | axios |
| Checksum | @noble/hashes (streaming SHA-256) |

## Routes

| Path | Description | Auth |
|---|---|---|
| `/` | Landing — enter a link or start upload | No |
| `/login` | Login | No (redirects if authed) |
| `/signup` | Registration | No (redirects if authed) |
| `/dashboard` | Link list + quota bar + CUD actions | Yes |
| `/upload` | 4-step chunked upload flow | Optional |
| `/account` | Quota stats + account settings | Yes |
| `/f/[slug]` | Public file access / download | No |

## Getting Started

### Prerequisites

- Node ≥ 20 (project uses v24)
- Backend API running on port 3000 (see `../backend/README.md`)

### Install & run

```bash
npm install
npm run dev        # http://localhost:3001
```

### Environment

Create `.env.local`:

```
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### Via Docker Compose

From the repo root:

```bash
docker compose up --build
```

The client is served on port `5173`.

## Project Structure

```
src/
├── app/
│   ├── layout.tsx            # Root layout — wraps with QueryProvider
│   ├── page.tsx              # Landing /
│   ├── login/page.tsx        # /login
│   ├── signup/page.tsx       # /signup
│   ├── dashboard/page.tsx    # /dashboard
│   ├── upload/page.tsx       # /upload
│   ├── account/page.tsx      # /account
│   └── f/[slug]/page.tsx     # /f/:slug
├── components/
│   └── Navbar.tsx            # Shared top nav (auth-aware)
├── lib/
│   ├── api.ts                # Axios client + all API calls
│   ├── auth.ts               # localStorage JWT helpers
│   └── upload.ts             # Chunked upload pipeline
└── providers/
    └── QueryProvider.tsx     # React Query client setup
```

## Upload Pipeline

The chunked upload flow in `src/lib/upload.ts`:

1. **Hash** — computes SHA-256 of the entire file in 16 MB streaming slices using `@noble/hashes` before any network call.
2. **Init** — `POST /files/upload/init` returns a `fileId`, `totalParts`, and the presigned URL for part 1.
3. **Upload** — each 16 MB chunk is PUT to its presigned MinIO URL; ETags are collected from response headers.
4. **Complete** — `POST /files/upload/:fileId/complete` finalises the multipart upload server-side and verifies the checksum.

Progress is reported as a 0–1 value: first 10% = hashing, remaining 90% = uploading.

## Auth

JWTs are stored in `localStorage` under the key `accessToken`. The axios request interceptor in `src/lib/api.ts` attaches the token as `Authorization: Bearer <jwt>` on every request.

Protected pages (`/dashboard`, `/account`) redirect to `/login` on mount if no token is present.

## Backend API — curl Reference

Base URL: `http://localhost:3000`

> **Postman:** import [`../doc/fileshare.postman_collection.json`](../doc/fileshare.postman_collection.json) — collection variables (`token`, `fileId`, `slug`, `accessToken`) are auto-set by test scripts on Login, Init Upload, and Unlock responses.

> Replace `$TOKEN` with the `accessToken` from login/register.
> Replace `$FILE_ID` and `$SLUG` with values from previous responses.

---

### Auth

**Register**
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"yourpassword"}'
```

**Login**
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"yourpassword"}'
```

**Get current user (me)**
```bash
curl http://localhost:3000/auth/me \
  -H "Authorization: Bearer $TOKEN"
```

---

### Upload Pipeline

**1. Init upload**
```bash
curl -X POST http://localhost:3000/files/upload/init \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "fileName": "video.mp4",
    "size": 20971520,
    "mimeType": "video/mp4",
    "checksum": "<sha256-hex>",
    "expiresAt": "2026-06-01T00:00:00Z",
    "password": "optional-password"
  }'
```

**2. Get presigned URL for a chunk**
```bash
curl "http://localhost:3000/files/upload/$FILE_ID/presign/2" \
  -H "Authorization: Bearer $TOKEN"
```

**3. Upload a chunk directly to MinIO** (use the presigned URL from step 2)
```bash
curl -X PUT "$PRESIGNED_URL" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @chunk.bin \
  -D -
# Save the ETag from the response headers
```

**4. Complete upload**
```bash
curl -X POST http://localhost:3000/files/upload/$FILE_ID/complete \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "parts": [
      {"partNumber": 1, "etag": "\"abc123\""},
      {"partNumber": 2, "etag": "\"def456\""}
    ]
  }'
```

---

### File Access (public)

**Get file metadata by slug**
```bash
curl http://localhost:3000/files/$SLUG
```

**Unlock a password-protected file**
```bash
curl -X POST http://localhost:3000/files/$SLUG/access \
  -H "Content-Type: application/json" \
  -d '{"password":"secret"}'
```

**Download a file** (redirects to presigned MinIO URL)
```bash
curl -L http://localhost:3000/files/$SLUG/download
# For password-protected files, pass the accessToken from /access:
curl -L "http://localhost:3000/files/$SLUG/download?accessToken=$ACCESS_TOKEN"
```

---

### File Management (auth required)

**List my files**
```bash
curl http://localhost:3000/files \
  -H "Authorization: Bearer $TOKEN"
```

**Update a file (password / expiry)**
```bash
curl -X PATCH http://localhost:3000/files/$FILE_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "password": "newpassword",
    "expiresAt": "2026-07-01T00:00:00Z"
  }'
```

**Remove password**
```bash
curl -X PATCH http://localhost:3000/files/$FILE_ID \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"password": null}'
```

**Delete a file**
```bash
curl -X DELETE http://localhost:3000/files/$FILE_ID \
  -H "Authorization: Bearer $TOKEN"
```

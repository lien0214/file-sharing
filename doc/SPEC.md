# SPEC.md: Enterprise File-Sharing Platform (MVP)

## 1. Project Vision
A high-performance file-sharing application designed for a **read-heavy** load. It supports two modes: **Anonymous** (temporary, TTL-based shares) and **Authenticated** (persistent storage with user quotas).

The system prioritizes **scalability** by offloading heavy file IO from the application server to an S3-compatible object store (MinIO).

---

## 2. Key Constraints & Decisions

| Concern | Decision |
|---|---|
| Max file size | 1 GB |
| Chunk size | 16 MB |
| Slug format | NanoID, alphanumeric, 12 chars |
| Auth strategy | JWT access token only (stateless) |
| Expiry enforcement | Lazy (checked on read, no cron) |
| View/download limits | **Not in MVP** |
| Password hashing | Argon2 |
| Checksum | SHA-256, computed client-side via `@noble/hashes` (streaming, 16MB slices) |

---

## 3. Infrastructure (Docker Compose)

### Environment Variables
- Single `.env` at the project root — source of truth for credentials and ports.
- `.env` uses `localhost` as host (works for native `npm run dev`).
- `compose.yml` overrides host-sensitive vars via `environment:` block so containers use service names instead.

```
# .env (root)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=secret
POSTGRES_DB=fileshare
DATABASE_URL=postgresql://postgres:secret@localhost:5432/fileshare

MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
MINIO_ENDPOINT=http://localhost:9000
MINIO_BUCKET=files

JWT_SECRET=changeme
```

```yaml
# compose.yml
services:
  postgres:
    image: postgres:15-alpine
    ports: ["5432:5432"]
    env_file: .env

  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    env_file: .env

  api:
    build: ./backend
    depends_on: [postgres, minio]
    env_file: .env
    environment:
      # Override localhost → service names inside Docker network
      DATABASE_URL: postgresql://postgres:secret@postgres:5432/fileshare
      MINIO_ENDPOINT: http://minio:9000

  client:
    build: ./frontend
    ports: ["5173:5173"]
    env_file: .env
```

---

## 4. Development Roadmap

### Stage 1: Foundation
- Setup Docker Compose (Postgres + MinIO + NestJS + Next.js).
- Define Prisma schema and run migrations.
- Configure MinIO bucket and IAM policy.

### Stage 2: Auth
- `POST /auth/register` and `POST /auth/login`.
- JWT guard middleware.
- Quota enforcement helper.

### Stage 3: Upload Pipeline
- `POST /files/upload/init` — create `File` + `UploadSession` records, return first presigned URLs.
- `GET /files/upload/:fileId/presign/:partNumber` — return next presigned URL.
- `POST /files/upload/:fileId/complete` — finalize multipart, verify checksum, update status to `READY`.

### Stage 4: Read & Access
- `GET /files/:slug` — metadata with lazy expiry check.
- `POST /files/:slug/access` — password verification.
- `GET /files/:slug/download` — redirect to short-lived presigned download URL.

### Stage 5: Management & Polish
- Dashboard CRUD (`PATCH`, `DELETE` on files).
- Rate limiting on anonymous endpoints.
- Account page (quota display).

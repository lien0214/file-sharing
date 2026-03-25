# FileShare — Backend

NestJS 10 API for the FileShare platform.

## Tech Stack

| Concern | Library / Service |
|---|---|
| Framework | NestJS 10 |
| Language | TypeScript |
| ORM | Prisma 5 |
| Database | PostgreSQL 15 |
| Object storage | MinIO (S3-compatible) |
| Auth | JWT (`@nestjs/jwt` + Passport) |
| Password hashing | Argon2 |
| Rate limiting | `@nestjs/throttler` |

## API Routes

| Method | Path | Description | Auth |
|---|---|---|---|
| `POST` | `/auth/register` | Register account and return access token | No |
| `POST` | `/auth/login` | Login and return access token | No |
| `GET` | `/auth/me` | Current user profile + quota | Yes |
| `POST` | `/files/upload/init` | Start multipart upload | Optional |
| `GET` | `/files/upload/:fileId/presign/:partNumber` | Get presigned URL for one part | No |
| `POST` | `/files/upload/:fileId/complete` | Complete multipart upload | No |
| `GET` | `/files/:slug` | Public file metadata | No |
| `POST` | `/files/:slug/access` | Verify password and issue short-lived access token | No |
| `GET` | `/files/:slug/download` | Redirect to presigned MinIO download URL | Conditional |
| `GET` | `/files` | List current user's files | Yes |
| `PATCH` | `/files/:id` | Update file password / expiry | Yes |
| `DELETE` | `/files/:id` | Delete owned file (soft-delete metadata + remove object) | Yes |

## Getting Started

### Prerequisites

- Node >= 20
- PostgreSQL and MinIO available
- Env vars configured (see below)

### Install & run

```bash
npm install
npm run db:generate
npm run db:migrate
npm run start:dev
```

API runs on `http://localhost:3000` by default.

### Environment

The backend reads environment variables from the process environment (repo root `.env` when using Docker Compose).

Required variables:

```bash
DATABASE_URL=postgresql://postgres:secret@localhost:5432/fileshare
JWT_SECRET=changeme

MINIO_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_ENDPOINT=http://localhost:9000
MINIO_BUCKET=files
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin
```

### Via Docker Compose

From the repo root:

```bash
docker compose up --build
```

Services:

- API: `http://localhost:3000`
- PostgreSQL: `localhost:5432`
- MinIO API: `http://localhost:9000`
- MinIO Console: `http://localhost:9001`

## Backend Scripts

| Script | Description |
|---|---|
| `npm run start:dev` | Run Nest API in watch mode |
| `npm run build` | Build TypeScript into `dist/` |
| `npm run start` | Start built app from `dist/main` |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Jest tests |
| `npm run db:generate` | Generate Prisma client |
| `npm run db:migrate` | Run Prisma migrations (dev) |
| `npm run db:studio` | Open Prisma Studio |

## Project Structure

```text
src/
├── main.ts                     # App bootstrap, global validation, CORS
├── app.module.ts               # Root module wiring
├── auth/
│   ├── auth.controller.ts      # /auth endpoints
│   ├── auth.service.ts         # Register/login + token signing
│   ├── guards/                 # JWT and optional JWT guards
│   └── strategies/             # Passport JWT strategy
├── files/
│   ├── files.controller.ts     # Upload/read/manage endpoints
│   ├── files.service.ts        # Core file lifecycle logic
│   └── dto/                    # Request DTOs and validation
├── storage/
│   └── storage.service.ts      # MinIO/S3 operations + presign
└── prisma/
    └── prisma.service.ts       # Prisma lifecycle integration

prisma/
└── schema.prisma               # User/File/UploadSession models
```

## Core Behavior

### Chunked upload flow

1. Frontend computes full-file SHA-256 checksum.
2. `POST /files/upload/init` creates `File` (`PENDING`) + `UploadSession`, and returns part-1 presigned URL.
3. Frontend uploads each 16 MB part to MinIO and collects ETags.
4. `POST /files/upload/:fileId/complete` finalizes multipart upload and verifies checksum.
5. On success: `File.status` becomes `READY`, upload session is deleted, owner quota increases.

### Access control

- File password (if set) is hashed with Argon2.
- `POST /files/:slug/access` returns a short-lived file-access JWT (`5m`) after password verification.
- `GET /files/:slug/download` requires that token for protected files.

### Expiry and cleanup

- File expiry is lazy-checked on read/download.
- If expired, object is removed from MinIO, status is marked `DELETED`, and storage quota is decremented.

## Data Model

Prisma models in `prisma/schema.prisma`:

- `User`: auth + quota (`storageLimit`, `usedStorage`)
- `File`: metadata, ownership, security, lifecycle status
- `UploadSession`: in-progress multipart upload tracking (`s3UploadId`, `totalParts`)

For endpoint payloads and status details, see `../doc/API.md`.

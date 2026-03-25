# FileShare

A modern, high-performance file-sharing platform with chunked uploads, password protection, and both anonymous and authenticated sharing modes.

## Features

- **Anonymous sharing** — Upload without an account; set optional TTL for auto-expiry
- **User accounts** — Register to get a persistent file library with 5 GB storage quota
- **Chunked uploads** — Files up to 1 GB via 16 MB chunks with client-side SHA-256 integrity verification
- **Password protection** — Secure individual files with a password
- **File expiry** — Set an expiration date; files auto-delete on next access
- **Presigned URLs** — Direct client-to-storage uploads via MinIO presigned URLs

## Architecture

![Software Architecture](doc/software-architecture.png)

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| State | TanStack React Query v5 |
| Backend | NestJS 10, TypeScript |
| Database | PostgreSQL 15 + Prisma 5 ORM |
| Storage | MinIO (S3-compatible) |
| Auth | JWT (stateless) + Argon2id password hashing |
| Infrastructure | Docker Compose |

## Project Structure

```
picCollage/
├── frontend/          # Next.js client
├── backend/           # NestJS API
├── doc/               # Architecture docs, API reference, specs
├── compose.yml        # Docker Compose (Postgres + MinIO + API + frontend)
└── package.json       # Root scripts
```

## Getting Started

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose
- Node.js >= 20 (project uses v24.14.0 — use [nvm](https://github.com/nvm-sh/nvm))

### 1. Configure environment

Create a `.env` file in the project root:

```env
# Database
DATABASE_URL=postgresql://postgres:secret@localhost:5432/fileshare

# MinIO
MINIO_ENDPOINT=http://localhost:9000
MINIO_PUBLIC_ENDPOINT=http://localhost:9000
MINIO_BUCKET=files
MINIO_ROOT_USER=minioadmin
MINIO_ROOT_PASSWORD=minioadmin

# Auth
JWT_SECRET=changeme

# Server
PORT=3000
```

Create `frontend/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://localhost:3000
```

### 2. Start with Docker Compose (recommended)

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| Next.js frontend | http://localhost:5173 |
| NestJS API | http://localhost:3000 |
| MinIO console | http://localhost:9001 |

### 3. Native development (without Docker)

Start MinIO and PostgreSQL separately, then:

```bash
# Terminal 1 — backend
npm run dev:backend

# Terminal 2 — frontend
npm run dev:frontend
```

## Root Scripts

```bash
npm run dev              # Run backend + frontend in parallel
npm run build            # Build both
npm run lint             # Lint both
npm run test             # Run backend tests
npm run db:generate      # Generate Prisma client
npm run db:migrate       # Run DB migrations
npm run db:studio        # Open Prisma Studio (visual DB browser)
npm run compose:up       # docker compose up
npm run compose:down     # docker compose down
```

## Frontend Routes

| Path | Description | Auth |
|---|---|---|
| `/` | Landing page | — |
| `/upload` | 4-step chunked upload flow | Optional |
| `/f/:slug` | Public file access / download | — |
| `/dashboard` | Manage your files | Required |
| `/account` | Storage quota and settings | Required |
| `/login` | Login | — |
| `/signup` | Registration | — |

## API Overview

See [doc/API.md](doc/API.md) for the full endpoint reference.

| Group | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login` |
| Upload | `POST /files/init`, `POST /files/:id/presign`, `POST /files/:id/complete` |
| Access | `GET /files/:slug`, `POST /files/:slug/access` |
| Manage | `GET /files`, `PATCH /files/:id`, `DELETE /files/:id` |

## Port Mapping Configuration

| Service | Local Port | Docker Host Port | Who talks to it |
| :--- | :--- | :--- | :--- |
| **NestJS API** | 3000 | 3000 | Frontend (`NEXT_PUBLIC_API_URL`) |
| **Next.js** | 3001 | 5173 | Browser |
| **MinIO API** | 9000 | 9000 | Browser (presigned uploads) + NestJS |
| **MinIO Console** | 9001 | 9001 | You (admin UI) |
| **PostgreSQL** | 5432 | 5432 | NestJS (via `DATABASE_URL`) |

- `npm run dev` for local port
- `docker compose up -d` for docker port

## Documentation

All detailed documentation lives in [doc/](doc/):

- [USER-STORY.md](doc/USER-STORY.md) — Feature requirements and user stories
- [TECH-STACK.md](doc/TECH-STACK.md) — Technology choices with rationale
- [SPEC.md](doc/SPEC.md) — MVP constraints, infrastructure, and roadmap
- [API.md](doc/API.md) — Complete endpoint reference
- [DATABASE.md](doc/DATABASE.md) — Prisma schema and design notes
- [CORE-LOGIC.md](doc/CORE-LOGIC.md) — Chunked upload flow, expiry logic, password flow

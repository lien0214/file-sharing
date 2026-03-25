# TECH-STACK.md

---

## Backend

| Layer | Technology | Notes |
|---|---|---|
| Runtime | Node.js (LTS) | |
| Framework | NestJS | TypeScript-first, DI, modules |
| ORM | Prisma | Schema-first, strong TypeScript types |
| Database | PostgreSQL 15 | Metadata & auth |
| Object Storage | MinIO | Dockerized S3-compatible store |
| Password Hashing | Argon2 (`argon2` npm) | `argon2id` variant |
| Auth | JWT (`@nestjs/jwt`) | Access token only, stateless |
| Slug | NanoID (`nanoid`) | Custom alphabet, 12 chars |
| Rate Limiting | `@nestjs/throttler` | Applied to anonymous endpoints |

---

## Frontend

| Layer | Technology | Notes |
|---|---|---|
| Framework | Next.js 16 (App Router) | React 19, SSR/SSG |
| Language | TypeScript | |
| Styling | Tailwind CSS v4 | |
| HTTP Client | `axios` | |
| Checksum | `@noble/hashes` | Streaming SHA-256, no OOM risk |
| State | React Query (`@tanstack/react-query`) | Server state, caching |

---

## Infrastructure

| Service | Image | Ports |
|---|---|---|
| PostgreSQL | `postgres:15-alpine` | 5432 |
| MinIO | `minio/minio` | 9000 (API), 9001 (console) |
| NestJS API | `./backend` Dockerfile | 3000 |
| Next.js client | `./frontend` Dockerfile | 5173 |

Orchestrated via **Docker Compose** for local development.

---

## Frontend Routes

| Path | Description | Auth Required |
|---|---|---|
| `/` | Landing — enter a link or start upload | No |
| `/login` | Login page | No (redirect if authed) |
| `/signup` | Registration page | No (redirect if authed) |
| `/dashboard` | Link list + "Create Link" CTA | Yes |
| `/upload` | Upload flow (chunked) | Optional (anonymous or user) |
| `/account` | Quota display, account settings | Yes |
| `/f/:slug` | Public file access / download | No |

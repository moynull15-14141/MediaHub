# MediaHub

Enterprise-grade media toolkit with two core features:

- **Downloader** — fetch video/audio from supported sites via `yt-dlp`
- **Converter** — upload a local video, re-encode it (format, resolution, codec, audio) with real-time progress via `ffmpeg`

Uploaded/converted video files are stored in **Cloudflare R2** (S3-compatible object storage), auto-expiring after a configurable TTL. Job metadata (status, progress, history) is stored in **PostgreSQL** via Prisma.

## Architecture

The app is a single Express server ([server.ts](server.ts)) that serves both the API (`/api/*`) and the built React frontend. It can run either as one self-hosted service, or split across two platforms:

- **Self-hosted (Docker Compose)** — one container runs frontend + backend + ffmpeg, plus a Postgres container. See below.
- **Split deployment (this project's current setup)** — backend (API + Postgres + ffmpeg) on **Render**, frontend (static Vite build) on **Vercel**. In this mode, set `VITE_API_URL` in the Vercel project's environment variables to the Render service's public URL, so the frontend knows where to send API requests.

## Run locally with Docker (recommended)

**Prerequisites:** Docker Desktop

1. Copy `.env.example` to `.env` and fill in the values (see table below)
2. `docker compose up --build -d`
3. Open http://localhost:3000

## Run locally without Docker

**Prerequisites:** Node.js, a running Postgres instance, ffmpeg + yt-dlp on `PATH`

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `DATABASE_URL` plus the R2 credentials
3. `npm run db:migrate`
4. `npm run dev`

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | Postgres connection string |
| `R2_ACCOUNT_ID` | yes | Cloudflare account ID hosting the R2 bucket |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | yes | R2 S3-compatible API credentials |
| `R2_BUCKET_NAME` | yes | R2 bucket used for uploaded/converted video storage |
| `R2_ENDPOINT` | yes | R2 S3 API endpoint (`https://<account-id>.r2.cloudflarestorage.com`) |
| `MAX_UPLOAD_MB` | no (default `2048`) | Max upload size for the converter |
| `CONVERTER_DOWNLOAD_TTL_HOURS` | no (default `24`) | Hours a converted file stays downloadable before auto-delete |
| `VITE_API_URL` | only for a split frontend deploy (e.g. Vercel) | Backend base URL the built frontend should call; leave unset for same-origin (self-hosted) deployments |

## Scripts

- `npm run dev` — run the dev server (Vite middleware + Express, TS via `tsx`)
- `npm run build` — build the frontend and bundle the server for production
- `npm run start` — run the production build (`dist/server.cjs`)
- `npm run db:migrate` — create/apply a Prisma migration in development
- `npm run lint` — typecheck the whole project

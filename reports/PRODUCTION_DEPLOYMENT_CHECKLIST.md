# Production Deployment Checklist — Doctor Kinjal Maheshwari's Patient Tracker

---

## 1. Required Environment Variables (By Name Only)

Ensure the following environment variables are configured in **Vercel Project Settings → Environment Variables** for the **Production** (and Preview) environments:

| Variable Name | Required | Purpose |
| :--- | :--- | :--- |
| `DATABASE_URL` | Optional on Vercel (auto-resolves to `file:/tmp/dentalcare.db`) / Required locally (`file:./dev.db`) | Prisma SQLite datasource connection URL |
| `AUTH_USERNAME` | Yes (defaults to `doctorkinjal`) | Authorized doctor login username |
| `AUTH_PASSWORD_HASH` | Yes | 60-character bcrypt password hash (`$2b$12$...`) |
| `AUTH_SECRET` | **Yes (Required in Production)** | Secret key used to sign/verify HTTP-only `dentalcare_session` JWT cookies |
| `GOOGLE_SHEET_ID` | Yes (for Google Sheets sync & cold-start hydration) | Target Google Spreadsheet ID |
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | Yes (for Google Sheets sync & cold-start hydration) | Google Cloud Service Account email with Editor access to the sheet |
| `GOOGLE_PRIVATE_KEY` | Yes (for Google Sheets sync & cold-start hydration) | Service Account PEM private key |

---

## 2. Pre-Deployment Verification Steps

- [x] `npm run db:generate` — Prisma Client generated cleanly (`v6.19.3`).
- [x] `npx tsc --noEmit` — TypeScript typecheck passed with `0` errors.
- [x] `npm run lint` — ESLint passed with `0` warnings or errors.
- [x] `npm run db:migrate:deploy` — Baseline migration `20261104000000_init` verified with `0` pending migrations.
- [x] `CI=true npm test` — All `16` test suites (`96/96` tests) passed against isolated test databases.
- [x] `npm run build` — Production build (`prisma generate && next build`) succeeded cleanly.
- [x] Secret & database file check — Verified via `git status` and `git diff` that `.env`, `prisma/*.db`, and all credentials/backups are excluded from Git.

---

## 3. Post-Deployment Verification Steps

1. Confirm GitHub `main` branch push triggers a new Vercel Production deployment for the latest commit.
2. Open `https://doctor-kinjal.vercel.app/` and sign in via `POST /api/auth/login`.
3. Verify `GET /api/dashboard` returns `HTTP 200` and populates dashboard metrics from the hydrated database.
4. Verify `GET /api/patients` lists existing patients and `POST /api/patients` creates a patient with `HTTP 201` and synchronizes to Google Sheets.
5. Verify Settings → Google Sheets Synchronization status shows `Configured` and `0` failed jobs.

---

## 4. Remaining Production Risks & Long-Term Recommendations

- **Cold-Start Latency & Concurrent Instance State**:
  - On Vercel serverless, `/tmp/dentalcare.db` is local to each warm Lambda instance and hydrates from Google Sheets on cold start (~300–600ms) while writing through to Google Sheets on every mutation.
  - If the clinic scales to high concurrent multi-user write traffic across multiple simultaneous serverless instances, migrating the Prisma datasource to a managed network database (such as **Turso / libSQL** for native SQLite compatibility or **Vercel Postgres / Neon**) is recommended so all instances share a single transactional database connection pool in addition to Google Sheets reporting.


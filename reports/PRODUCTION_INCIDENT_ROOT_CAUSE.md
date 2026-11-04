# Production Incident Root Cause Report — Doctor Kinjal Maheshwari's Patient Tracker

**Incident Date**: November 4, 2026  
**Affected Environment**: Vercel Production (`https://doctor-kinjal.vercel.app/`)  
**Affected Endpoints**: `POST /api/patients`, `GET /api/dashboard`, `GET /api/patients`, and all clinical/financial Prisma-backed API routes

---

## 1. Executive Summary

Following deployment of the application from GitHub to Vercel (`https://doctor-kinjal.vercel.app/`), authenticated requests to `GET /api/dashboard` and `POST /api/patients` returned **HTTP 500**, and the patient registration UI displayed a misleading toast message: **`"Please check required fields."`**

A comprehensive code, configuration, and runtime investigation identified **three interacting root causes**:

1. **Unwritable / Missing SQLite Database File in Vercel Serverless Runtime (`PrismaClientInitializationError` / `P2021`)**:
   - [`prisma/schema.prisma`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/prisma/schema.prisma) uses `provider = "sqlite"` with `DATABASE_URL="file:./dev.db"`.
   - `prisma/*.db` is excluded in [`.gitignore`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/.gitignore), and no `prisma/migrations/` folder existed in the repository.
   - On Vercel serverless functions, the application bundle directory (`/var/task`) is mounted **read-only (`EROFS`)** and `/var/task/prisma/dev.db` does not exist. Only `/tmp` is writable during a serverless invocation.
   - Consequently, every Prisma query in `GET /api/dashboard` and `POST /api/patients` failed when attempting to open or create `/var/task/prisma/dev.db`.

2. **Unhandled Database Exceptions in API Route Handlers**:
   - In [`app/api/dashboard/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/dashboard/route.ts), `Promise.all([...])` executed 20 parallel Prisma queries without a `try/catch` block. When Prisma threw `PrismaClientInitializationError`, the serverless function crashed with an unhandled exception, returning a generic **HTTP 500**.
   - In [`app/api/patients/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/patients/route.ts), `await db.patient.findFirst(...)` was outside any `try/catch` block, and the `db.$transaction` catch block explicitly re-threw any error other than `P2002` (`throw error;`), resulting in an unhandled **HTTP 500** response without a JSON `{ error: "..." }` body.

3. **Misleading Frontend Error Fallback on HTTP 500**:
   - In [`components/clinic-app.tsx`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/components/clinic-app.tsx) (`AddPatient`), when `POST /api/patients` returned a non-2xx status and `await r.json().catch(() => ({}))` yielded `{}` (because Next.js's unhandled 500 response had no `error` JSON field), the client executed:
     ```ts
     pushToast(payload.error || "Please check required fields.", "error");
     ```
   - This caused an HTTP 500 database failure to be presented to the user as `"Please check required fields."` even when all patient fields passed validation.

---

## 2. Exact Root Cause of `POST /api/patients` Returning HTTP 500

1. The browser submitted `POST /api/patients` with valid JSON payload (`firstName`, `lastName`, `phone`, `consented`, etc.).
2. `isAuthenticated()` and `sameOrigin(req)` succeeded, and `patientSchema.safeParse(body)` passed validation.
3. Execution reached `await db.patient.findFirst({ where: { deletedAt: null, OR: identifiers } })` in [`app/api/patients/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/patients/route.ts).
4. Prisma attempted to open the SQLite database at `file:./dev.db` (`/var/task/prisma/dev.db` on Vercel) or failed initialization if `DATABASE_URL` was unset/unwritable.
5. Because `db.patient.findFirst` was not wrapped in a `try/catch` (and the transaction loop re-threw non-`P2002` errors), the unhandled exception terminated the route handler with **HTTP 500**.
6. On the frontend, `payload.error` was `undefined`, triggering the hardcoded fallback toast `"Please check required fields."`.

---

## 3. Exact Root Cause of `GET /api/dashboard` Returning HTTP 500

1. Upon login, [`ClinicApp`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/components/clinic-app.tsx) called `fetch("/api/dashboard")` in `refreshDashboard()`.
2. In [`app/api/dashboard/route.ts`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/api/dashboard/route.ts), `await isAuthenticated()` succeeded using the signed `dentalcare_session` JWT cookie.
3. Execution reached `await Promise.all([ db.patient.count(...), ... ])`, which immediately threw a Prisma initialization/table error against the missing/read-only `/var/task/prisma/dev.db` SQLite target.
4. With no `try/catch` around `Promise.all`, the route returned **HTTP 500**, and the dashboard remained populated with placeholder `"—"` values.

---

## 4. Audit of Remaining API Routes

The same unhandled Prisma query pattern and Vercel read-only SQLite target affected all remaining API routes:
- `GET /api/patients` and `GET/PATCH/DELETE /api/patients/[id]`
- `GET/POST /api/appointments` and `PATCH /api/appointments/[id]`
- `GET/POST /api/treatments` and `PATCH /api/treatments/[id]`
- `GET/POST /api/prescriptions`
- `GET/POST /api/follow-ups` and `PATCH /api/follow-ups/[id]`
- `GET/POST /api/invoices`, `GET/PATCH /api/invoices/[id]`, and `POST /api/invoices/[id]/payments`
- `GET/POST /api/sync`
- `POST /api/auth/login` (additionally required normalization for `AUTH_PASSWORD_HASH` when `\$` escapes or surrounding quotes are copied from `.env` into Vercel Environment Variables).


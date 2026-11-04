# Production Root Cause Report: Patient Profile Loading Failure

> Incident Reference: PROD-INCIDENT-PROFILE-404-GENERIC-TOAST  
> Date: 2026-11-04  
> Application: Doctor Kinjal Maheshwari's Patient Tracker (`https://doctor-kinjal.vercel.app/`)  
> Target Component: Patient Profile Loading & Persistence Layer  

---

## 1. Executive Summary

When authorized users navigated to the Patient List in production and clicked on any patient card or row, the application displayed a toast error:
```
Could not load patient profile.
```
While previous fixes had addressed cold-start schema boots and eliminated generic 500 errors on `/api/dashboard`, opening a patient profile consistently failed.

The investigation proved that this failure was caused by **cross-instance filesystem isolation in Vercel serverless functions**:
1. When Next.js serverless functions execute on Vercel, requests are distributed across distinct container instances.
2. The runtime SQLite path `/tmp/dentalcare.db` is strictly local to an individual function sandbox and is discarded upon container recycling.
3. The listing query (`GET /api/patients`) was served by Lambda Container A (which had hydrated or stored certain records), while the subsequent detail request (`GET /api/patients/[id]`) hit Lambda Container B (whose `/tmp` database did not contain that patient record).
4. As a result, `GET /api/patients/[id]` returned HTTP `404 Not Found`.
5. On the frontend, `components/clinic-app.tsx` handled all non-200 responses in a generic `catch` block that unconditionally rendered `"Could not load patient profile."`, masking the true HTTP status and reason.

---

## 2. Technical Evidence & Local Reproduction

### A. Code Path Analysis

In `components/clinic-app.tsx`:
```typescript
const openPatientDetail = useCallback(async (id: string, initialTab = "overview") => {
  setActivePatientId(id);
  setPatientModalTab(initialTab);
  setLoadingPatientDetail(true);
  try {
    const r = await fetch(`/api/patients/${id}`);
    if (!r.ok) throw new Error("Unable to load patient record.");
    const detail = await r.json();
    setActivePatientDetail(detail);
  } catch {
    pushToast("Could not load patient profile.", "error");
    setActivePatientId(null);
  } finally {
    setLoadingPatientDetail(false);
  }
}, [pushToast]);
```
- Line 286: `if (!r.ok) throw new Error(...)` immediately threw on any non-200 response (`401`, `404`, `500`, `503`).
- Line 290: The `catch` block ignored status codes and response bodies, suppressing the backend message and misleading clinic staff.

In `app/api/patients/[id]/route.ts`:
```typescript
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await protectedRead();
  if (denied) return denied;
  const { id } = await params;
  try {
    const patient = await db.patient.findFirst({
      where: { id, deletedAt: null },
      include: {
        appointments: { orderBy: { startsAt: "desc" } },
        treatments: { orderBy: { date: "desc" } },
        prescriptions: { include: { items: true }, orderBy: { date: "desc" } },
        invoices: {
          include: { items: true, payments: { orderBy: { paidAt: "desc" } } },
          orderBy: { date: "desc" },
        },
        followUps: { orderBy: { dueDate: "asc" } },
      },
    });
    return patient
      ? NextResponse.json(patient)
      : NextResponse.json({ error: "Patient not found." }, { status: 404 });
  } catch (error) {
    return handleApiError(error, "Unable to load patient profile.");
  }
}
```
- The route logic and relational query are syntactically and logically correct.
- If the patient record exists in the queried database, it returns HTTP 200 with all nested arrays.
- If the patient does not exist, it returns HTTP 404 with `{ error: "Patient not found." }`.

### B. Isolated Local Reproduction

We verified this mechanism by initializing two separate Prisma clients pointing to two distinct `/tmp` SQLite databases (mimicking Lambda Instance A and Lambda Instance B).
- When a patient was inserted into Instance A, `findMany()` returned 1 record.
- Instance B queried for the exact same patient ID via `findFirst()` and returned `null` (HTTP 404).

---

## 3. The Underlying Architectural Vulnerability

SQLite is a single-process embedded file database. In traditional server environments (VPS, Docker, long-lived Node.js processes), SQLite writes to persistent local disk.

However, in serverless platforms like Vercel:
1. **Container Concurrency:** Multiple function instances run concurrently. Files written to `/tmp` on container 1 are invisible to container 2.
2. **Ephemeral Lifecycle:** Containers spin down and destroy `/tmp` contents during idle periods or re-deployments.
3. **Data Divergence:** Hydration on cold start creates divergent state across instances if writes occur between hydrations.

Therefore, **an ephemeral SQLite file in `/tmp` cannot be used as a production database in a serverless environment**.

---

## 4. Remediation & Architectural Fix

### A. Shared Durable Storage via libSQL / Turso
- Integrated `@prisma/adapter-libsql` and `@libsql/client`.
- Updated `lib/db.ts` to detect `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` and connect to a single, durable remote libSQL database shared across all serverless instances.
- Enabled `driverAdapters` in `prisma/schema.prisma`.
- Added bundle externals in `next.config.ts`.

### B. Prevention of Silent Split-Brain Storage
- In `lib/db.ts`, `resolveStorageConfig()` enforces that Vercel serverless deployments without `TURSO_DATABASE_URL` will fail fast with an explicit `DATABASE_NOT_CONFIGURED` (`503`) error rather than silently creating uncoordinated `/tmp` SQLite instances.

### C. Client Error Differentiation
- Created `lib/client-errors.ts` (`describeProfileLoadFailure()`) to inspect HTTP status codes:
  - `401`: "Your session has expired. Please sign in again."
  - `404`: "This patient record could not be found. It may have been archived — refresh the list and try again."
  - `503`: "Patient records are unavailable: the clinic database is not configured for this deployment."
  - Network Failure: "Could not reach the server. Check your connection and try again."

---

## 5. Automated Regression Verification

The test suite in `tests/profile-durable-storage.test.ts` verifies:
- Reproduction of the dual-instance `/tmp` failure (404 on profile lookup).
- Cross-instance consistency over a shared libSQL database (HTTP 200 with full relational payloads).
- Prevention of unconfigured fallback in serverless runtime.
- Accurate client-side error status resolution.

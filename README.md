# Doctor Kinjal Maheshwari's Patient Tracker

Local-first dental clinic management for Doctor Kinjal Maheshwari. The browser UI is protected by a signed HTTP-only session; clinic records are stored in SQLite and are queued for Google Sheets reporting after each local write.

## Run locally

```bash
npm install
cp .env.example .env
node -e "require('bcryptjs').hash('kunj123',12).then(console.log)"
# Put the resulting hash in AUTH_PASSWORD_HASH and set a random AUTH_SECRET
npx prisma generate
npx prisma db push
npm run dev -- --hostname 0.0.0.0
```

Open `http://localhost:3000`. On the clinic Wi-Fi, use the Mac's private LAN address (for example `http://192.168.1.20:3000`) after allowing Node through the macOS firewall. The fixed username defaults to `doctorkinjal`; no account or password management UI exists.

## Google Sheets

1. Create a Google Cloud service account and enable **Google Sheets API**.
2. Share the supplied spreadsheet with the service account email as Editor.
3. Create a `Patients` tab with headers: `Patient ID, First Name, Last Name, Phone, Email, Updated At`.
4. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` in `.env` (retain newline escapes in the private key).
5. Use **Sync now**. Failed work stays in the local queue and is retried with exponential backoff.

## Data care

SQLite is authoritative. Back up the `prisma/dev.db` file only while the application is stopped, or use SQLite's `.backup` command; keep encrypted backups in a separate secure location. Google Sheets is a synchronized reporting/recovery layer, not the operational source of truth.

## Current implementation

The starter includes the complete relational core for patients, appointments, treatments, prescriptions, invoices, follow-ups, audit logging, and synchronization metadata; secure login; patient registration/search; dashboard analytics; appointment conflict validation; polished light/dark responsive navigation; and idempotent patient-to-sheet synchronization. Extend the record screens using the same protected API pattern before entering live clinical data.

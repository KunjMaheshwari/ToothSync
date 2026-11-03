# Responsive UI QA Report — Doctor Kinjal Maheshwari's Patient Tracker

**Application**: Doctor Kinjal Maheshwari's Patient Tracker  
**Dashboard Greeting Preserved**: `"Welcome Doctor Kinjal Maheshwari"`  
**Verification Date**: 2026-11-04  
**Verification Method**: Headless Chromium Browser Viewport Emulation via Playwright (`1.61.1`) against a live Next.js production server (`next start` on `http://localhost:3456` with isolated `prisma/test.db`). *Note: This verification used automated browser viewport emulation, not physical iPhone/iPad hardware.*

---

## 1. Target Viewports Tested

| Target Profile | Viewport Dimensions (`W × H`) | Active Responsive Breakpoint | Navigation Mode |
|---|---|---|---|
| **iPhone 18 Pro Mobile** | `402 × 874` | `@media (max-width: 760px)` | Fixed `63px`-tall horizontal-scroll bottom tab bar (`display: contents` group flattening) |
| **iPad Air Tablet** | `820 × 1180` | `@media (max-width: 1120px)` | Sticky `76px`-wide vertical icon rail with `44px` touch targets |
| **Laptop / Desktop** | `1440 × 900` | Default (`> 1260px`) | Sticky `264px`-wide frosted-glass sidebar with section headers |

---

## 2. Issues Identified & Fixes Applied

| ID | Affected Component / CSS | Viewport Affected | Issue Found During Inspection | Root-Cause Fix Applied |
|---|---|---|---|---|
| `RESP-001` | [`components/clinic-app.tsx`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/components/clinic-app.tsx), [`app/globals.css`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/globals.css) | Mobile (`402 × 874`) | `<nav className="nav">` wrapped each navigation section in `<div style={{ display: "grid", gap: 2 }}>`, causing the mobile bottom bar to render 3 stacked vertical rows per column instead of a single horizontal tab strip, and `<aside className="sidebar"> > div` lacked `min-width: 0`. | Replaced inline grid style with `.nav-group` (`display: contents` at `max-width: 760px`) and added `.sidebar-main { width: 100%; min-width: 0; }`, yielding a single `63px`-tall horizontal-scroll bottom bar. |
| `RESP-002` | [`app/globals.css`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/globals.css) (`.grid`, `.actions`) | Tablet (`820 × 1180`) | `.grid` (`grid-template-columns: minmax(0, 1.35fr) minmax(340px, 1fr)`) remained 2-column at `820px`, squeezing two-column `.form-grid` (`datetime-local` inputs) into `~330px`. Quick actions (`.actions`) kept 5 columns at `820px`. | Collapsed `.grid` to `1fr` and changed `.actions` to `repeat(3, minmax(0, 1fr))` inside `@media (max-width: 1120px)`. |
| `RESP-003` | [`app/globals.css`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/globals.css) (`.appointment`) | Mobile (`402 × 874`) | `.appointment` changed from 3 columns (`88px minmax(0, 1fr) auto`) to 2 columns (`74px minmax(0, 1fr)`) on mobile, forcing the 3rd child (status pill + Complete/Cancel/Bill buttons) into the narrow `74px` first column. | Added `.appointment > :nth-child(3) { grid-column: 1 / -1; justify-self: flex-start; }` at `max-width: 760px` and `.appointment > div { min-width: 0; overflow-wrap: anywhere; }`. |
| `RESP-004` | [`app/globals.css`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/globals.css) (`.segmented`) | Mobile (`402 × 874`) | Multi-option segmented controls (5 tabs in Billing, 4 tabs in Patient 360° Modal & Treatments) used `display: inline-flex` without wrapping, risking horizontal overflow on `402px` screens. | Added `flex-wrap: wrap; max-width: 100%;` to `.segmented` and responsive flex sizing on mobile (`flex: 1 1 auto; min-height: 32px;`). |
| `RESP-005` | [`components/clinic-app.tsx`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/components/clinic-app.tsx), [`app/globals.css`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/globals.css) | Mobile (`402 × 874`) & Tablet (`820 × 1180`) | Form and modal action footers (`Treatments`, `Prescriptions`, `Billing`, `Follow-ups`, `Invoice Ledger Modal`, `Patient 360° Edit Footer`) used `display: flex; justify-content: space-between;` without `flex-wrap: wrap`. | Created `.form-actions-row` (`display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;`) and added `flexWrap: "wrap"` to modal headers and footers. |
| `RESP-006` | [`app/globals.css`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/app/globals.css), [`components/login.tsx`](file:///Users/kunjmaheshwari/Documents/ChatGPT/Doctor%20Kinjal/components/login.tsx) | Mobile (`402 × 874`) | Input font-size (`13.5px`) could trigger iOS Safari auto-zoom on focus; modal padding (`20px` backdrop + `26px` panel) reduced usable modal width on `402px` screens; login password eye icon was fixed at `top: 4px`. | Set mobile form inputs to `min-height: 42px; font-size: 16px;`, mobile `.btn` to `min-height: 38px`, mobile modal width to `382px` (`10px` backdrop padding, `18px 15px` panel padding), and centered login password toggle (`top: 50%; transform: translateY(-50%)`). |

---

## 3. Screen-by-Screen Playwright Viewport Telemetry

All 13 screens and modals were rendered and measured across all 3 target viewports (`39` total checks):

| Screen / Modal | Mobile (`402 × 874`) `scrollWidth / clientWidth` | Tablet (`820 × 1180`) `scrollWidth / clientWidth` | Desktop (`1440 × 900`) `scrollWidth / clientWidth` | Horizontal Overflow (`overflowX`) | Status |
|---|---|---|---|---|---|
| **Login (`<Login />`)** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |
| **Dashboard (`Welcome Doctor Kinjal Maheshwari`)** | `402 / 402` (Nav: `402×63`) | `820 / 820` (Nav: `76×1180`) | `1440 / 1440` (Nav: `264×900`) | `false` on all 3 | **PASS** |
| **Patients Directory & Search** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |
| **Modal: Patient 360° Profile** | `402 / 402` (Modal: `382px` wide) | `820 / 820` (Modal: `780px` wide) | `1440 / 1440` (Modal: `920px` wide) | `false` on all 3 | **PASS** |
| **Add Patient (`Register a patient`)** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |
| **Appointments** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |
| **Treatments** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |
| **Prescriptions** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |
| **Follow-ups** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |
| **Billing & Invoices** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |
| **Modal: Record Payment** | `402 / 402` (Modal: `382px` wide) | `820 / 820` (Modal: `520px` wide) | `1440 / 1440` (Modal: `520px` wide) | `false` on all 3 | **PASS** |
| **Reports & Practice Analytics** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |
| **Settings & Sync Queue** | `402 / 402` | `820 / 820` | `1440 / 1440` | `false` on all 3 | **PASS** |

---

## 4. Remaining Limitations & Honest Disclosure

1. **Browser Emulation vs. Physical Hardware**: All viewport checks (`402 × 874`, `820 × 1180`, `1440 × 900`) were performed using automated headless Chromium viewport emulation via Playwright on macOS, not on physical iPhone 18 Pro or iPad Air hardware. Safe-area inset CSS (`env(safe-area-inset-bottom)`) is included for iOS home-indicator clearance.
2. **Data Tables on Narrow Mobile Screens (`402 × 874`)**: The 6-column **Patients** directory table and 7-column **Billing & Invoices** ledger table intentionally scroll horizontally inside their self-contained `.table-wrap` container (`overflow-x: auto; -webkit-overflow-scrolling: touch;`) on `402px` mobile screens so no financial columns or patient identifiers are hidden, while the page itself (`document.documentElement.scrollWidth === 402`) never overflows horizontally.


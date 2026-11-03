"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock,
  CreditCard,
  Database,
  Edit3,
  Eye,
  FileText,
  Home,
  LoaderCircle,
  LogOut,
  Moon,
  MoreHorizontal,
  Pill,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Sun,
  Trash2,
  UserCheck,
  Users,
  X,
} from "lucide-react";
import { parseRupeesToPaise } from "@/lib/validation";

type Dash = {
  patients: number;
  today: number;
  completed: number;
  upcoming: number;
  pending: number;
  followups: number;
  recent: any[];
  upcomingAppointments?: any[];
  dueFollowUps?: any[];
  treatmentsCount?: number;
  prescriptionsCount?: number;
  billingSummary?: {
    totalBilledPaise: number;
    totalCollectedPaise: number;
    totalDiscountPaise: number;
    outstandingPaise: number;
    invoicesCount: number;
  };
  syncStatus?: {
    pending: number;
    failed: number;
    synced: number;
    lastSync: string | null;
  };
  recentAudit?: any[];
};

type ToastItem = {
  id: number;
  text: string;
  kind: "success" | "error" | "info";
};

const nav = [
  ["Dashboard", Home],
  ["Patients", Users],
  ["Appointments", CalendarDays],
  ["Treatments", Activity],
  ["Prescriptions", FileText],
  ["Billing", CircleDollarSign],
  ["Follow-ups", ClipboardList],
  ["Reports", Activity],
  ["Settings", Settings],
] as const;

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format((paise || 0) / 100);

function toLocalDatetimeInputValue(date = new Date()) {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function safeIsoFromInput(raw: string): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

const COMMON_MEDICATIONS = [
  {
    label: "Amoxicillin 500mg",
    medication: "Cap. Amoxicillin",
    dosage: "500 mg",
    frequency: "1-1-1 (Every 8 hrs)",
    duration: "5 days",
    instructions: "After meals. Complete full course.",
  },
  {
    label: "Ibuprofen 400mg",
    medication: "Tab. Ibuprofen",
    dosage: "400 mg",
    frequency: "1-0-1 (SOS for pain)",
    duration: "3 days",
    instructions: "Take after food.",
  },
  {
    label: "Paracetamol 650mg",
    medication: "Tab. Paracetamol",
    dosage: "650 mg",
    frequency: "1-1-1",
    duration: "3 days",
    instructions: "After meals.",
  },
  {
    label: "Pantoprazole 40mg",
    medication: "Tab. Pantoprazole",
    dosage: "40 mg",
    frequency: "1-0-0 (Morning)",
    duration: "5 days",
    instructions: "30 minutes before breakfast.",
  },
  {
    label: "Chlorhexidine Mouthwash",
    medication: "Chlorhexidine Gluconate 0.2%",
    dosage: "10 ml",
    frequency: "Twice daily",
    duration: "7 days",
    instructions: "Rinse for 30s. Do not eat/drink for 30 mins after.",
  },
];

export default function ClinicApp() {
  const [page, setPage] = useState<string>("Dashboard");
  const [dark, setDark] = useState<boolean>(false);
  const [mounted, setMounted] = useState<boolean>(false);

  const [dash, setDash] = useState<Dash | null>(null);
  const [patients, setPatients] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [message, setMessage] = useState("");
  const [syncing, setSyncing] = useState(false);

  // Pre-selected patient context when jumping from Patient 360° or Treatments to another module
  const [selectedPatientId, setSelectedPatientId] = useState<string>("");
  const [billingDraft, setBillingDraft] = useState<{
    patientId: string;
    description: string;
    amountRupees: string;
  } | null>(null);

  // Patient 360° modal state
  const [activePatientId, setActivePatientId] = useState<string | null>(null);
  const [activePatientDetail, setActivePatientDetail] = useState<any | null>(null);
  const [loadingPatientDetail, setLoadingPatientDetail] = useState(false);
  const [patientModalTab, setPatientModalTab] = useState<"overview" | "edit">("overview");

  // Prescription print preview modal
  const [printPrescription, setPrintPrescription] = useState<any | null>(null);

  // Toast stack
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const toastCounter = useRef(0);
  const searchRequest = useRef(0);

  const pushToast = useCallback(
    (text: string, kind: "success" | "error" | "info" = "success") => {
      const id = ++toastCounter.current;
      setToasts((prev) => [...prev, { id, text, kind }]);
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 4200);
    },
    []
  );

  useEffect(() => {
    setMounted(true);
    try {
      const saved = localStorage.getItem("theme");
      const isDark = saved
        ? saved === "dark"
        : window.matchMedia("(prefers-color-scheme: dark)").matches;
      setDark(isDark);
      document.documentElement.classList.toggle("dark", isDark);
    } catch {}
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    try {
      document.documentElement.classList.toggle("dark", next);
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {}
  };

  const refreshDashboard = useCallback(async () => {
    try {
      const r = await fetch("/api/dashboard");
      if (r.ok) {
        const data = await r.json();
        setDash(data);
      }
    } catch {}
  }, []);

  const loadPatients = useCallback(async (query = "") => {
    const request = ++searchRequest.current;
    setSearching(true);
    setSearchError("");
    try {
      const r = await fetch("/api/patients?q=" + encodeURIComponent(query), {
        signal: AbortSignal.timeout(8_000),
      });
      if (!r.ok) throw new Error("Search is temporarily unavailable.");
      const records = await r.json();
      if (request === searchRequest.current) setPatients(records);
    } catch {
      if (request === searchRequest.current) {
        setSearchError("Search could not be completed. Please retry.");
      }
    } finally {
      if (request === searchRequest.current) setSearching(false);
    }
  }, []);

  useEffect(() => {
    refreshDashboard();
    loadPatients();
  }, [refreshDashboard, loadPatients]);

  useEffect(() => {
    if (page !== "Patients") return;
    const timer = window.setTimeout(() => loadPatients(q), 220);
    return () => window.clearTimeout(timer);
  }, [q, page, loadPatients]);

  const openPatientDetail = useCallback(
    async (id: string, initialTab: "overview" | "edit" = "overview") => {
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
    },
    [pushToast]
  );

  async function sync() {
    if (syncing) return;
    setSyncing(true);
    try {
      const r = await fetch("/api/sync", { method: "POST" });
      const d = await r.json();
      const count = d.synced || 0;
      if (d.failedCount > 0 && count === 0) {
        const msg = d.lastError
          ? `Sync encountered an issue: ${d.lastError}`
          : `0 records synchronized (${d.failedCount} failed, queued for retry).`;
        setMessage(msg);
        pushToast(msg, "error");
      } else {
        const msg = `${count} record${count === 1 ? "" : "s"} synchronized${
          d.pending ? ` · ${d.pending} pending` : ""
        }.`;
        setMessage(msg);
        pushToast(msg, "success");
      }
      await refreshDashboard();
    } catch {
      const msg = "Unable to reach synchronization endpoint.";
      setMessage(msg);
      pushToast(msg, "error");
    } finally {
      setSyncing(false);
    }
  }

  async function signOut() {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.reload();
    } catch {
      pushToast("Unable to sign out. Please try again.", "error");
    }
  }

  const formattedDate = useMemo(() => {
    if (!mounted) return "DENTALCARE WORKSPACE";
    return new Intl.DateTimeFormat("en-IN", {
      weekday: "long",
      day: "numeric",
      month: "long",
    })
      .format(new Date())
      .toUpperCase();
  }, [mounted]);

  const greeting = useMemo(() => {
    if (!mounted) return "Welcome back, Dr. Kinjal.";
    const hr = new Date().getHours();
    const prefix =
      hr < 12 ? "Good morning" : hr < 18 ? "Good afternoon" : "Good evening";
    return `${prefix}, Dr. Kinjal.`;
  }, [mounted]);

  function navigateWithPatient(targetPage: string, patientId?: string) {
    if (patientId) setSelectedPatientId(patientId);
    setActivePatientId(null);
    setPage(targetPage);
  }

  function Header({
    title,
    subtitle,
    children,
  }: {
    title: string;
    subtitle?: string;
    children?: React.ReactNode;
  }) {
    return (
      <div className="topbar">
        <div>
          <p className="eyebrow">
            {page === "Dashboard" ? formattedDate : "DENTALCARE WORKSPACE"}
          </p>
          <h1 className="title">{title}</h1>
          <p className="sub">
            {subtitle ||
              (page === "Dashboard"
                ? greeting
                : "Everything stays securely on this device first.")}
          </p>
        </div>
        <div className="toolbar">
          <button
            className="iconbtn"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={dark ? "Switch to light mode" : "Switch to dark mode"}
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          {children}
        </div>
      </div>
    );
  }

  function Dashboard() {
    const metrics = [
      ["Total patients", dash?.patients ?? "—", Users, "Patients"],
      ["Today’s appointments", dash?.today ?? "—", CalendarDays, "Appointments"],
      ["Completed", dash?.completed ?? "—", CheckCircle2, "Appointments"],
      ["Upcoming", dash?.upcoming ?? "—", Clock, "Appointments"],
      [
        "Pending payments",
        dash ? money(dash.pending) : "—",
        CircleDollarSign,
        "Billing",
      ],
      ["Follow-ups due", dash?.followups ?? "—", ClipboardList, "Follow-ups"],
    ];

    async function quickAppointmentStatus(id: string, status: string) {
      const r = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) {
        pushToast(`Appointment marked as ${status.toLowerCase()}.`);
        refreshDashboard();
      } else {
        pushToast("Could not update appointment status.", "error");
      }
    }

    const scheduleList = dash?.recent?.length
      ? dash.recent
      : dash?.upcomingAppointments || [];
    const showingUpcomingFallback =
      !dash?.recent?.length && (dash?.upcomingAppointments?.length || 0) > 0;

    return (
      <>
        <Header title="Your practice, in view.">
          <button className="btn" onClick={() => setPage("Appointments")}>
            <CalendarDays size={15} /> Schedule
          </button>
          <button
            className="btn primary"
            onClick={() => setPage("Add patient")}
          >
            <Plus size={16} /> New patient
          </button>
        </Header>

        <div className="metrics">
          {metrics.map(([l, v, I, targetPage]: any) => (
            <div
              className="metric"
              key={l}
              onClick={() => setPage(targetPage)}
              style={{ cursor: "pointer" }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") setPage(targetPage);
              }}
            >
              <div className="label">
                <span>{l}</span>
                <span className="label-icon">
                  <I size={15} />
                </span>
              </div>
              <b>{v}</b>
            </div>
          ))}
        </div>

        <div className="grid">
          <section className="card">
            <div className="card-header">
              <div>
                <h2>
                  {showingUpcomingFallback
                    ? "Upcoming schedule"
                    : "Today’s schedule"}
                </h2>
                {showingUpcomingFallback && (
                  <p className="sub" style={{ fontSize: 12.5 }}>
                    No visits remaining today · showing next scheduled appointments
                  </p>
                )}
              </div>
              <button
                className="btn sm subtle"
                onClick={() => setPage("Appointments")}
              >
                View all <ChevronRight size={14} />
              </button>
            </div>

            <div className="schedule">
              {scheduleList.length ? (
                scheduleList.map((a: any) => (
                  <div className="appointment" key={a.id}>
                    <span className="time">
                      {showingUpcomingFallback && (
                        <>
                          {new Date(a.startsAt).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                          })}
                          <br />
                        </>
                      )}
                      {new Date(a.startsAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        a.patient?.id && openPatientDetail(a.patient.id)
                      }
                    >
                      <span className="avatar">
                        {a.patient?.firstName?.[0]}
                        {a.patient?.lastName?.[0]}
                      </span>
                      <b>
                        {a.patient?.firstName} {a.patient?.lastName}
                      </b>
                      <div className="sub">
                        {a.type} · {a.patient?.patientId}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      <span
                        className={`status ${String(a.status || "").toLowerCase()}`}
                      >
                        {a.status}
                      </span>
                      {a.status !== "COMPLETED" && a.status !== "CANCELLED" && (
                        <button
                          type="button"
                          className="iconbtn"
                          title="Mark completed"
                          aria-label="Mark appointment completed"
                          onClick={() =>
                            quickAppointmentStatus(a.id, "COMPLETED")
                          }
                          style={{ padding: "5px 8px", minHeight: 30 }}
                        >
                          <Check size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">
                  No appointments scheduled today.
                  <div style={{ marginTop: 12 }}>
                    <button
                      className="btn sm subtle"
                      onClick={() => setPage("Appointments")}
                    >
                      <Plus size={14} /> Book an appointment
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>

          <section className="card">
            <h2>Quick actions</h2>
            <div className="actions">
              {[
                [Users, "Register patient", "Add patient"],
                [CalendarDays, "Book appointment", "Appointments"],
                [Activity, "Treatment record", "Treatments"],
                [FileText, "Prescription", "Prescriptions"],
                [CircleDollarSign, "Record payment", "Billing"],
              ].map(([I, label, to]: any) => {
                const Icon = I;
                return (
                  <button
                    className="action"
                    onClick={() => setPage(to)}
                    key={label}
                  >
                    <Icon size={20} />
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                marginTop: 22,
                paddingTop: 18,
                borderTop: "1px solid var(--line)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <b>Google Sheets</b>
                  {dash?.syncStatus && (
                    <span
                      className={`status ${
                        dash.syncStatus.failed > 0
                          ? "failed"
                          : dash.syncStatus.pending > 0
                          ? "pending"
                          : "synced"
                      }`}
                    >
                      {dash.syncStatus.pending > 0
                        ? `${dash.syncStatus.pending} Pending`
                        : dash.syncStatus.failed > 0
                        ? `${dash.syncStatus.failed} Retry`
                        : `${dash.syncStatus.synced} Synced`}
                    </span>
                  )}
                </div>
                <div className="sub">Local data remains authoritative</div>
              </div>
              <button className="btn" onClick={sync} disabled={syncing}>
                <RefreshCw size={15} className={syncing ? "spin" : ""} />
                {syncing ? "Syncing…" : "Sync now"}
              </button>
            </div>
            {message && (
              <p
                className="sub"
                style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  borderRadius: 10,
                  background: "var(--soft)",
                  color: "var(--ink)",
                }}
              >
                {message}
              </p>
            )}

            {dash?.dueFollowUps && dash.dueFollowUps.length > 0 && (
              <div
                style={{
                  marginTop: 20,
                  paddingTop: 16,
                  borderTop: "1px solid var(--line)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <b style={{ fontSize: 13.5 }}>Pending follow-ups</b>
                  <button
                    className="btn sm subtle"
                    onClick={() => setPage("Follow-ups")}
                  >
                    Manage
                  </button>
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  {dash.dueFollowUps.slice(0, 3).map((f: any) => (
                    <div
                      key={f.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "8px 11px",
                        borderRadius: 10,
                        background: "var(--surface-subtle)",
                        border: "1px solid var(--line)",
                        fontSize: 13,
                      }}
                    >
                      <div>
                        <b>
                          {f.patient?.firstName} {f.patient?.lastName}
                        </b>{" "}
                        <span className="sub">· {f.reason}</span>
                      </div>
                      <span className="time">
                        {new Date(f.dueDate).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </div>
      </>
    );
  }

  function Patients() {
    return (
      <>
        <Header
          title="Patients"
          subtitle="Search, inspect clinical histories, or register a new patient record."
        >
          <button
            className="btn primary"
            onClick={() => setPage("Add patient")}
          >
            <Plus size={16} /> Add patient
          </button>
        </Header>

        <section className="card">
          <div className="toolbar" style={{ marginBottom: 16 }}>
            <div
              style={{
                position: "relative",
                flex: 1,
                display: "flex",
                alignItems: "center",
              }}
            >
              <Search
                size={17}
                style={{
                  position: "absolute",
                  left: 13,
                  color: "var(--muted)",
                  pointerEvents: "none",
                }}
              />
              <input
                className="search"
                aria-label="Search patients"
                placeholder="Search name, ID, phone or email"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                style={{ paddingLeft: 38, paddingRight: q ? 36 : 13 }}
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ("")}
                  aria-label="Clear search"
                  style={{
                    position: "absolute",
                    right: 10,
                    border: 0,
                    background: "transparent",
                    color: "var(--muted)",
                    cursor: "pointer",
                  }}
                >
                  <X size={15} />
                </button>
              )}
            </div>
            {searching && (
              <LoaderCircle
                className="spin"
                size={18}
                aria-label="Searching"
                style={{ color: "var(--blue)" }}
              />
            )}
            <span className="sub" style={{ fontSize: 12.5 }}>
              {patients.length} {patients.length === 1 ? "patient" : "patients"}
            </span>
          </div>

          {searchError && (
            <p className="auth-error" role="alert" style={{ marginBottom: 14 }}>
              {searchError}
            </p>
          )}

          <div className="table-wrap" aria-busy={searching}>
            <table className="table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>ID</th>
                  <th>Phone</th>
                  <th>Clinical Alerts</th>
                  <th>Registered</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {patients.length ? (
                  patients.map((p) => {
                    const hasAllergy =
                      p.allergies &&
                      !["none", "none known", "nil", "n/a"].includes(
                        String(p.allergies).trim().toLowerCase()
                      );
                    return (
                      <tr
                        key={p.id}
                        className="clickable"
                        onClick={() => openPatientDetail(p.id)}
                      >
                        <td>
                          <div style={{ display: "flex", alignItems: "center" }}>
                            <span className="avatar">
                              {p.firstName?.[0]}
                              {p.lastName?.[0]}
                            </span>
                            <div>
                              <b>
                                {p.firstName} {p.lastName}
                              </b>
                              <div className="sub">
                                {p.email || "No email"}
                                {p.city ? ` · ${p.city}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <span
                            style={{
                              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                              fontSize: 12.5,
                              fontWeight: 600,
                            }}
                          >
                            {p.patientId}
                          </span>
                          {p.referenceId && (
                            <div className="sub" style={{ fontSize: 11.5 }}>
                              Ref: {p.referenceId}
                            </div>
                          )}
                        </td>
                        <td>{p.phone}</td>
                        <td>
                          {hasAllergy ? (
                            <span className="status overdue">
                              Allergy: {p.allergies}
                            </span>
                          ) : p.conditions &&
                            !["none", "nil"].includes(
                              String(p.conditions).trim().toLowerCase()
                            ) ? (
                            <span className="status pending">
                              {p.conditions}
                            </span>
                          ) : (
                            <span className="sub" style={{ fontSize: 12.5 }}>
                              None noted
                            </span>
                          )}
                        </td>
                        <td>
                          {new Date(p.registeredAt).toLocaleDateString("en-IN")}
                        </td>
                        <td
                          style={{ textAlign: "right" }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div
                            style={{
                              display: "inline-flex",
                              gap: 6,
                              alignItems: "center",
                            }}
                          >
                            <button
                              type="button"
                              className="btn sm subtle"
                              onClick={() => openPatientDetail(p.id)}
                              aria-label={`Actions for ${p.firstName} ${p.lastName}`}
                            >
                              <Eye size={14} /> Profile
                            </button>
                            <button
                              type="button"
                              className="iconbtn"
                              title="Edit patient"
                              aria-label={`Edit ${p.firstName} ${p.lastName}`}
                              onClick={() => openPatientDetail(p.id, "edit")}
                              style={{ minHeight: 31, padding: "4px 8px" }}
                            >
                              <MoreHorizontal size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={6} className="empty">
                      {searching
                        ? "Searching patients…"
                        : q
                        ? "No matching patients. Try a name, ID, phone, or email."
                        : "No patients found. Register your first patient to begin."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  }

  function AddPatient() {
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState("");
    const [duplicateId, setDuplicateId] = useState<string | null>(null);

    async function create(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setSubmitting(true);
      setFormError("");
      setDuplicateId(null);

      const f = new FormData(e.currentTarget);
      const data = Object.fromEntries(f);
      try {
        const r = await fetch("/api/patients", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ...data,
            consented: f.get("consented") === "on",
          }),
        });
        const payload = await r.json().catch(() => ({}));
        if (r.ok) {
          const msg =
            "Patient saved locally and queued for secure synchronization.";
          setMessage(msg);
          pushToast(msg, "success");
          await Promise.all([loadPatients(), refreshDashboard()]);
          setPage("Patients");
        } else {
          setFormError(payload.error || "Unable to register patient.");
          if (r.status === 409 && payload.patient?.id) {
            setDuplicateId(payload.patient.id);
          }
          pushToast(payload.error || "Please check required fields.", "error");
        }
      } catch {
        setFormError("Network error while saving patient.");
      } finally {
        setSubmitting(false);
      }
    }

    return (
      <>
        <Header
          title="Register a patient"
          subtitle="Create an authoritative local clinical record and queue for Google Sheets sync."
        >
          <button className="btn" onClick={() => setPage("Patients")}>
            Back to patients
          </button>
        </Header>

        <form className="card" onSubmit={create}>
          <h2>Personal information</h2>
          <div className="form-grid">
            <label className="field">
              First name *
              <input name="firstName" placeholder="e.g. Aarav" required />
            </label>
            <label className="field">
              Last name *
              <input name="lastName" placeholder="e.g. Mehta" required />
            </label>
            <label className="field">
              Phone number *
              <input
                name="phone"
                placeholder="+91 98765 43210"
                required
              />
            </label>
            <label className="field">
              Email
              <input
                name="email"
                type="email"
                placeholder="patient@example.com"
              />
            </label>
            <label className="field">
              Date of birth
              <input name="dateOfBirth" type="date" />
            </label>
            <label className="field">
              Gender
              <select name="gender" defaultValue="">
                <option value="">Select gender</option>
                <option value="Female">Female</option>
                <option value="Male">Male</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <label className="field">
              City
              <input name="city" placeholder="e.g. Ahmedabad" />
            </label>
            <label className="field">
              External Reference ID (Optional)
              <input
                name="referenceId"
                placeholder="Optional chart or legacy file number"
              />
            </label>
          </div>

          <h2 style={{ marginTop: 28 }}>Clinical history</h2>
          <div className="form-grid">
            <label className="field">
              Known allergies
              <textarea
                name="allergies"
                placeholder="Record only information confirmed by the patient (e.g. Penicillin, Latex, None known)"
              />
            </label>
            <label className="field">
              Medical conditions
              <textarea
                name="conditions"
                placeholder="e.g. Hypertension, Type 2 diabetes, Asthma"
              />
            </label>
            <label className="field">
              Dental history
              <textarea
                name="dentalHistory"
                placeholder="Previous dental surgeries, restorations, or sensitivity notes"
              />
            </label>
            <label className="field">
              Informed Consent
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--line-strong)",
                  background: "var(--bg)",
                  marginTop: 2,
                }}
              >
                <input
                  type="checkbox"
                  name="consented"
                  defaultChecked
                  style={{ width: 18, height: 18 }}
                />
                <span className="sub" style={{ color: "var(--ink)" }}>
                  Patient informed consent recorded for examination and local
                  clinical charting
                </span>
              </div>
            </label>
          </div>

          {formError && (
            <div
              className="auth-error"
              role="alert"
              style={{
                marginTop: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
              }}
            >
              <span>{formError}</span>
              {duplicateId && (
                <button
                  type="button"
                  className="btn sm"
                  onClick={() => openPatientDetail(duplicateId)}
                >
                  Open Existing Patient
                </button>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 25,
            }}
          >
            <button
              type="button"
              className="btn"
              onClick={() => setPage("Patients")}
            >
              Cancel
            </button>
            <button className="btn primary" disabled={submitting}>
              {submitting ? "Saving…" : "Save patient"}
            </button>
          </div>
        </form>
      </>
    );
  }

  function AppointmentsModule() {
    const [appointments, setAppointments] = useState<any[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [notice, setNotice] = useState("");
    const [isError, setIsError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [filter, setFilter] = useState<
      "ALL" | "UPCOMING" | "TODAY" | "COMPLETED" | "CANCELLED"
    >("ALL");

    const defaultStart = useMemo(() => {
      const d = new Date();
      d.setMinutes(0, 0, 0);
      d.setHours(d.getHours() + 1);
      return toLocalDatetimeInputValue(d);
    }, []);

    const defaultEnd = useMemo(() => {
      const d = new Date();
      d.setMinutes(30, 0, 0);
      d.setHours(d.getHours() + 1);
      return toLocalDatetimeInputValue(d);
    }, []);

    const [startsAtInput, setStartsAtInput] = useState(defaultStart);
    const [endsAtInput, setEndsAtInput] = useState(defaultEnd);

    const fetchAppointments = useCallback(async () => {
      setLoadingList(true);
      try {
        const r = await fetch("/api/appointments");
        if (r.ok) {
          setAppointments(await r.json());
        }
      } finally {
        setLoadingList(false);
      }
    }, []);

    useEffect(() => {
      fetchAppointments();
    }, [fetchAppointments]);

    function handleStartChange(val: string) {
      setStartsAtInput(val);
      const startDate = new Date(val);
      const endDate = new Date(endsAtInput);
      if (
        !Number.isNaN(startDate.getTime()) &&
        (Number.isNaN(endDate.getTime()) || endDate <= startDate)
      ) {
        const nextEnd = new Date(startDate.getTime() + 30 * 60_000);
        setEndsAtInput(toLocalDatetimeInputValue(nextEnd));
      }
    }

    async function submit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setSaving(true);
      setNotice("");
      setIsError(false);

      const f = new FormData(e.currentTarget);
      const startIso = safeIsoFromInput(String(f.get("startsAt") || ""));
      const endIso = safeIsoFromInput(String(f.get("endsAt") || ""));

      if (!startIso || !endIso) {
        setIsError(true);
        setNotice("Please provide valid start and end times.");
        setSaving(false);
        return;
      }

      const data = {
        patientId: f.get("patientId"),
        type: f.get("type"),
        startsAt: startIso,
        endsAt: endIso,
        complaint: f.get("complaint") || undefined,
        plannedTreatment: f.get("plannedTreatment") || undefined,
        notes: f.get("notes") || undefined,
      };

      try {
        const r = await fetch("/api/appointments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await r.json().catch(() => ({}));
        if (!r.ok) {
          setIsError(true);
          setNotice(result.error || "Unable to save appointment.");
          pushToast(result.error || "Unable to save appointment.", "error");
          return;
        }
        setAppointments((current) =>
          [result, ...current].sort(
            (a, b) =>
              new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
          )
        );
        setIsError(false);
        setNotice("Appointment booked.");
        pushToast("Appointment booked and queued for sync.");
        refreshDashboard();
      } catch {
        setIsError(true);
        setNotice("Network error while booking appointment.");
      } finally {
        setSaving(false);
      }
    }

    async function updateStatus(id: string, status: string) {
      const r = await fetch(`/api/appointments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) {
        const updated = await r.json();
        setAppointments((prev) =>
          prev.map((a) => (a.id === id ? updated : a))
        );
        pushToast(`Appointment marked as ${status.toLowerCase()}.`);
        refreshDashboard();
      } else {
        pushToast("Could not update appointment.", "error");
      }
    }

    const filteredAppointments = useMemo(() => {
      const now = new Date();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);

      return appointments.filter((a) => {
        const start = new Date(a.startsAt);
        if (filter === "TODAY") return start >= todayStart && start < todayEnd;
        if (filter === "UPCOMING")
          return (
            start >= now && !["COMPLETED", "CANCELLED"].includes(a.status)
          );
        if (filter === "COMPLETED") return a.status === "COMPLETED";
        if (filter === "CANCELLED") return a.status === "CANCELLED";
        return true;
      });
    }, [appointments, filter]);

    return (
      <>
        <Header
          title="Appointments"
          subtitle="Chairside scheduling with automatic conflict detection and status tracking."
        />
        <div className="grid">
          <form className="card" onSubmit={submit}>
            <h2>Book an appointment</h2>
            <div className="form-grid">
              <label className="field">
                Patient *
                <select
                  name="patientId"
                  defaultValue={selectedPatientId}
                  required
                >
                  <option value="">Select patient</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} · {p.patientId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Visit type *
                <select name="type" defaultValue="Consultation">
                  <option>Consultation</option>
                  <option>Dental Cleaning</option>
                  <option>Root Canal</option>
                  <option>Crown & Bridge</option>
                  <option>Tooth Extraction</option>
                  <option>Orthodontic Adjustment</option>
                  <option>Follow-up</option>
                  <option>Emergency Visit</option>
                </select>
              </label>
              <label className="field">
                Start *
                <input
                  name="startsAt"
                  type="datetime-local"
                  value={startsAtInput}
                  onChange={(e) => handleStartChange(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                End *
                <input
                  name="endsAt"
                  type="datetime-local"
                  value={endsAtInput}
                  onChange={(e) => setEndsAtInput(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                Complaint
                <textarea
                  name="complaint"
                  placeholder="Chief complaint or reason for visit"
                />
              </label>
              <label className="field">
                Planned treatment
                <textarea
                  name="plannedTreatment"
                  placeholder="Chairside plan or preparation notes"
                />
              </label>
            </div>
            {notice && (
              <p
                className={isError ? "auth-error" : "banner-success"}
                role="status"
                style={{ marginTop: 16 }}
              >
                {notice}
              </p>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                marginTop: 18,
              }}
            >
              <button className="btn primary" disabled={saving}>
                {saving ? "Booking…" : "Book appointment"}
              </button>
            </div>
          </form>

          <section className="card">
            <div className="card-header">
              <h2>Scheduled appointments</h2>
              <div className="segmented">
                {(
                  [
                    ["ALL", "All"],
                    ["UPCOMING", "Upcoming"],
                    ["TODAY", "Today"],
                    ["COMPLETED", "Done"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={filter === key ? "active" : ""}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="schedule">
              {loadingList ? (
                <div className="empty">Loading schedule…</div>
              ) : filteredAppointments.length ? (
                filteredAppointments.map((a) => (
                  <div className="appointment" key={a.id}>
                    <span className="time">
                      {new Date(a.startsAt).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                      <br />
                      {new Date(a.startsAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        a.patient?.id && openPatientDetail(a.patient.id)
                      }
                    >
                      <b>
                        {a.patient?.firstName} {a.patient?.lastName}
                      </b>
                      <div className="sub">
                        {a.type}
                        {a.complaint ? ` · ${a.complaint}` : ""}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      <span
                        className={`status ${String(
                          a.status || ""
                        ).toLowerCase()}`}
                      >
                        {a.status}
                      </span>
                      {a.status !== "COMPLETED" && a.status !== "CANCELLED" && (
                        <>
                          <button
                            type="button"
                            className="btn sm subtle"
                            onClick={() => updateStatus(a.id, "COMPLETED")}
                            title="Mark visit completed"
                          >
                            Complete
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => updateStatus(a.id, "CANCELLED")}
                            title="Cancel appointment"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">No appointments in this view.</div>
              )}
            </div>
          </section>
        </div>
      </>
    );
  }

  function TreatmentsModule() {
    const [treatments, setTreatments] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState("");
    const [isError, setIsError] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string>("ALL");

    const fetchTreatments = useCallback(async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/treatments");
        if (r.ok) setTreatments(await r.json());
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      fetchTreatments();
    }, [fetchTreatments]);

    async function submit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setSaving(true);
      setNotice("");
      setIsError(false);

      const f = new FormData(e.currentTarget);
      const costPaise = parseRupeesToPaise(String(f.get("cost") || "0"));
      const dateIso = safeIsoFromInput(String(f.get("date") || ""));

      if (costPaise === null) {
        setIsError(true);
        setNotice("Please enter a valid treatment cost in ₹.");
        setSaving(false);
        return;
      }

      const data = {
        patientId: String(f.get("patientId") || ""),
        category: String(f.get("category") || ""),
        procedure: String(f.get("procedure") || ""),
        toothNumber: String(f.get("toothNumber") || "") || undefined,
        description: String(f.get("description") || "") || undefined,
        costPaise,
        status: String(f.get("status") || "PLANNED"),
        date: dateIso || new Date().toISOString(),
      };

      try {
        const r = await fetch("/api/treatments", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        });
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || "Unable to save treatment.");
        setTreatments((prev) => [result, ...prev]);
        e.currentTarget.reset();
        const msg = "Treatment saved locally and queued for sync.";
        setNotice(msg);
        pushToast(msg);
        refreshDashboard();
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unable to save record.";
        setIsError(true);
        setNotice(msg);
        pushToast(msg, "error");
      } finally {
        setSaving(false);
      }
    }

    async function updateTreatmentStatus(id: string, status: string) {
      const r = await fetch(`/api/treatments/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) {
        const updated = await r.json();
        setTreatments((prev) =>
          prev.map((t) => (t.id === id ? updated : t))
        );
        pushToast(`Treatment marked as ${status.toLowerCase()}.`);
      } else {
        pushToast("Unable to update treatment status.", "error");
      }
    }

    const filtered = treatments.filter((t) =>
      statusFilter === "ALL" ? true : t.status === statusFilter
    );

    return (
      <>
        <Header
          title="Treatments"
          subtitle="Record dental procedures, tooth numbers, clinical notes, and treatment progress."
        />
        <div className="grid">
          <form className="card" onSubmit={submit}>
            <h2>New Treatment</h2>
            <div className="form-grid">
              <label className="field">
                Patient *
                <select
                  name="patientId"
                  defaultValue={selectedPatientId}
                  required
                >
                  <option value="">Select patient</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} · {p.patientId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Treatment category *
                <input
                  name="category"
                  list="dental-categories"
                  placeholder="e.g. Endodontics, Restorative"
                  required
                />
                <datalist id="dental-categories">
                  <option value="Restorative" />
                  <option value="Endodontics" />
                  <option value="Prosthodontics" />
                  <option value="Periodontics" />
                  <option value="Oral Surgery" />
                  <option value="Orthodontics" />
                  <option value="Preventive" />
                  <option value="Cosmetic" />
                </datalist>
              </label>
              <label className="field">
                Procedure *
                <input
                  name="procedure"
                  placeholder="e.g. Composite Restoration / Root Canal"
                  required
                />
              </label>
              <label className="field">
                Tooth number
                <input
                  name="toothNumber"
                  placeholder="e.g. #16, 24, Upper Right Molar"
                />
              </label>
              <label className="field">
                Date *
                <input
                  name="date"
                  type="datetime-local"
                  defaultValue={toLocalDatetimeInputValue()}
                  required
                />
              </label>
              <label className="field">
                Cost (₹) *
                <input
                  name="cost"
                  inputMode="decimal"
                  defaultValue="0"
                  required
                />
              </label>
              <label className="field">
                Status
                <select name="status" defaultValue="PLANNED">
                  <option value="PLANNED">PLANNED</option>
                  <option value="IN_PROGRESS">IN_PROGRESS</option>
                  <option value="COMPLETED">COMPLETED</option>
                </select>
              </label>
              <label className="field">
                Clinical description
                <textarea
                  name="description"
                  placeholder="Anesthesia, materials used, canal length, or post-op notes"
                />
              </label>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginTop: 22,
              }}
            >
              {notice ? (
                <span
                  className={isError ? "auth-error" : "sub"}
                  role="status"
                  style={{ marginTop: 0 }}
                >
                  {notice}
                </span>
              ) : (
                <span />
              )}
              <button className="btn primary" disabled={saving}>
                {saving ? "Saving…" : "Save record"}
              </button>
            </div>
          </form>

          <section className="card">
            <div className="card-header">
              <h2>Treatment records</h2>
              <div className="segmented">
                {["ALL", "PLANNED", "IN_PROGRESS", "COMPLETED"].map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={statusFilter === st ? "active" : ""}
                    onClick={() => setStatusFilter(st)}
                  >
                    {st === "ALL"
                      ? "All"
                      : st === "IN_PROGRESS"
                      ? "In Progress"
                      : st.charAt(0) + st.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="schedule">
              {loading ? (
                <div className="empty">Loading treatments…</div>
              ) : filtered.length ? (
                filtered.map((t) => (
                  <div className="appointment" key={t.id}>
                    <span className="time">
                      {new Date(t.date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })}
                      <br />
                      <b>{money(t.costPaise)}</b>
                    </span>
                    <div
                      style={{ cursor: "pointer" }}
                      onClick={() =>
                        t.patient?.id && openPatientDetail(t.patient.id)
                      }
                    >
                      <b>
                        {t.procedure}{" "}
                        {t.toothNumber ? `(Tooth ${t.toothNumber})` : ""}
                      </b>
                      <div className="sub">
                        {t.patient?.firstName} {t.patient?.lastName} ·{" "}
                        {t.category}
                        {t.description ? ` — ${t.description}` : ""}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        flexWrap: "wrap",
                        justifyContent: "flex-end",
                      }}
                    >
                      <span
                        className={`status ${String(t.status).toLowerCase()}`}
                      >
                        {t.status}
                      </span>
                      {t.status !== "COMPLETED" && (
                        <button
                          type="button"
                          className="btn sm subtle"
                          onClick={() =>
                            updateTreatmentStatus(t.id, "COMPLETED")
                          }
                        >
                          Complete
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn sm"
                        title="Create invoice from treatment"
                        onClick={() => {
                          setBillingDraft({
                            patientId: t.patientId,
                            description: `${t.category}: ${t.procedure}${
                              t.toothNumber ? ` (Tooth ${t.toothNumber})` : ""
                            }`,
                            amountRupees: String((t.costPaise || 0) / 100),
                          });
                          setPage("Billing");
                        }}
                      >
                        Bill
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty">No treatments recorded yet.</div>
              )}
            </div>
          </section>
        </div>
      </>
    );
  }

  function PrescriptionsModule() {
    const [prescriptions, setPrescriptions] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState("");
    const [isError, setIsError] = useState(false);
    const [rxPatientId, setRxPatientId] = useState(selectedPatientId);
    const [rxNotes, setRxNotes] = useState("");
    const [items, setItems] = useState([
      {
        medication: "",
        dosage: "",
        frequency: "",
        duration: "",
        instructions: "",
      },
    ]);

    const fetchPrescriptions = useCallback(async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/prescriptions");
        if (r.ok) setPrescriptions(await r.json());
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      fetchPrescriptions();
    }, [fetchPrescriptions]);

    function updateItem(index: number, field: string, value: string) {
      setItems((prev) =>
        prev.map((item, i) =>
          i === index ? { ...item, [field]: value } : item
        )
      );
    }

    function addPreset(preset: (typeof COMMON_MEDICATIONS)[number]) {
      setItems((prev) => {
        if (
          prev.length === 1 &&
          !prev[0].medication &&
          !prev[0].dosage &&
          !prev[0].frequency
        ) {
          return [
            {
              medication: preset.medication,
              dosage: preset.dosage,
              frequency: preset.frequency,
              duration: preset.duration,
              instructions: preset.instructions,
            },
          ];
        }
        return [
          ...prev,
          {
            medication: preset.medication,
            dosage: preset.dosage,
            frequency: preset.frequency,
            duration: preset.duration,
            instructions: preset.instructions,
          },
        ];
      });
    }

    async function submit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setSaving(true);
      setNotice("");
      setIsError(false);

      const f = new FormData(e.currentTarget);
      const patientId = String(f.get("patientId") || rxPatientId || "");

      const payloadItems = items
        .map((it, idx) => ({
          medication:
            idx === 0 && f.get("medication")
              ? String(f.get("medication"))
              : it.medication,
          dosage:
            idx === 0 && f.get("dosage") ? String(f.get("dosage")) : it.dosage,
          frequency:
            idx === 0 && f.get("frequency")
              ? String(f.get("frequency"))
              : it.frequency,
          duration:
            idx === 0 && f.get("duration")
              ? String(f.get("duration"))
              : it.duration,
          instructions:
            (idx === 0 && f.get("instructions")
              ? String(f.get("instructions"))
              : it.instructions) || undefined,
        }))
        .filter((it) => it.medication.trim());

      try {
        const r = await fetch("/api/prescriptions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientId,
            notes: rxNotes.trim() || undefined,
            date: new Date().toISOString(),
            items: payloadItems,
          }),
        });
        const result = await r.json().catch(() => ({}));
        if (!r.ok)
          throw new Error(result.error || "Unable to save prescription.");
        setPrescriptions((prev) => [result, ...prev]);
        setRxNotes("");
        setItems([
          {
            medication: "",
            dosage: "",
            frequency: "",
            duration: "",
            instructions: "",
          },
        ]);
        const msg = "Prescription saved locally and queued for sync.";
        setNotice(msg);
        pushToast(msg);
        refreshDashboard();
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unable to save record.";
        setIsError(true);
        setNotice(msg);
        pushToast(msg, "error");
      } finally {
        setSaving(false);
      }
    }

    return (
      <>
        <Header
          title="Prescriptions"
          subtitle="Compose multi-medication clinical prescriptions with printable patient instructions."
        />
        <div className="grid">
          <form className="card" onSubmit={submit}>
            <div className="card-header">
              <h2>New Prescription</h2>
              <button
                type="button"
                className="btn sm subtle"
                onClick={() =>
                  setItems((prev) => [
                    ...prev,
                    {
                      medication: "",
                      dosage: "",
                      frequency: "",
                      duration: "",
                      instructions: "",
                    },
                  ])
                }
              >
                <Plus size={14} /> Add medication
              </button>
            </div>

            <div style={{ marginBottom: 16 }}>
              <span className="field-hint" style={{ display: "block", marginBottom: 6 }}>
                Quick-fill common dental medications:
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {COMMON_MEDICATIONS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="btn sm"
                    onClick={() => addPreset(preset)}
                  >
                    + {preset.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="form-grid" style={{ marginBottom: 16 }}>
              <label className="field">
                Patient *
                <select
                  name="patientId"
                  value={rxPatientId}
                  onChange={(e) => setRxPatientId(e.target.value)}
                  required
                >
                  <option value="">Select patient</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} · {p.patientId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Clinical Notes / Diagnosis
                <input
                  name="notes"
                  value={rxNotes}
                  onChange={(e) => setRxNotes(e.target.value)}
                  placeholder="e.g. Post-extraction care · Avoid hot food for 24h"
                />
              </label>
            </div>

            <div style={{ display: "grid", gap: 14 }}>
              {items.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    border: "1px solid var(--line)",
                    background: "var(--surface-subtle)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 10,
                    }}
                  >
                    <b style={{ fontSize: 13 }}>Medication #{idx + 1}</b>
                    {items.length > 1 && (
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() =>
                          setItems((prev) => prev.filter((_, i) => i !== idx))
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="form-grid">
                    <label className="field">
                      Medication *
                      <input
                        name={idx === 0 ? "medication" : undefined}
                        value={item.medication}
                        onChange={(e) =>
                          updateItem(idx, "medication", e.target.value)
                        }
                        placeholder="e.g. Cap. Amoxicillin"
                        required
                      />
                    </label>
                    <label className="field">
                      Dosage *
                      <input
                        name={idx === 0 ? "dosage" : undefined}
                        value={item.dosage}
                        onChange={(e) =>
                          updateItem(idx, "dosage", e.target.value)
                        }
                        placeholder="e.g. 500 mg"
                        required
                      />
                    </label>
                    <label className="field">
                      Frequency *
                      <input
                        name={idx === 0 ? "frequency" : undefined}
                        value={item.frequency}
                        onChange={(e) =>
                          updateItem(idx, "frequency", e.target.value)
                        }
                        placeholder="e.g. 1-0-1 (Twice daily)"
                        required
                      />
                    </label>
                    <label className="field">
                      Duration *
                      <input
                        name={idx === 0 ? "duration" : undefined}
                        value={item.duration}
                        onChange={(e) =>
                          updateItem(idx, "duration", e.target.value)
                        }
                        placeholder="e.g. 5 days"
                        required
                      />
                    </label>
                    <label
                      className="field"
                      style={{ gridColumn: "1 / -1" }}
                    >
                      Instructions
                      <input
                        name={idx === 0 ? "instructions" : undefined}
                        value={item.instructions}
                        onChange={(e) =>
                          updateItem(idx, "instructions", e.target.value)
                        }
                        placeholder="e.g. Take after meals with warm water"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 22,
              }}
            >
              {notice ? (
                <span
                  className={isError ? "auth-error" : "sub"}
                  role="status"
                  style={{ marginTop: 0 }}
                >
                  {notice}
                </span>
              ) : (
                <span />
              )}
              <button className="btn primary" disabled={saving}>
                {saving ? "Saving…" : "Save record"}
              </button>
            </div>
          </form>

          <section className="card">
            <h2>Issued prescriptions</h2>
            <div className="schedule">
              {loading ? (
                <div className="empty">Loading prescriptions…</div>
              ) : prescriptions.length ? (
                prescriptions.map((rx) => (
                  <div className="appointment" key={rx.id}>
                    <span className="time">
                      {new Date(rx.date).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                    <div>
                      <b
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          rx.patient?.id && openPatientDetail(rx.patient.id)
                        }
                      >
                        {rx.patient?.firstName} {rx.patient?.lastName}
                      </b>
                      <div className="sub" style={{ marginTop: 4 }}>
                        {(rx.items || []).map((it: any) => (
                          <div key={it.id} style={{ fontSize: 13 }}>
                            • <b>{it.medication}</b> ({it.dosage}) —{" "}
                            {it.frequency} × {it.duration}
                          </div>
                        ))}
                        {rx.notes && (
                          <div style={{ marginTop: 4, fontStyle: "italic" }}>
                            Note: {rx.notes}
                          </div>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn sm subtle"
                      onClick={() => setPrintPrescription(rx)}
                    >
                      <Printer size={14} /> Rx Sheet
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty">No prescriptions issued yet.</div>
              )}
            </div>
          </section>
        </div>
      </>
    );
  }

  function BillingModule() {
    const [invoices, setInvoices] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState("");
    const [isError, setIsError] = useState(false);
    const [statusFilter, setStatusFilter] = useState<string>("ALL");

    // Invoice form state
    const [invPatientId, setInvPatientId] = useState(
      billingDraft?.patientId || selectedPatientId || ""
    );
    const [discountRupees, setDiscountRupees] = useState("0");
    const [taxRupees, setTaxRupees] = useState("0");
    const [lineItems, setLineItems] = useState([
      {
        description: billingDraft?.description || "",
        quantity: 1,
        amountRupees: billingDraft?.amountRupees || "",
      },
    ]);

    // Payment Modal State
    const [paymentInvoice, setPaymentInvoice] = useState<any | null>(null);
    const [paymentAmountRupees, setPaymentAmountRupees] = useState("");
    const [paymentMethod, setPaymentMethod] = useState<
      "UPI" | "CASH" | "CARD" | "BANK_TRANSFER" | "OTHER"
    >("UPI");
    const [paymentReference, setPaymentReference] = useState("");
    const [paymentNotes, setPaymentNotes] = useState("");
    const [recordingPayment, setRecordingPayment] = useState(false);
    const [paymentError, setPaymentError] = useState("");

    const fetchInvoices = useCallback(async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/invoices");
        if (r.ok) setInvoices(await r.json());
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      fetchInvoices();
    }, [fetchInvoices]);

    const liveTotals = useMemo(() => {
      const subtotalPaise = lineItems.reduce((sum, item) => {
        const unit = parseRupeesToPaise(item.amountRupees || "0") || 0;
        const qty = Math.max(1, Number(item.quantity) || 1);
        return sum + unit * qty;
      }, 0);
      const discPaise = parseRupeesToPaise(discountRupees || "0") || 0;
      const txPaise = parseRupeesToPaise(taxRupees || "0") || 0;
      const netPaise = Math.max(0, subtotalPaise + txPaise - discPaise);
      return { subtotalPaise, discPaise, txPaise, netPaise };
    }, [lineItems, discountRupees, taxRupees]);

    async function submitInvoice(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setSaving(true);
      setNotice("");
      setIsError(false);

      const f = new FormData(e.currentTarget);
      const patientId = String(f.get("patientId") || invPatientId || "");
      const discPaise = parseRupeesToPaise(
        String(f.get("discount") ?? discountRupees)
      );
      const txPaise = parseRupeesToPaise(String(f.get("tax") ?? taxRupees));

      if (discPaise === null || txPaise === null) {
        setIsError(true);
        setNotice("Invalid discount or tax amount.");
        setSaving(false);
        return;
      }

      const parsedItems = lineItems.map((it, idx) => {
        const desc =
          idx === 0 && f.get("description")
            ? String(f.get("description"))
            : it.description;
        const qty =
          idx === 0 && f.get("quantity")
            ? Number(f.get("quantity"))
            : Number(it.quantity);
        const unitPaise = parseRupeesToPaise(
          idx === 0 && f.get("amount")
            ? String(f.get("amount"))
            : String(it.amountRupees)
        );
        return {
          description: desc,
          quantity: qty,
          unitPaise: unitPaise ?? -1,
        };
      });

      if (parsedItems.some((i) => i.unitPaise < 0 || !i.description.trim())) {
        setIsError(true);
        setNotice("Please enter valid descriptions and amounts in ₹.");
        setSaving(false);
        return;
      }

      try {
        const r = await fetch("/api/invoices", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientId,
            discountPaise: discPaise,
            taxPaise: txPaise,
            items: parsedItems,
          }),
        });
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || "Unable to create invoice.");
        setInvoices((prev) => [result, ...prev]);
        setBillingDraft(null);
        setLineItems([{ description: "", quantity: 1, amountRupees: "" }]);
        setDiscountRupees("0");
        setTaxRupees("0");
        const msg = `Invoice ${result.invoiceNumber} saved locally and queued for sync.`;
        setNotice(msg);
        pushToast(msg);
        refreshDashboard();
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unable to save invoice.";
        setIsError(true);
        setNotice(msg);
        pushToast(msg, "error");
      } finally {
        setSaving(false);
      }
    }

    function openPaymentModal(invoice: any) {
      const remainingPaise = Math.max(0, invoice.totalPaise - invoice.paidPaise);
      setPaymentInvoice(invoice);
      setPaymentAmountRupees(String(remainingPaise / 100));
      setPaymentMethod("UPI");
      setPaymentReference("");
      setPaymentNotes("");
      setPaymentError("");
    }

    async function handleRecordPayment(e: React.FormEvent) {
      e.preventDefault();
      if (!paymentInvoice) return;
      setRecordingPayment(true);
      setPaymentError("");

      const amountPaise = parseRupeesToPaise(paymentAmountRupees);
      if (!amountPaise || amountPaise <= 0) {
        setPaymentError("Enter a valid payment amount greater than ₹0.");
        setRecordingPayment(false);
        return;
      }

      try {
        const r = await fetch(`/api/invoices/${paymentInvoice.id}/payments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            amountPaise,
            method: paymentMethod,
            reference: paymentReference.trim() || undefined,
            notes: paymentNotes.trim() || undefined,
          }),
        });
        const result = await r.json().catch(() => ({}));
        if (!r.ok) {
          setPaymentError(result.error || "Unable to record payment.");
          return;
        }
        pushToast(
          `Payment of ${money(amountPaise)} recorded via ${paymentMethod}.`
        );
        setPaymentInvoice(null);
        await Promise.all([fetchInvoices(), refreshDashboard()]);
      } catch {
        setPaymentError("Network error while recording payment.");
      } finally {
        setRecordingPayment(false);
      }
    }

    const filteredInvoices = invoices.filter((inv) =>
      statusFilter === "ALL" ? true : inv.status === statusFilter
    );

    return (
      <>
        <Header
          title="Billing & Invoices"
          subtitle="Create itemized clinical invoices and record UPI, cash, card, or bank transfer payments."
        />

        <div className="grid">
          <form className="card" onSubmit={submitInvoice}>
            <div className="card-header">
              <h2>New Invoice</h2>
              <button
                type="button"
                className="btn sm subtle"
                onClick={() =>
                  setLineItems((prev) => [
                    ...prev,
                    { description: "", quantity: 1, amountRupees: "" },
                  ])
                }
              >
                <Plus size={14} /> Add line item
              </button>
            </div>

            <div className="form-grid" style={{ marginBottom: 16 }}>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Patient *
                <select
                  name="patientId"
                  value={invPatientId}
                  onChange={(e) => setInvPatientId(e.target.value)}
                  required
                >
                  <option value="">Select patient</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} · {p.patientId}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gap: 12, marginBottom: 16 }}>
              {lineItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    border: "1px solid var(--line)",
                    background: "var(--surface-subtle)",
                  }}
                >
                  <div className="form-grid">
                    <label className="field" style={{ gridColumn: "1 / -1" }}>
                      Charge description *
                      <input
                        name={idx === 0 ? "description" : undefined}
                        value={item.description}
                        onChange={(e) =>
                          setLineItems((prev) =>
                            prev.map((it, i) =>
                              i === idx
                                ? { ...it, description: e.target.value }
                                : it
                            )
                          )
                        }
                        placeholder="e.g. Root Canal Treatment (#16) / Ultrasonic Scaling"
                        required
                      />
                    </label>
                    <label className="field">
                      Quantity *
                      <input
                        name={idx === 0 ? "quantity" : undefined}
                        type="number"
                        min="1"
                        max="100"
                        value={item.quantity}
                        onChange={(e) =>
                          setLineItems((prev) =>
                            prev.map((it, i) =>
                              i === idx
                                ? { ...it, quantity: Number(e.target.value) }
                                : it
                            )
                          )
                        }
                        required
                      />
                    </label>
                    <label className="field">
                      Unit Amount (₹) *
                      <input
                        name={idx === 0 ? "amount" : undefined}
                        inputMode="decimal"
                        value={item.amountRupees}
                        onChange={(e) =>
                          setLineItems((prev) =>
                            prev.map((it, i) =>
                              i === idx
                                ? { ...it, amountRupees: e.target.value }
                                : it
                            )
                          )
                        }
                        placeholder="e.g. 2500"
                        required
                      />
                    </label>
                  </div>
                  {lineItems.length > 1 && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        marginTop: 8,
                      }}
                    >
                      <button
                        type="button"
                        className="btn sm danger"
                        onClick={() =>
                          setLineItems((prev) =>
                            prev.filter((_, i) => i !== idx)
                          )
                        }
                      >
                        Remove item
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="form-grid">
              <label className="field">
                Discount (₹)
                <input
                  name="discount"
                  inputMode="decimal"
                  value={discountRupees}
                  onChange={(e) => setDiscountRupees(e.target.value)}
                />
              </label>
              <label className="field">
                Tax / GST (₹)
                <input
                  name="tax"
                  inputMode="decimal"
                  value={taxRupees}
                  onChange={(e) => setTaxRupees(e.target.value)}
                />
              </label>
            </div>

            <div
              style={{
                marginTop: 18,
                padding: "14px 16px",
                borderRadius: 14,
                background: "var(--soft)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                Invoice Total Payable
              </span>
              <b style={{ fontSize: 20 }}>{money(liveTotals.netPaise)}</b>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 20,
              }}
            >
              {notice ? (
                <span
                  className={isError ? "auth-error" : "sub"}
                  role="status"
                  style={{ marginTop: 0 }}
                >
                  {notice}
                </span>
              ) : (
                <span />
              )}
              <button className="btn primary" disabled={saving}>
                {saving ? "Creating…" : "Save record"}
              </button>
            </div>
          </form>

          <section className="card">
            <div className="card-header">
              <h2>Invoices & payments</h2>
              <div className="segmented">
                {["ALL", "PENDING", "PARTIAL", "PAID"].map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={statusFilter === st ? "active" : ""}
                    onClick={() => setStatusFilter(st)}
                  >
                    {st === "ALL"
                      ? "All"
                      : st.charAt(0) + st.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="schedule">
              {loading ? (
                <div className="empty">Loading invoices…</div>
              ) : filteredInvoices.length ? (
                filteredInvoices.map((inv) => {
                  const balancePaise = Math.max(
                    0,
                    inv.totalPaise - inv.paidPaise
                  );
                  return (
                    <div className="appointment" key={inv.id}>
                      <span className="time">
                        <b>{money(inv.totalPaise)}</b>
                        <br />
                        {balancePaise > 0 ? (
                          <span style={{ color: "var(--amber)" }}>
                            Due: {money(balancePaise)}
                          </span>
                        ) : (
                          <span style={{ color: "var(--green)" }}>Settled</span>
                        )}
                      </span>
                      <div>
                        <b
                          style={{ cursor: "pointer" }}
                          onClick={() =>
                            inv.patient?.id && openPatientDetail(inv.patient.id)
                          }
                        >
                          {inv.patient?.firstName} {inv.patient?.lastName}
                        </b>{" "}
                        <span className="sub">· {inv.invoiceNumber}</span>
                        <div className="sub">
                          {(inv.items || [])
                            .map((i: any) => `${i.description} (×${i.quantity})`)
                            .join(", ")}
                        </div>
                        {inv.payments?.length > 0 && (
                          <div
                            style={{
                              marginTop: 4,
                              fontSize: 11.5,
                              color: "var(--muted)",
                            }}
                          >
                            Paid {money(inv.paidPaise)} via{" "}
                            {inv.payments.map((p: any) => p.method).join(", ")}
                          </div>
                        )}
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <span
                          className={`status ${String(inv.status).toLowerCase()}`}
                        >
                          {inv.status}
                        </span>
                        {balancePaise > 0 && (
                          <button
                            type="button"
                            className="btn sm primary"
                            onClick={() => openPaymentModal(inv)}
                          >
                            Record payment
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty">No invoices matching this filter.</div>
              )}
            </div>
          </section>
        </div>

        {paymentInvoice && (
          <div
            className="modal-backdrop"
            onClick={() => setPaymentInvoice(null)}
          >
            <div
              className="modal-panel narrow"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="card-header">
                <div>
                  <p className="eyebrow">RECORD PAYMENT</p>
                  <h2 style={{ fontSize: 22, marginTop: 4 }}>
                    {paymentInvoice.invoiceNumber}
                  </h2>
                </div>
                <button
                  type="button"
                  className="iconbtn"
                  onClick={() => setPaymentInvoice(null)}
                >
                  <X size={16} />
                </button>
              </div>

              <div
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--line)",
                  marginBottom: 18,
                  fontSize: 13.5,
                }}
              >
                <div>
                  Patient:{" "}
                  <b>
                    {paymentInvoice.patient?.firstName}{" "}
                    {paymentInvoice.patient?.lastName}
                  </b>
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: 6,
                  }}
                >
                  <span>Total: {money(paymentInvoice.totalPaise)}</span>
                  <span>Paid: {money(paymentInvoice.paidPaise)}</span>
                  <b>
                    Outstanding:{" "}
                    {money(
                      Math.max(
                        0,
                        paymentInvoice.totalPaise - paymentInvoice.paidPaise
                      )
                    )}
                  </b>
                </div>
              </div>

              <form onSubmit={handleRecordPayment} style={{ display: "grid", gap: 14 }}>
                <label className="field">
                  Amount received (₹) *
                  <input
                    inputMode="decimal"
                    value={paymentAmountRupees}
                    onChange={(e) => setPaymentAmountRupees(e.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  Payment method *
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as any)}
                  >
                    <option value="UPI">UPI</option>
                    <option value="CASH">Cash</option>
                    <option value="CARD">Card</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="OTHER">Other</option>
                  </select>
                </label>
                <label className="field">
                  Transaction / UPI Reference
                  <input
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="Optional UTR or receipt number"
                  />
                </label>
                <label className="field">
                  Notes
                  <input
                    value={paymentNotes}
                    onChange={(e) => setPaymentNotes(e.target.value)}
                    placeholder="Optional payment note"
                  />
                </label>

                {paymentError && (
                  <p className="auth-error" role="alert">
                    {paymentError}
                  </p>
                )}

                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    gap: 10,
                    marginTop: 8,
                  }}
                >
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setPaymentInvoice(null)}
                  >
                    Cancel
                  </button>
                  <button className="btn primary" disabled={recordingPayment}>
                    {recordingPayment ? "Recording…" : "Confirm payment"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </>
    );
  }

  function FollowUpsModule() {
    const [followUps, setFollowUps] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [notice, setNotice] = useState("");
    const [isError, setIsError] = useState(false);
    const [filter, setFilter] = useState<string>("PENDING");

    const defaultDue = useMemo(() => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      d.setHours(10, 0, 0, 0);
      return toLocalDatetimeInputValue(d);
    }, []);

    const fetchFollowUps = useCallback(async () => {
      setLoading(true);
      try {
        const r = await fetch("/api/follow-ups");
        if (r.ok) setFollowUps(await r.json());
      } finally {
        setLoading(false);
      }
    }, []);

    useEffect(() => {
      fetchFollowUps();
    }, [fetchFollowUps]);

    async function submit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      setSaving(true);
      setNotice("");
      setIsError(false);

      const f = new FormData(e.currentTarget);
      const dueIso = safeIsoFromInput(String(f.get("dueDate") || ""));
      if (!dueIso) {
        setIsError(true);
        setNotice("Please provide a valid follow-up due date.");
        setSaving(false);
        return;
      }

      try {
        const r = await fetch("/api/follow-ups", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            patientId: String(f.get("patientId") || ""),
            dueDate: dueIso,
            reason: String(f.get("reason") || ""),
            notes: String(f.get("notes") || "") || undefined,
            status: "PENDING",
          }),
        });
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.error || "Unable to save follow-up.");
        setFollowUps((prev) =>
          [result, ...prev].sort(
            (a, b) =>
              new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
          )
        );
        e.currentTarget.reset();
        const msg = "Follow-up saved locally and queued for sync.";
        setNotice(msg);
        pushToast(msg);
        refreshDashboard();
      } catch (error) {
        const msg =
          error instanceof Error ? error.message : "Unable to save record.";
        setIsError(true);
        setNotice(msg);
        pushToast(msg, "error");
      } finally {
        setSaving(false);
      }
    }

    async function updateFollowUpStatus(id: string, status: string) {
      const r = await fetch(`/api/follow-ups/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (r.ok) {
        const updated = await r.json();
        setFollowUps((prev) =>
          prev.map((f) => (f.id === id ? updated : f))
        );
        pushToast(`Follow-up marked as ${status.toLowerCase()}.`);
        refreshDashboard();
      } else {
        pushToast("Could not update follow-up.", "error");
      }
    }

    const filtered = followUps.filter((f) =>
      filter === "ALL" ? true : f.status === filter
    );

    return (
      <>
        <Header
          title="Follow-ups"
          subtitle="Track post-operative reviews, crown deliveries, suture removals, and recall visits."
        />
        <div className="grid">
          <form className="card" onSubmit={submit}>
            <h2>New Follow-up</h2>
            <div className="form-grid">
              <label className="field">
                Patient *
                <select
                  name="patientId"
                  defaultValue={selectedPatientId}
                  required
                >
                  <option value="">Select patient</option>
                  {patients.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.firstName} {p.lastName} · {p.patientId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Due date *
                <input
                  name="dueDate"
                  type="datetime-local"
                  defaultValue={defaultDue}
                  required
                />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Reason *
                <input
                  name="reason"
                  placeholder="e.g. Suture removal / Crown cementation / Post-RCT review"
                  required
                />
              </label>
              <label className="field" style={{ gridColumn: "1 / -1" }}>
                Notes
                <textarea
                  name="notes"
                  placeholder="Instructions or symptoms to check during recall"
                />
              </label>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginTop: 22,
              }}
            >
              {notice ? (
                <span
                  className={isError ? "auth-error" : "sub"}
                  role="status"
                  style={{ marginTop: 0 }}
                >
                  {notice}
                </span>
              ) : (
                <span />
              )}
              <button className="btn primary" disabled={saving}>
                {saving ? "Saving…" : "Save record"}
              </button>
            </div>
          </form>

          <section className="card">
            <div className="card-header">
              <h2>Follow-up schedule</h2>
              <div className="segmented">
                {["PENDING", "COMPLETED", "ALL"].map((st) => (
                  <button
                    key={st}
                    type="button"
                    className={filter === st ? "active" : ""}
                    onClick={() => setFilter(st)}
                  >
                    {st === "ALL"
                      ? "All"
                      : st.charAt(0) + st.slice(1).toLowerCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="schedule">
              {loading ? (
                <div className="empty">Loading follow-ups…</div>
              ) : filtered.length ? (
                filtered.map((f) => {
                  const isOverdue =
                    f.status === "PENDING" &&
                    new Date(f.dueDate).getTime() <= Date.now();
                  return (
                    <div className="appointment" key={f.id}>
                      <span className="time">
                        {new Date(f.dueDate).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                        })}
                        <br />
                        {isOverdue && (
                          <b style={{ color: "var(--red)" }}>Due now</b>
                        )}
                      </span>
                      <div
                        style={{ cursor: "pointer" }}
                        onClick={() =>
                          f.patient?.id && openPatientDetail(f.patient.id)
                        }
                      >
                        <b>
                          {f.patient?.firstName} {f.patient?.lastName}
                        </b>
                        <div className="sub">
                          {f.reason}
                          {f.notes ? ` · ${f.notes}` : ""}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                        }}
                      >
                        <span
                          className={`status ${
                            isOverdue
                              ? "overdue"
                              : String(f.status).toLowerCase()
                          }`}
                        >
                          {isOverdue ? "DUE" : f.status}
                        </span>
                        {f.status === "PENDING" && (
                          <button
                            type="button"
                            className="btn sm subtle"
                            onClick={() =>
                              updateFollowUpStatus(f.id, "COMPLETED")
                            }
                          >
                            <Check size={14} /> Done
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty">No follow-ups in this view.</div>
              )}
            </div>
          </section>
        </div>
      </>
    );
  }

  function ReportsPage() {
    const billing = dash?.billingSummary;
    const collectionRate =
      billing && billing.totalBilledPaise > 0
        ? Math.round(
            (billing.totalCollectedPaise / billing.totalBilledPaise) * 100
          )
        : 100;

    return (
      <>
        <Header
          title="Reports & Practice Analytics"
          subtitle="Real-time clinical volume, revenue collection, and audit metrics computed from SQLite."
        >
          <button className="btn" onClick={refreshDashboard}>
            <RefreshCw size={15} /> Refresh metrics
          </button>
        </Header>

        <div className="metrics">
          {[
            ["Registered patients", dash?.patients ?? 0, Users],
            ["Completed visits", dash?.completed ?? 0, CheckCircle2],
            ["Upcoming visits", dash?.upcoming ?? 0, CalendarDays],
            [
              "Total collected",
              money(billing?.totalCollectedPaise ?? 0),
              CircleDollarSign,
            ],
            ["Outstanding", dash ? money(dash.pending) : money(0), CreditCard],
            ["Treatments logged", dash?.treatmentsCount ?? 0, Activity],
          ].map(([label, value, Icon]: any) => (
            <section className="metric" key={label}>
              <div className="label">
                <span>{label}</span>
                <span className="label-icon">
                  <Icon size={15} />
                </span>
              </div>
              <b>{value}</b>
            </section>
          ))}
        </div>

        <div className="grid">
          <section className="card">
            <h2>Financial & clinical summary</h2>
            <p className="sub" style={{ marginBottom: 18 }}>
              These metrics are calculated directly from authoritative local
              SQLite records.
            </p>
            <div className="schedule">
              <div className="appointment">
                <span className="time">Revenue</span>
                <div>
                  <b>Total Billed Across {billing?.invoicesCount ?? 0} Invoices</b>
                  <div className="sub">
                    Discounts granted: {money(billing?.totalDiscountPaise ?? 0)}
                  </div>
                </div>
                <b>{money(billing?.totalBilledPaise ?? 0)}</b>
              </div>
              <div className="appointment">
                <span className="time">Collected</span>
                <div>
                  <b>Realized Payments Received</b>
                  <div className="sub">Collection efficiency rate</div>
                </div>
                <span className="status completed">{collectionRate}% Collected</span>
              </div>
              <div className="appointment">
                <span className="time">Clinical</span>
                <div>
                  <b>Prescriptions & Chairside Procedures</b>
                  <div className="sub">
                    {dash?.treatmentsCount ?? 0} treatments ·{" "}
                    {dash?.prescriptionsCount ?? 0} prescriptions issued
                  </div>
                </div>
                <span className="status scheduled">Active</span>
              </div>
            </div>
          </section>

          <section className="card">
            <h2>Recent clinical audit log</h2>
            <div className="schedule">
              {dash?.recentAudit?.length ? (
                dash.recentAudit.slice(0, 7).map((log: any) => (
                  <div className="appointment" key={log.id}>
                    <span className="time">
                      {new Date(log.createdAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <div>
                      <b>
                        {log.action} · {log.entity}
                      </b>
                      <div className="sub" style={{ fontSize: 12 }}>
                        Record ID: {log.entityId.slice(0, 12)}…
                      </div>
                    </div>
                    <span className="status synced">Logged</span>
                  </div>
                ))
              ) : (
                <div className="empty">No audit events recorded yet.</div>
              )}
            </div>
          </section>
        </div>
      </>
    );
  }

  function SettingsPage() {
    const [syncDetail, setSyncDetail] = useState<any | null>(null);

    const loadSyncDetail = useCallback(async () => {
      try {
        const r = await fetch("/api/sync");
        if (r.ok) setSyncDetail(await r.json());
      } catch {}
    }, []);

    useEffect(() => {
      loadSyncDetail();
    }, [loadSyncDetail]);

    return (
      <>
        <Header
          title="Settings"
          subtitle="Manage clinic appearance, Google Sheets synchronization queue, and session security."
        >
          <button className="btn danger" onClick={signOut}>
            <LogOut size={15} /> Sign out
          </button>
        </Header>

        <div className="grid">
          <section className="card">
            <h2>Clinic preferences</h2>
            <div className="schedule">
              <div className="appointment">
                <span className="avatar">
                  {dark ? <Moon size={16} /> : <Sun size={16} />}
                </span>
                <div>
                  <b>Appearance</b>
                  <div className="sub">
                    Switch between Apple daylight and dark clinical theme. Your
                    preference stays on this device.
                  </div>
                </div>
                <button className="btn sm" onClick={toggleTheme}>
                  {dark ? "Switch to Light" : "Switch to Dark"}
                </button>
              </div>

              <div className="appointment">
                <span className="avatar">
                  <RefreshCw size={16} />
                </span>
                <div>
                  <b>Synchronization</b>
                  <div className="sub">
                    SQLite remains the source of truth. Google Sheets records
                    are queued and sent idempotently when you choose Sync now.
                  </div>
                </div>
                <button
                  className="btn sm primary"
                  onClick={async () => {
                    await sync();
                    await loadSyncDetail();
                  }}
                  disabled={syncing}
                >
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
              </div>

              <div className="appointment">
                <span className="avatar">
                  <Stethoscope size={16} />
                </span>
                <div>
                  <b>Doctor access</b>
                  <div className="sub">
                    DentalCare is restricted to the configured single-doctor
                    account (Dr. Kinjal) via HTTP-only signed JWT session.
                  </div>
                </div>
                <button className="btn sm danger" onClick={signOut}>
                  Sign out
                </button>
              </div>
            </div>
          </section>

          <section className="card">
            <div className="card-header">
              <h2>Google Sheets sync queue</h2>
              <span
                className={`status ${
                  syncDetail?.configured ? "synced" : "pending"
                }`}
              >
                {syncDetail?.configured
                  ? "Credentials Configured"
                  : "Local Queue Mode"}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: 10,
                marginBottom: 18,
              }}
            >
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--line)",
                }}
              >
                <div className="sub" style={{ fontSize: 12 }}>
                  Synced
                </div>
                <b style={{ fontSize: 20 }}>{syncDetail?.synced ?? "—"}</b>
              </div>
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--line)",
                }}
              >
                <div className="sub" style={{ fontSize: 12 }}>
                  Pending
                </div>
                <b style={{ fontSize: 20 }}>{syncDetail?.pending ?? "—"}</b>
              </div>
              <div
                style={{
                  padding: 12,
                  borderRadius: 12,
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--line)",
                }}
              >
                <div className="sub" style={{ fontSize: 12 }}>
                  Failed / Retry
                </div>
                <b style={{ fontSize: 20 }}>{syncDetail?.failed ?? "—"}</b>
              </div>
            </div>

            {syncDetail?.lastSync && (
              <p className="sub" style={{ fontSize: 12.5, marginBottom: 12 }}>
                Last successful sync:{" "}
                {new Date(syncDetail.lastSync).toLocaleString("en-IN")}
              </p>
            )}

            <div className="schedule">
              {syncDetail?.jobs?.length ? (
                syncDetail.jobs.slice(0, 5).map((job: any) => (
                  <div className="appointment" key={job.id}>
                    <span className="time">{job.entity}</span>
                    <div>
                      <b>{job.operation}</b>
                      <div className="sub" style={{ fontSize: 12 }}>
                        Attempts: {job.attempts}
                        {job.lastError ? ` · ${job.lastError}` : ""}
                      </div>
                    </div>
                    <span
                      className={`status ${String(job.status).toLowerCase()}`}
                    >
                      {job.status}
                    </span>
                  </div>
                ))
              ) : (
                <div className="empty">Sync queue is empty.</div>
              )}
            </div>
          </section>
        </div>
      </>
    );
  }

  function PatientDetailModal() {
    const [savingEdit, setSavingEdit] = useState(false);
    const [editError, setEditError] = useState("");
    const [confirmArchive, setConfirmArchive] = useState(false);

    if (!activePatientId) return null;
    const p = activePatientDetail;

    async function savePatientEdit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault();
      if (!p) return;
      setSavingEdit(true);
      setEditError("");

      const f = new FormData(e.currentTarget);
      const data = {
        firstName: String(f.get("firstName") || ""),
        lastName: String(f.get("lastName") || ""),
        phone: String(f.get("phone") || ""),
        email: String(f.get("email") || ""),
        dateOfBirth: String(f.get("dateOfBirth") || ""),
        gender: String(f.get("gender") || ""),
        city: String(f.get("city") || ""),
        referenceId: String(f.get("referenceId") || ""),
        allergies: String(f.get("allergies") || ""),
        conditions: String(f.get("conditions") || ""),
        dentalHistory: String(f.get("dentalHistory") || ""),
        consented: f.get("consented") === "on",
      };

      try {
        const r = await fetch(`/api/patients/${p.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(data),
        });
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) {
          setEditError(payload.error || "Unable to update patient.");
          return;
        }
        pushToast("Patient record updated and queued for sync.");
        await Promise.all([
          openPatientDetail(p.id, "overview"),
          loadPatients(q),
          refreshDashboard(),
        ]);
      } catch {
        setEditError("Network error while updating patient.");
      } finally {
        setSavingEdit(false);
      }
    }

    async function handleArchivePatient() {
      if (!p) return;
      const r = await fetch(`/api/patients/${p.id}`, { method: "DELETE" });
      if (r.ok) {
        pushToast(`Archived ${p.firstName} ${p.lastName}.`);
        setActivePatientId(null);
        setActivePatientDetail(null);
        await Promise.all([loadPatients(q), refreshDashboard()]);
      } else {
        pushToast("Unable to archive patient.", "error");
      }
    }

    return (
      <div
        className="modal-backdrop"
        onClick={() => {
          setActivePatientId(null);
          setActivePatientDetail(null);
        }}
      >
        <div className="modal-panel" onClick={(e) => e.stopPropagation()}>
          {loadingPatientDetail || !p ? (
            <div className="empty">
              <LoaderCircle className="spin" size={24} />
              <div style={{ marginTop: 10 }}>Loading patient profile…</div>
            </div>
          ) : (
            <>
              <div className="card-header" style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span
                    className="avatar"
                    style={{ width: 52, height: 52, fontSize: 18, margin: 0 }}
                  >
                    {p.firstName?.[0]}
                    {p.lastName?.[0]}
                  </span>
                  <div>
                    <p className="eyebrow">
                      {p.patientId}
                      {p.referenceId ? ` · REF ${p.referenceId}` : ""}
                    </p>
                    <h2 style={{ fontSize: 26, margin: "2px 0" }}>
                      {p.firstName} {p.lastName}
                    </h2>
                    <div className="sub">
                      {p.phone}
                      {p.email ? ` · ${p.email}` : ""}
                      {p.city ? ` · ${p.city}` : ""}
                      {p.gender ? ` · ${p.gender}` : ""}
                    </div>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div className="segmented">
                    <button
                      type="button"
                      className={patientModalTab === "overview" ? "active" : ""}
                      onClick={() => setPatientModalTab("overview")}
                    >
                      360° Chart
                    </button>
                    <button
                      type="button"
                      className={patientModalTab === "edit" ? "active" : ""}
                      onClick={() => setPatientModalTab("edit")}
                    >
                      Edit Details
                    </button>
                  </div>
                  <button
                    type="button"
                    className="iconbtn"
                    aria-label="Close patient modal"
                    onClick={() => {
                      setActivePatientId(null);
                      setActivePatientDetail(null);
                    }}
                  >
                    <X size={17} />
                  </button>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  marginBottom: 20,
                  paddingBottom: 16,
                  borderBottom: "1px solid var(--line)",
                }}
              >
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() => navigateWithPatient("Appointments", p.id)}
                >
                  <CalendarDays size={14} /> Book Visit
                </button>
                <button
                  type="button"
                  className="btn sm subtle"
                  onClick={() => navigateWithPatient("Treatments", p.id)}
                >
                  <Activity size={14} /> Log Treatment
                </button>
                <button
                  type="button"
                  className="btn sm subtle"
                  onClick={() => navigateWithPatient("Prescriptions", p.id)}
                >
                  <FileText size={14} /> Write Prescription
                </button>
                <button
                  type="button"
                  className="btn sm subtle"
                  onClick={() => navigateWithPatient("Billing", p.id)}
                >
                  <CircleDollarSign size={14} /> Create Invoice
                </button>
                <button
                  type="button"
                  className="btn sm subtle"
                  onClick={() => navigateWithPatient("Follow-ups", p.id)}
                >
                  <ClipboardList size={14} /> Add Follow-up
                </button>
              </div>

              {patientModalTab === "overview" ? (
                <div style={{ display: "grid", gap: 18 }}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                      gap: 12,
                    }}
                  >
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        background: "var(--surface-subtle)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div className="sub" style={{ fontSize: 12 }}>
                        Known Allergies
                      </div>
                      <b style={{ color: "var(--red)" }}>
                        {p.allergies || "None recorded"}
                      </b>
                    </div>
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        background: "var(--surface-subtle)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div className="sub" style={{ fontSize: 12 }}>
                        Medical Conditions
                      </div>
                      <b>{p.conditions || "None recorded"}</b>
                    </div>
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        background: "var(--surface-subtle)",
                        border: "1px solid var(--line)",
                      }}
                    >
                      <div className="sub" style={{ fontSize: 12 }}>
                        Dental History
                      </div>
                      <b>{p.dentalHistory || "Unremarkable"}</b>
                    </div>
                  </div>

                  <div className="grid-equal">
                    <div
                      style={{
                        padding: 16,
                        borderRadius: 16,
                        border: "1px solid var(--line)",
                      }}
                    >
                      <b style={{ fontSize: 14 }}>
                        Appointments ({p.appointments?.length || 0})
                      </b>
                      <div className="schedule" style={{ marginTop: 8 }}>
                        {p.appointments?.length ? (
                          p.appointments.slice(0, 5).map((a: any) => (
                            <div
                              key={a.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "8px 0",
                                borderTop: "1px solid var(--line)",
                                fontSize: 13,
                              }}
                            >
                              <span>
                                <b>{a.type}</b> ·{" "}
                                {new Date(a.startsAt).toLocaleDateString("en-IN")}
                              </span>
                              <span
                                className={`status ${String(
                                  a.status
                                ).toLowerCase()}`}
                              >
                                {a.status}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="sub" style={{ marginTop: 8 }}>
                            No appointments yet.
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 16,
                        borderRadius: 16,
                        border: "1px solid var(--line)",
                      }}
                    >
                      <b style={{ fontSize: 14 }}>
                        Treatments ({p.treatments?.length || 0})
                      </b>
                      <div className="schedule" style={{ marginTop: 8 }}>
                        {p.treatments?.length ? (
                          p.treatments.slice(0, 5).map((t: any) => (
                            <div
                              key={t.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "8px 0",
                                borderTop: "1px solid var(--line)",
                                fontSize: 13,
                              }}
                            >
                              <span>
                                <b>{t.procedure}</b> ({t.category})
                              </span>
                              <b>{money(t.costPaise)}</b>
                            </div>
                          ))
                        ) : (
                          <p className="sub" style={{ marginTop: 8 }}>
                            No treatments logged.
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 16,
                        borderRadius: 16,
                        border: "1px solid var(--line)",
                      }}
                    >
                      <b style={{ fontSize: 14 }}>
                        Prescriptions ({p.prescriptions?.length || 0})
                      </b>
                      <div className="schedule" style={{ marginTop: 8 }}>
                        {p.prescriptions?.length ? (
                          p.prescriptions.slice(0, 5).map((rx: any) => (
                            <div
                              key={rx.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "8px 0",
                                borderTop: "1px solid var(--line)",
                                fontSize: 13,
                              }}
                            >
                              <span>
                                {(rx.items || [])
                                  .map((i: any) => i.medication)
                                  .join(", ")}
                              </span>
                              <button
                                type="button"
                                className="btn sm"
                                onClick={() =>
                                  setPrintPrescription({ ...rx, patient: p })
                                }
                              >
                                Print
                              </button>
                            </div>
                          ))
                        ) : (
                          <p className="sub" style={{ marginTop: 8 }}>
                            No prescriptions issued.
                          </p>
                        )}
                      </div>
                    </div>

                    <div
                      style={{
                        padding: 16,
                        borderRadius: 16,
                        border: "1px solid var(--line)",
                      }}
                    >
                      <b style={{ fontSize: 14 }}>
                        Invoices ({p.invoices?.length || 0})
                      </b>
                      <div className="schedule" style={{ marginTop: 8 }}>
                        {p.invoices?.length ? (
                          p.invoices.slice(0, 5).map((inv: any) => (
                            <div
                              key={inv.id}
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                padding: "8px 0",
                                borderTop: "1px solid var(--line)",
                                fontSize: 13,
                              }}
                            >
                              <span>
                                <b>{inv.invoiceNumber}</b> · Paid{" "}
                                {money(inv.paidPaise)} / {money(inv.totalPaise)}
                              </span>
                              <span
                                className={`status ${String(
                                  inv.status
                                ).toLowerCase()}`}
                              >
                                {inv.status}
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="sub" style={{ marginTop: 8 }}>
                            No invoices created.
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <form onSubmit={savePatientEdit}>
                  <div className="form-grid">
                    <label className="field">
                      First name *
                      <input
                        name="firstName"
                        defaultValue={p.firstName}
                        required
                      />
                    </label>
                    <label className="field">
                      Last name *
                      <input
                        name="lastName"
                        defaultValue={p.lastName}
                        required
                      />
                    </label>
                    <label className="field">
                      Phone *
                      <input name="phone" defaultValue={p.phone} required />
                    </label>
                    <label className="field">
                      Email
                      <input name="email" defaultValue={p.email || ""} />
                    </label>
                    <label className="field">
                      Date of birth
                      <input
                        name="dateOfBirth"
                        type="date"
                        defaultValue={
                          p.dateOfBirth
                            ? new Date(p.dateOfBirth)
                                .toISOString()
                                .slice(0, 10)
                            : ""
                        }
                      />
                    </label>
                    <label className="field">
                      Gender
                      <input name="gender" defaultValue={p.gender || ""} />
                    </label>
                    <label className="field">
                      City
                      <input name="city" defaultValue={p.city || ""} />
                    </label>
                    <label className="field">
                      Reference ID
                      <input
                        name="referenceId"
                        defaultValue={p.referenceId || ""}
                      />
                    </label>
                    <label className="field">
                      Known allergies
                      <textarea
                        name="allergies"
                        defaultValue={p.allergies || ""}
                      />
                    </label>
                    <label className="field">
                      Medical conditions
                      <textarea
                        name="conditions"
                        defaultValue={p.conditions || ""}
                      />
                    </label>
                    <label className="field">
                      Dental history
                      <textarea
                        name="dentalHistory"
                        defaultValue={p.dentalHistory || ""}
                      />
                    </label>
                    <label className="field">
                      Consent
                      <div style={{ marginTop: 8 }}>
                        <input
                          type="checkbox"
                          name="consented"
                          defaultChecked={Boolean(p.consented)}
                        />{" "}
                        <span className="sub">Consent recorded</span>
                      </div>
                    </label>
                  </div>

                  {editError && (
                    <p className="auth-error" role="alert">
                      {editError}
                    </p>
                  )}

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginTop: 22,
                      paddingTop: 16,
                      borderTop: "1px solid var(--line)",
                    }}
                  >
                    {!confirmArchive ? (
                      <button
                        type="button"
                        className="btn danger sm"
                        onClick={() => setConfirmArchive(true)}
                      >
                        <Trash2 size={14} /> Archive patient
                      </button>
                    ) : (
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 12.5, color: "var(--red)" }}>
                          Archive this patient record?
                        </span>
                        <button
                          type="button"
                          className="btn sm danger"
                          onClick={handleArchivePatient}
                        >
                          Confirm Archive
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => setConfirmArchive(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 10 }}>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => setPatientModalTab("overview")}
                      >
                        Cancel
                      </button>
                      <button className="btn primary" disabled={savingEdit}>
                        {savingEdit ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  function PrescriptionPrintModal() {
    if (!printPrescription) return null;
    const rx = printPrescription;
    return (
      <div
        className="modal-backdrop"
        onClick={() => setPrintPrescription(null)}
      >
        <div
          className="modal-panel narrow"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="card-header">
            <div>
              <p className="eyebrow">DENTALCARE CLINIC · DR. KINJAL</p>
              <h2 style={{ fontSize: 22, marginTop: 4 }}>
                Clinical Prescription (℞)
              </h2>
            </div>
            <button
              type="button"
              className="iconbtn"
              onClick={() => setPrintPrescription(null)}
            >
              <X size={16} />
            </button>
          </div>

          <div
            style={{
              padding: "12px 14px",
              borderRadius: 12,
              background: "var(--surface-subtle)",
              border: "1px solid var(--line)",
              marginBottom: 16,
              fontSize: 13.5,
            }}
          >
            <div>
              Patient:{" "}
              <b>
                {rx.patient?.firstName} {rx.patient?.lastName}
              </b>{" "}
              ({rx.patient?.patientId})
            </div>
            <div className="sub" style={{ fontSize: 12.5, marginTop: 2 }}>
              Date: {new Date(rx.date).toLocaleDateString("en-IN")}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginBottom: 18 }}>
            {(rx.items || []).map((item: any, idx: number) => (
              <div
                key={item.id || idx}
                style={{
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "1px solid var(--line)",
                }}
              >
                <b>
                  {idx + 1}. {item.medication} — {item.dosage}
                </b>
                <div className="sub" style={{ fontSize: 13, marginTop: 3 }}>
                  {item.frequency} · Duration: {item.duration}
                </div>
                {item.instructions && (
                  <div
                    style={{
                      fontSize: 12.5,
                      color: "var(--blue)",
                      marginTop: 4,
                    }}
                  >
                    Instructions: {item.instructions}
                  </div>
                )}
              </div>
            ))}
          </div>

          {rx.notes && (
            <p className="sub" style={{ marginBottom: 18 }}>
              <b>Clinical Notes:</b> {rx.notes}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              className="btn"
              onClick={() => setPrintPrescription(null)}
            >
              Close
            </button>
            <button
              type="button"
              className="btn primary"
              onClick={() => window.print()}
            >
              <Printer size={15} /> Print Prescription
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div>
          <div className="brand">
            <span className="brand-mark">
              <Stethoscope size={17} />
            </span>
            <span>DentalCare</span>
          </div>

          <nav className="nav" aria-label="Primary navigation">
            {nav.map(([n, I]: any) => (
              <button
                className={page === n ? "active" : ""}
                onClick={() => setPage(n)}
                key={n}
              >
                <I size={18} />
                <span>{n}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="sidebar-footer">
          <div className="doctor-pill">
            <span
              className="avatar"
              style={{ width: 32, height: 32, margin: 0, fontSize: 12 }}
            >
              DK
            </span>
            <div className="doctor-pill-meta" style={{ minWidth: 0, flex: 1 }}>
              <b style={{ fontSize: 13, display: "block" }}>Dr. Kinjal</b>
              <span className="sub" style={{ fontSize: 11.5 }}>
                Local-First Edition
              </span>
            </div>
            <button
              type="button"
              className="iconbtn"
              onClick={signOut}
              title="Sign out"
              aria-label="Sign out"
              style={{
                minHeight: 30,
                padding: "4px 7px",
                border: 0,
                background: "transparent",
                boxShadow: "none",
              }}
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main">
        {page === "Dashboard" ? (
          <Dashboard />
        ) : page === "Patients" ? (
          <Patients />
        ) : page === "Add patient" ? (
          <AddPatient />
        ) : page === "Appointments" ? (
          <AppointmentsModule />
        ) : page === "Treatments" ? (
          <TreatmentsModule />
        ) : page === "Prescriptions" ? (
          <PrescriptionsModule />
        ) : page === "Billing" ? (
          <BillingModule />
        ) : page === "Follow-ups" ? (
          <FollowUpsModule />
        ) : page === "Reports" ? (
          <ReportsPage />
        ) : (
          <SettingsPage />
        )}
      </main>

      <PatientDetailModal />
      <PrescriptionPrintModal />

      {toasts.length > 0 && (
        <div className="toast-stack" role="region" aria-label="Notifications">
          {toasts.map((t) => (
            <div className="toast" key={t.id}>
              {t.kind === "error" ? (
                <AlertCircle
                  size={17}
                  style={{ color: "var(--red)", flexShrink: 0 }}
                />
              ) : (
                <CheckCircle2
                  size={17}
                  style={{ color: "var(--green)", flexShrink: 0 }}
                />
              )}
              <span style={{ flex: 1 }}>{t.text}</span>
              <button
                type="button"
                onClick={() =>
                  setToasts((prev) => prev.filter((item) => item.id !== t.id))
                }
                aria-label="Dismiss notification"
                style={{
                  border: 0,
                  background: "transparent",
                  color: "var(--muted)",
                  cursor: "pointer",
                  padding: 2,
                }}
              >
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

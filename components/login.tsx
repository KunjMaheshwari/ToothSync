"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Database,
  Eye,
  EyeOff,
  Lock,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from "lucide-react";

export default function Login() {
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(Object.fromEntries(form)),
      });
      if (r.ok) {
        window.location.reload();
        return;
      }
      const payload = await r.json().catch(() => ({}));
      setError(
        payload.error || "Unable to sign in. Please verify your credentials."
      );
    } catch {
      setError("Network error while connecting to the local clinic server.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login">
      <section className="login-aside">
        <div className="brand">
          <span className="brand-mark">
            <Stethoscope size={18} />
          </span>
          <div className="brand-copy">
            <span className="brand-title">
              Doctor Kinjal Maheshwari&apos;s Patient Tracker
            </span>
            <span className="brand-subtitle">
              Clinical Practice &amp; Patient Management Suite
            </span>
          </div>
        </div>

        <div style={{ maxWidth: 468 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              borderRadius: 999,
              background: "rgba(255, 255, 255, 0.1)",
              border: "1px solid rgba(255, 255, 255, 0.16)",
              color: "#a7d8ff",
              fontSize: 12,
              fontWeight: 600,
              marginBottom: 22,
            }}
          >
            <Sparkles size={13} /> Doctor Kinjal Maheshwari&apos;s Patient Tracker
          </div>

          <h1
            style={{
              fontSize: "clamp(32px, 3.6vw, 48px)",
              fontWeight: 700,
              letterSpacing: "-0.042em",
              lineHeight: 1.08,
              margin: "0 0 16px",
            }}
          >
            Precision care, designed with calm clarity.
          </h1>
          <p
            style={{
              color: "rgba(226, 240, 255, 0.84)",
              fontSize: 15.5,
              lineHeight: 1.58,
              margin: "0 0 30px",
            }}
          >
            An Apple-inspired, local-first clinical workspace crafted for
            comprehensive patient records, chairside treatments, prescriptions,
            and integer-paise financial billing—with resilient Google Sheets
            synchronization.
          </p>

          <div
            style={{
              display: "grid",
              gap: 12,
              padding: "18px 20px",
              borderRadius: 18,
              background: "rgba(255, 255, 255, 0.06)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
            }}
          >
            {[
              [
                Database,
                "Authoritative local SQLite database for zero-latency clinical care",
              ],
              [
                CheckCircle2,
                "Idempotent Google Sheets reporting & real-time backup queue",
              ],
              [
                Lock,
                "Signed HTTP-only session with brute-force & CSRF protection",
              ],
            ].map(([Icon, text]: any) => (
              <div
                key={text}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  fontSize: 13.5,
                  color: "rgba(240, 248, 255, 0.9)",
                }}
              >
                <Icon size={16} style={{ color: "#64b5ff", flexShrink: 0 }} />
                <span>{text}</span>
              </div>
            ))}
          </div>
        </div>

        <small
          style={{
            color: "rgba(180, 214, 245, 0.72)",
            fontSize: 12.5,
            display: "flex",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <span>Doctor Kinjal Maheshwari&apos;s Patient Tracker</span>
          <span>Local-First Architecture · Encrypted Session</span>
        </small>
      </section>

      <section className="login-form">
        <div className="login-card">
          <p className="eyebrow">
            DOCTOR KINJAL MAHESHWARI&apos;S PATIENT TRACKER
          </p>
          <h2 className="title" style={{ fontSize: 28, marginTop: 6 }}>
            Welcome Doctor Kinjal Maheshwari
          </h2>
          <p className="sub" style={{ marginBottom: 24 }}>
            Sign in with your clinic credentials to unlock patient records and
            practice operations.
          </p>

          <form
            onSubmit={submit}
            className="form-grid"
            style={{ gridTemplateColumns: "1fr", gap: 16 }}
          >
            <label className="field">
              Username
              <input
                name="username"
                autoComplete="username"
                defaultValue="doctorkinjal"
                required
              />
            </label>

            <label className="field">
              Password
              <div style={{ position: "relative" }}>
                <input
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your clinic password"
                  required
                  style={{ width: "100%", paddingRight: 44 }}
                />
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={show ? "Hide password" : "Show password"}
                  onClick={() => setShow(!show)}
                  style={{
                    position: "absolute",
                    right: 4,
                    top: 4,
                    minHeight: 30,
                    border: 0,
                    padding: "4px 8px",
                    background: "transparent",
                    boxShadow: "none",
                  }}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              className="btn primary"
              disabled={loading}
              style={{ width: "100%", minHeight: 42, marginTop: 4 }}
            >
              {loading ? "Signing in…" : "Sign in to Patient Tracker"}
            </button>
          </form>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              justifyContent: "center",
              marginTop: 24,
              paddingTop: 16,
              borderTop: "1px solid var(--line)",
              color: "var(--muted)",
              fontSize: 12,
            }}
          >
            <ShieldCheck size={15} style={{ color: "var(--blue)" }} />
            <span>
              Restricted to Dr. Kinjal Maheshwari · Authorized Clinical Device
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

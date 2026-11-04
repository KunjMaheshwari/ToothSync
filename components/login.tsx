"use client";

import { useState } from "react";
import { Eye, EyeOff, ShieldCheck } from "lucide-react";

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
      <section className="login-aside" aria-label="Welcome to Dr. Kinjal Maheshwari's dental practice">
        <div className="login-ambient-glow" aria-hidden="true" />

        <header className="login-brand">
          <span className="login-brand-mark" aria-hidden="true">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M7.5 4.75C5.4 4.75 3.75 6.55 3.75 9.1C3.75 12.2 5.45 15.85 6.8 18.45C7.42 19.65 8.85 19.55 9.35 18.3L10.55 15.3C11.08 13.98 12.92 13.98 13.45 15.3L14.65 18.3C15.15 19.55 16.58 19.65 17.2 18.45C18.55 15.85 20.25 12.2 20.25 9.1C20.25 6.55 18.6 4.75 16.5 4.75C14.95 4.75 13.7 5.55 12.68 6.08C12.25 6.3 11.75 6.3 11.32 6.08C10.3 5.55 9.05 4.75 7.5 4.75Z"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M8.5 10.2C10.55 11.7 13.45 11.7 15.5 10.2"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </span>
          <div className="login-brand-copy">
            <span className="login-brand-title">Dr. Kinjal Maheshwari</span>
            <span className="login-brand-subtitle">Dental Practice</span>
          </div>
        </header>

        <div className="login-welcome">
          <div className="login-eyebrow-pill">
            <span className="login-eyebrow-dot" aria-hidden="true" />
            <span>WELCOME TO YOUR DENTAL CARE</span>
          </div>

          <h1 className="login-headline">
            Your smile deserves thoughtful care.
          </h1>

          <p className="login-lead">
            A warm welcome to the practice of Dr. Kinjal Maheshwari, where every
            smile is treated with attention, compassion, and care.
          </p>

          <div className="login-smile-card">
            <div className="login-smile-motif" aria-hidden="true">
              <svg
                viewBox="0 0 180 54"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="login-smile-svg"
              >
                <defs>
                  <linearGradient
                    id="smileArcPrimary"
                    x1="12"
                    y1="14"
                    x2="168"
                    y2="14"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stopColor="#E6D5B8" stopOpacity="0.15" />
                    <stop offset="50%" stopColor="#F3E7D3" stopOpacity="0.9" />
                    <stop offset="100%" stopColor="#9CC5E8" stopOpacity="0.15" />
                  </linearGradient>
                  <linearGradient
                    id="smileArcSecondary"
                    x1="34"
                    y1="24"
                    x2="146"
                    y2="24"
                    gradientUnits="userSpaceOnUse"
                  >
                    <stop offset="0%" stopColor="#9CC5E8" stopOpacity="0" />
                    <stop offset="50%" stopColor="#9CC5E8" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#E6D5B8" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d="M16 14C52 42 128 42 164 14"
                  stroke="url(#smileArcPrimary)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M36 24C66 44 114 44 144 24"
                  stroke="url(#smileArcSecondary)"
                  strokeWidth="1.25"
                  strokeLinecap="round"
                />
                <circle cx="90" cy="35" r="2.2" fill="#F3E7D3" fillOpacity="0.75" />
              </svg>
            </div>

            <p className="login-secondary-line">
              Your journey to a healthier, brighter smile begins here.
            </p>
            <p className="login-closing-line">
              Because every smile tells a story.
            </p>
          </div>
        </div>

        <footer className="login-aside-footer">
          <span>Practice of Dr. Kinjal Maheshwari</span>
          <span className="login-footer-sep" aria-hidden="true">
            ·
          </span>
          <span>Because every smile tells a story.</span>
        </footer>
      </section>

      <section className="login-form">
        <div className="login-card">
          <p className="eyebrow login-card-eyebrow">
            Doctor Kinjal Maheshwari&apos;s Patient Tracker
          </p>
          <h2 className="title login-card-title">
            Welcome Doctor Kinjal Maheshwari
          </h2>
          <p className="sub login-card-sub">
            Sign in with your clinic credentials to access patient care and
            practice records.
          </p>

          <form
            onSubmit={submit}
            className="form-grid login-form-grid"
          >
            <label className="field login-field">
              Username
              <input
                name="username"
                autoComplete="username"
                defaultValue="doctorkinjal"
                required
              />
            </label>

            <label className="field login-field">
              Password
              <div className="login-password-wrap">
                <input
                  name="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your clinic password"
                  required
                />
                <button
                  type="button"
                  className="iconbtn login-eye-btn"
                  aria-label={show ? "Hide password" : "Show password"}
                  onClick={() => setShow(!show)}
                >
                  {show ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </label>

            <button
              type="submit"
              className="btn primary login-submit-btn"
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign in to Patient Tracker"}
            </button>
          </form>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <div className="login-card-footer">
            <ShieldCheck size={15} className="login-card-footer-icon" />
            <span>
              Dr. Kinjal Maheshwari&apos;s Practice · Authorized Access
            </span>
          </div>
        </div>
      </section>
    </main>
  );
}

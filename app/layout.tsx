import "./globals.css";
import type { Metadata } from "next";
import Script from "next/script";

export const metadata: Metadata = {
  title: "Doctor Kinjal Maheshwari's Patient Tracker",
  description:
    "Doctor Kinjal Maheshwari's Patient Tracker — Apple-inspired local-first clinical workspace for patient records, appointments, treatments, prescriptions, and billing.",
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">{`try { const saved=localStorage.getItem('theme'); const dark=saved ? saved==='dark' : matchMedia('(prefers-color-scheme: dark)').matches; document.documentElement.classList.toggle('dark',dark); } catch {}`}</Script>
        {children}
      </body>
    </html>
  );
}

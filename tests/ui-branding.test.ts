import React from "react";
import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import Loading from "@/app/loading";
import Login from "@/components/login";
import ClinicApp from "@/components/clinic-app";

(globalThis as unknown as { React: typeof React }).React = React;

const { renderToStaticMarkup } = require("react-dom/server") as {
  renderToStaticMarkup: (element: React.ReactElement) => string;
};

describe("Doctor Kinjal Maheshwari's Patient Tracker UI & SSR Branding", () => {
  it("exports metadata title as Doctor Kinjal Maheshwari's Patient Tracker", () => {
    expect(metadata.title).toBe("Doctor Kinjal Maheshwari's Patient Tracker");
  });

  it("renders Loading screen with Doctor Kinjal Maheshwari's Patient Tracker branding", () => {
    const html = renderToStaticMarkup(React.createElement(Loading));
    expect(html).toContain("Doctor Kinjal Maheshwari&#x27;s Patient Tracker");
  });

  it("renders Login screen with Doctor Kinjal Maheshwari's Patient Tracker and Welcome greeting", () => {
    const html = renderToStaticMarkup(React.createElement(Login));
    expect(html).toContain("Doctor Kinjal Maheshwari&#x27;s Patient Tracker");
    expect(html).toContain("Welcome Doctor Kinjal Maheshwari");
  });

  it("renders ClinicApp SSR HTML with mandatory Dashboard greeting, subtitle, branding, and 7 compact stat labels", () => {
    const html = renderToStaticMarkup(React.createElement(ClinicApp));
    expect(html).toContain("Doctor Kinjal Maheshwari&#x27;s Patient Tracker");
    expect(html).toContain("Welcome Doctor Kinjal Maheshwari");
    expect(html).toContain("Here&#x27;s your clinic overview for today.");

    // Verify all 7 compact dashboard stats render during SSR
    expect(html).toContain("Total patients");
    expect(html).toContain("Today’s appointments");
    expect(html).toContain("Completed treatments");
    expect(html).toContain("Pending follow-ups");
    expect(html).toContain("Total billing");
    expect(html).toContain("Payments received");
    expect(html).toContain("Outstanding balances");

    // Verify dashboard sections render during SSR
    expect(html).toContain("Upcoming appointments");
    expect(html).toContain("Recent patients");
    expect(html).toContain("Pending payments");
    expect(html).toContain("Follow-ups requiring attention");
    expect(html).toContain("Google Sheets synchronization");
  });
});

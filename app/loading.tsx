export default function Loading() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "var(--bg)",
        padding: 24,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          textAlign: "center",
        }}
      >
        <div
          className="brand-mark"
          style={{ width: 42, height: 42, borderRadius: 12, fontSize: 18, fontWeight: 700 }}
        >
          DK
        </div>
        <b style={{ fontSize: 15, letterSpacing: "-0.02em" }}>
          Doctor Kinjal Maheshwari&apos;s Patient Tracker
        </b>
        <span className="sub" style={{ fontSize: 13 }}>
          Preparing clinical workspace…
        </span>
      </div>
    </div>
  );
}


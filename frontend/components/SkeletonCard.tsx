export function SkeletonCard({ delay }: { delay: number }) {
  return (
    <div
      style={{
        background: "var(--s2)",
        border: "1px solid var(--b1)",
        borderRadius: 18,
        padding: 20,
        opacity: 0,
        animation: `fade-in 0.4s ease ${delay}s forwards`,
      }}
    >
      <div className="shimmer" style={{ height: 20, width: "45%", borderRadius: 6, marginBottom: 16 }} />
      <div className="shimmer" style={{ height: 18, width: "80%", borderRadius: 5, marginBottom: 8 }} />
      <div className="shimmer" style={{ height: 14, width: "60%", borderRadius: 5, marginBottom: 24 }} />
      <div style={{ borderTop: "1px solid var(--b0)", marginBottom: 16 }} />
      <div style={{ display: "flex", gap: 16, marginBottom: 16 }}>
        <div className="shimmer" style={{ height: 44, width: 60, borderRadius: 6 }} />
        <div className="shimmer" style={{ height: 32, width: 44, borderRadius: 6 }} />
        <div className="shimmer" style={{ height: 20, width: 52, borderRadius: 6, marginLeft: "auto" }} />
      </div>
      <div className="shimmer" style={{ height: 2, borderRadius: 2, marginBottom: 16 }} />
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="shimmer"
          style={{ height: 12, width: `${55 + i * 10}%`, borderRadius: 4, marginBottom: i < 3 ? 8 : 0 }}
        />
      ))}
    </div>
  );
}

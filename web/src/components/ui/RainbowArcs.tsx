/** Concentric quarter-circle bands from a corner (docs/DESIGN.md, "Rainbow arcs"). */
export function RainbowArcs({ className, corner = "bottom-right" }: { className?: string; corner?: "bottom-right" | "top-left" }) {
  const bands = ["#2e3bff", "#c8f53c", "#ffc22e", "#ff8fcf", "#ff4f1f"];
  const flip = corner === "top-left" ? "" : "scale(-1,-1) translate(-400,-400)";
  return (
    <svg viewBox="0 0 400 400" className={className} aria-hidden>
      <g transform={flip}>
        {bands.map((c, i) => (
          <circle key={c} cx="0" cy="0" r={380 - i * 42} fill="none" stroke={c} strokeWidth="42" />
        ))}
      </g>
    </svg>
  );
}

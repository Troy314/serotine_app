import { useState } from "react";

/** A simple "trend over time" bar chart — magnitude job, so a single
 * sequential hue (blue, the dataviz skill's default sequential hue),
 * per its mark spec: bars ≤24px thick, 4px rounded data-end, square at
 * the baseline, growing from one shared baseline. Per-bar hover tooltip
 * (category + value), since this is an HTML chart and the hover layer is
 * part of the deliverable, not an upgrade. */
const HUE = "#2a78d6"; // sequential default, light mode

export default function BarChart({ data, valueLabel }) {
  const [hovered, setHovered] = useState(null);
  const max = Math.max(1, ...data.map((d) => d.value));

  if (!data.length) return <p className="muted small">Aucune donnée.</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 140, padding: "4px 2px" }}>
        {data.map((d) => {
          const h = Math.max(2, (d.value / max) * 128);
          const isHovered = hovered === d.label;
          return (
            <div
              key={d.label}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", height: "100%", cursor: "pointer" }}
              onMouseEnter={() => setHovered(d.label)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(d.label)}
              onBlur={() => setHovered(null)}
              tabIndex={0}
              role="img"
              aria-label={`${d.label}: ${d.value} ${valueLabel || ""}`}
            >
              {isHovered && <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 2 }}>{d.value}</div>}
              <div
                style={{
                  width: "100%",
                  maxWidth: 24,
                  height: h,
                  background: isHovered ? "var(--violet-fonce)" : HUE,
                  borderRadius: "4px 4px 0 0",
                  transition: "background 0.1s",
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {data.map((d) => (
          <div key={d.label} style={{ flex: 1, textAlign: "center", fontSize: 10 }} className="muted">
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}

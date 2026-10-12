import { useState } from "react";

/** A small, accessible donut chart — categorical (part-to-whole) color job.
 *
 * Per the dataviz skill's color-formula: a pie/donut is an "all-pairs"
 * form (every slice sits beside every other slice, same as scatter/small-
 * multiples), and the validated default categorical palette only clears
 * the CVD/contrast gates *pairwise* for its first three slots under that
 * stricter test — past three, the rule is "fold to Other," not "add a
 * fourth hue." So this always shows at most the top 3 categories in real
 * color plus a neutral grey "Autres" bucket for the rest, sorted so the
 * biggest categories keep their own color and the long tail folds away —
 * never a wheel with as many hues as there are rows.
 */
const SLOT_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"]; // validated default palette, slots 1-3, light mode
const OTHER_COLOR = "#9aa5b1";
const GAP_DEG = 2; // small visual gap between slices, same spirit as the 2px stacked-segment gap elsewhere

export default function DonutChart({ data, valueLabel, size = 180 }) {
  const [hovered, setHovered] = useState(null);
  const r = size / 2 - 18;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;

  const sorted = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, 3).map((d, i) => ({ ...d, color: SLOT_COLORS[i] }));
  const rest = sorted.slice(3);
  const otherTotal = rest.reduce((s, d) => s + d.value, 0);
  const slices = otherTotal > 0 ? [...top, { label: "Autres", value: otherTotal, color: OTHER_COLOR, isOther: true, members: rest }] : top;

  const total = slices.reduce((s, d) => s + d.value, 0);

  let cumulative = 0;
  const arcs = slices.map((s) => {
    const pct = total ? s.value / total : 0;
    const gap = (GAP_DEG / 360) * circumference;
    const len = Math.max(0, pct * circumference - gap);
    const offset = -(cumulative * circumference) - gap / 2;
    cumulative += pct;
    return { ...s, pct, dasharray: `${len} ${circumference - len}`, dashoffset: offset };
  });

  if (!total) return <p className="muted small">Aucune donnée.</p>;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
      <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--paper)" strokeWidth={hovered ? 26 : 24} />
          {arcs.map((a) => (
            <circle
              key={a.label}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth={hovered === a.label ? 28 : 24}
              strokeDasharray={a.dasharray}
              strokeDashoffset={a.dashoffset}
              strokeLinecap="butt"
              style={{ transition: "stroke-width 0.1s", cursor: "pointer" }}
              tabIndex={0}
              role="img"
              aria-label={`${a.label}: ${a.value} (${Math.round(a.pct * 100)}%)`}
              onMouseEnter={() => setHovered(a.label)}
              onMouseLeave={() => setHovered(null)}
              onFocus={() => setHovered(a.label)}
              onBlur={() => setHovered(null)}
            />
          ))}
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          {hovered ? (
            <>
              <strong style={{ fontSize: 18 }}>{arcs.find((a) => a.label === hovered)?.value}</strong>
              <span className="muted small" style={{ textAlign: "center", maxWidth: size - 50 }}>{hovered}</span>
            </>
          ) : (
            <>
              <strong style={{ fontSize: 20 }}>{total}</strong>
              <span className="muted small">{valueLabel}</span>
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 140 }}>
        {arcs.map((a) => (
          <div
            key={a.label}
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", opacity: hovered && hovered !== a.label ? 0.5 : 1 }}
            onMouseEnter={() => setHovered(a.label)}
            onMouseLeave={() => setHovered(null)}
            title={a.isOther ? a.members.map((m) => m.label).join(", ") : undefined}
          >
            <span style={{ width: 10, height: 10, borderRadius: 3, background: a.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{a.label}</span>
            <span className="muted">{a.value} · {Math.round(a.pct * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

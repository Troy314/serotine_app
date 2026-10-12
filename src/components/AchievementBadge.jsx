import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeAchievement } from "../lib/achievement.js";

const STEPS = [
  ["redaction", "Rédaction", "fa-pen-nib"],
  ["relecture", "Relecture", "fa-magnifying-glass"],
  ["miseEnPage", "Mise en page", "fa-layer-group"],
  ["audio", "Version audio", "fa-microphone"],
  ["communication", "Communication", "fa-bullhorn"],
];

function colorFor(pct) {
  if (pct >= 100) return "#1baf7a";
  if (pct >= 50) return "#eda100";
  return "#e34948";
}

const SIZE = 24;
const STROKE = 3;
const R = (SIZE - STROKE) / 2;
const CIRC = 2 * Math.PI * R;

/** One progress ring: the arc fills clockwise from the top, the step's icon sits dead-centre (svg and icon share one grid cell). */
function Ring({ label, icon, value }) {
  return (
    <div title={`${label} : ${value}%`} style={{ display: "grid", placeItems: "center", width: SIZE, height: SIZE, flexShrink: 0 }}>
      <svg width={SIZE} height={SIZE} style={{ gridArea: "1 / 1", transform: "rotate(-90deg)", display: "block" }} aria-hidden="true">
        {/* Fixed mid-gray track (var(--paper)/var(--border) vanish in dark mode). */}
        <circle cx={SIZE / 2} cy={SIZE / 2} r={R} fill="none" stroke="rgba(128, 120, 132, 0.35)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={R}
          fill="none"
          stroke={colorFor(value)}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={CIRC * (1 - value / 100)}
          style={{ transition: "stroke-dashoffset 0.15s" }}
        />
      </svg>
      <i
        className={`fa-solid ${icon}`}
        style={{ gridArea: "1 / 1", width: SIZE, lineHeight: `${SIZE}px`, textAlign: "center", fontSize: 10, color: "var(--muted)" }}
        aria-hidden="true"
      />
    </div>
  );
}

/** Avancement cell: a single ring, centred in the cell, for the step of the open column group (`visibleGroups`, same keys as
 * BohrBoard's GROUPS). While the mouse is over it, all five rings show in an overlay floating above the table (a portal, so
 * the table's scroll areas can't clip it and the row height never changes). */
export default function AchievementBadge({ article, linkedPosts, visibleGroups }) {
  const a = computeAchievement(article, linkedPosts || []);
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const shown = STEPS.filter(([key]) => !visibleGroups || visibleGroups.has(key.toLowerCase()));

  function open() {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
  }

  return (
    <div ref={ref} style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 4 }} onMouseEnter={open} onMouseLeave={() => setPos(null)}>
      {shown.map(([key, label, icon]) => <Ring key={key} label={label} icon={icon} value={a[key]} />)}
      {pos &&
        createPortal(
          <div
            style={{
              position: "fixed", left: pos.x, top: pos.y, transform: "translate(-50%, -50%)", zIndex: 1000, pointerEvents: "none",
              display: "flex", gap: 6, padding: 8, background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: "var(--radius)", boxShadow: "0 4px 14px rgba(45, 34, 51, 0.25)",
            }}
          >
            {STEPS.map(([key, label, icon]) => (
              <div key={key} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <Ring label={label} icon={icon} value={a[key]} />
                <span style={{ fontSize: 10, color: "var(--muted)" }}>{a[key]}%</span>
              </div>
            ))}
          </div>,
          document.body
        )}
    </div>
  );
}

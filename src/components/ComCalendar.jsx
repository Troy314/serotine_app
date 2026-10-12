import { useMemo, useState } from "react";
import { chipStyle } from "../lib/color.js";

const WEEKDAY_LABELS = ["L", "M", "M", "J", "V", "S", "D"];
const MAX_VISIBLE_PER_DAY = 3;
const KIND_COLOR = { post: "#65466e", issue_release: "#b1ed4e", reminder: "#db9ced" };

function toIso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Monday-start 42-cell grid padded with the adjacent months' days, same
// shape as achievement-vault's Agenda.jsx (buildMonthGrid) — the only
// prior art for a calendar view in this codebase's sibling project.
function buildMonthGrid(cursor) {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7; // Monday = 0
  const gridStart = new Date(year, month, 1 - startOffset);
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    return d;
  });
}

export default function ComCalendar({ posts, onAddPost }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selectedDay, setSelectedDay] = useState(null);

  const byDate = useMemo(() => {
    const map = new Map();
    for (const p of posts) {
      // Blank-titled rows are calendar-grid artifacts from the legacy
      // import (an ordinary day with nothing actually posted) — not real
      // posts worth a pill; still fully editable from the list view.
      if (!p.postDate || !p.itemTitle?.trim()) continue;
      if (!map.has(p.postDate)) map.set(p.postDate, []);
      map.get(p.postDate).push(p);
    }
    return map;
  }, [posts]);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);
  const monthLabel = cursor.toLocaleDateString("fr-FR", { month: "long", year: "numeric" });

  function go(deltaMonths) {
    const d = new Date(cursor);
    d.setMonth(d.getMonth() + deltaMonths);
    setCursor(d);
  }

  const undated = posts.filter((p) => !p.postDate);

  return (
    <div>
      <div className="section-toolbar">
        <button className="select-chip" onClick={() => go(-1)}><i className="fa-solid fa-chevron-left" aria-hidden="true" /></button>
        <button className="select-chip" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Aujourd'hui</button>
        <button className="select-chip" onClick={() => go(1)}><i className="fa-solid fa-chevron-right" aria-hidden="true" /></button>
        <strong style={{ textTransform: "capitalize" }}>{monthLabel}</strong>
      </div>

      <div className="cal-grid card">
        {WEEKDAY_LABELS.map((w, i) => (
          <div className="cal-weekday" key={i}>{w}</div>
        ))}
        {grid.map((d) => {
          const iso = toIso(d);
          const inMonth = d.getMonth() === cursor.getMonth();
          const dayPosts = byDate.get(iso) || [];
          return (
            <div key={iso} className={`cal-day ${inMonth ? "" : "cal-day--out"}`}>
              <div className="cal-day__head">
                <span>{d.getDate()}</span>
                <button className="cal-day__add" title="Ajouter un post ce jour" onClick={() => onAddPost(iso)}>
                  <i className="fa-solid fa-plus" aria-hidden="true" />
                </button>
              </div>
              <div className="cal-day__pills">
                {dayPosts.slice(0, MAX_VISIBLE_PER_DAY).map((p) => (
                  <div
                    key={p.id}
                    className="cal-pill"
                    style={chipStyle(KIND_COLOR[p.kind])}
                    title={p.itemTitle}
                    onClick={() => setSelectedDay(iso)}
                  >
                    {p.itemTitle}
                  </div>
                ))}
                {dayPosts.length > MAX_VISIBLE_PER_DAY && (
                  <button className="cal-more" onClick={() => setSelectedDay(iso)}>
                    +{dayPosts.length - MAX_VISIBLE_PER_DAY}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {undated.length > 0 && (
        <div className="card">
          <h3>Non datés</h3>
          <div className="link-row">
            {undated.map((p) => (
              <span className="tag" key={p.id}>{p.itemTitle}</span>
            ))}
          </div>
        </div>
      )}

      {selectedDay && (
        <div className="modal-overlay" onClick={() => setSelectedDay(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>{new Date(selectedDay).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</h3>
              <button className="icon-btn" onClick={() => setSelectedDay(null)}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
            </div>
            {(byDate.get(selectedDay) || []).map((p) => (
              <div key={p.id} className="card" style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong>{p.itemTitle}</strong>
                  <span className="chip" style={chipStyle(KIND_COLOR[p.kind])}>{p.kind}</span>
                </div>
                {p.texte && <p className="muted small">{p.texte}</p>}
              </div>
            ))}
            <button className="link-btn" onClick={() => { onAddPost(selectedDay); setSelectedDay(null); }}>
              <i className="fa-solid fa-plus" aria-hidden="true" /> Ajouter un post ce jour
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

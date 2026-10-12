import { useMemo, useRef, useState } from "react";

/**
 * Courbes « évolution dans le temps » (2 séries max, une seule échelle) — procédure du skill dataviz :
 * séries = emplacements 1 et 2 de la palette par défaut (validée pour des paires voisines, clair et sombre : variables --viz-1 / --viz-2),
 * traits de 2 px, repères ≥ 8 px cerclés de la couleur du fond, grille discrète, légende toujours présente + étiquette directe au dernier point,
 * texte en couleurs d'encre (jamais la couleur de la série), repère vertical + infobulle au survol/focus, et une vue « tableau » pour ne rien
 * devoir à la couleur seule. `points` : [{ label, values: { [clé]: nombre|null } }] dans l'ordre chronologique.
 */
const W = 640, H = 230, PAD = { l: 40, r: 56, t: 14, b: 30 };

export default function LineChart({ points, series, unit = "", title }) {
  const [hover, setHover] = useState(null); // index du point survolé
  const [table, setTable] = useState(false);
  const svgRef = useRef(null);

  const max = useMemo(() => {
    const m = Math.max(1, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
    const step = m <= 10 ? 2 : m <= 50 ? 10 : 20;
    return Math.ceil(m / step) * step;
  }, [points, series]);

  if (points.length === 0) return <p className="muted small">Aucune donnée.</p>;

  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const x = (i) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v) => PAD.t + ih - (v / max) * ih;
  const ticks = [0, 1, 2, 3, 4].map((k) => (max / 4) * k);
  const every = Math.ceil(points.length / 8); // au plus ~8 étiquettes sur l'axe

  function onMove(e) {
    const rect = svgRef.current.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  }

  const path = (s) => {
    let d = "", pen = false;
    points.forEach((p, i) => {
      const v = p.values[s.key];
      if (v == null) { pen = false; return; } // valeur absente : on interrompt la courbe, on n'invente pas de 0
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d.trim();
  };

  return (
    <figure className="viz-root" style={{ margin: 0 }}>
      {title && <figcaption style={{ fontWeight: 600, marginBottom: 4 }}>{title}</figcaption>}
      <div className="viz-legend" aria-hidden={false}>
        {series.map((s) => (
          <span key={s.key}><i className="viz-swatch" style={{ background: s.color }} /> {s.label}</span>
        ))}
        <button type="button" className="icon-btn" style={{ marginLeft: "auto", fontSize: 12 }} onClick={() => setTable((t) => !t)}>
          <i className={`fa-solid ${table ? "fa-chart-line" : "fa-table"}`} aria-hidden="true" /> {table ? "Voir le graphique" : "Voir le tableau"}
        </button>
      </div>

      {table ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Date</th>{series.map((s) => <th key={s.key}>{s.label}</th>)}</tr></thead>
            <tbody>{points.map((p, i) => <tr key={i}><td>{p.label}</td>{series.map((s) => <td key={s.key}>{p.values[s.key] == null ? "—" : `${p.values[s.key]} ${unit}`}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div style={{ position: "relative" }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            style={{ width: "100%", height: "auto", display: "block", touchAction: "pan-y" }}
            role="img"
            aria-label={`${title || "Évolution"} : ${series.map((s) => s.label).join(", ")}`}
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
                <text x={PAD.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">{Math.round(t)}{unit}</text>
              </g>
            ))}
            {points.map((p, i) => (i % every === 0 || i === points.length - 1) && (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{p.label}</text>
            ))}
            {hover != null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />}
            {series.map((s) => (
              <g key={s.key}>
                <path d={path(s)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
                {points.map((p, i) => p.values[s.key] != null && (
                  <circle key={i} cx={x(i)} cy={y(p.values[s.key])} r={hover === i ? 5 : 4} fill={s.color} stroke="var(--surface)" strokeWidth="2" />
                ))}
                {(() => { // étiquette directe au dernier point renseigné
                  let last = -1; points.forEach((p, i) => { if (p.values[s.key] != null) last = i; });
                  return last >= 0 ? <text x={x(last) + 9} y={y(points[last].values[s.key]) + 4} fontSize="11.5" fontWeight="600" fill="var(--text)">{points[last].values[s.key]}{unit}</text> : null;
                })()}
              </g>
            ))}
          </svg>
          {hover != null && (
            <div className="viz-tip" style={{ left: `${(x(hover) / W) * 100}%`, transform: x(hover) > W * 0.65 ? "translateX(-105%)" : "translateX(8px)" }} role="status">
              <strong>{points[hover].label}</strong>
              {points[hover].title && <div className="muted small">{points[hover].title}</div>}
              {series.map((s) => (
                <div key={s.key}><i className="viz-swatch" style={{ background: s.color }} /> {s.label} : <strong>{points[hover].values[s.key] == null ? "—" : `${points[hover].values[s.key]}${unit}`}</strong></div>
              ))}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}

import { useEffect, useMemo, useState } from "react";
import MemberPicker from "./MemberPicker.jsx";
import { api } from "../lib/api.js";
import { ROLES } from "../lib/roles.js";

// Each "step" of the project maps to one of the board's own status fields
// — a Trello-style board per step, not one board mixing every field at
// once (that read as too busy to actually use). `c2r: true` steps are the
// same production-tracking fields C2R_ONLY_FIELDS restricts elsewhere —
// dragging a card between columns is just a different way of setting that
// field, so it needs the same admin-mode gate the table view uses.
// No "Communication" step here any more — the table view replaced its
// freeform communication_rs status with a real cross-reference to Plan
// de Com's own posts (see BohrBoard.jsx's postsByArticle), so there's no
// status left for a kanban board to drag between columns.
// Même libellé que BohrBoard.jsx pour un sujet pas encore rangé dans un numéro.
const UNASSIGNED_LABEL = "À découper";

const PHASES = [
  { key: "etatRedaction", optionsField: "etat_redaction", label: "Rédaction", c2r: false },
  { key: "etatMiseEnPage", optionsField: "etat_mise_en_page", label: "Mise en page", c2r: true },
  // Audio : enregistrement ET montage restent une seule étape (Non → Pas commencé → Enregistré → Traité → Posté).
  { key: "etatAudio", optionsField: "etat_audio", label: "Audio", c2r: true },
  // Illustration : l'état « Illustrations » de l'article (Pas commencé → Finito).
  { key: "illustrations", optionsField: "illustrations", label: "Illustration", c2r: true },
];

export default function BohrKanban({ articles, statusOptions, editAsAdmin, onPatch, fixedPhase, roleKeys }) {
  const [phaseKey, setPhaseKey] = useState(fixedPhase || "etatRedaction");
  const [dragOverValue, setDragOverValue] = useState(null);
  const phase = PHASES.find((p) => p.key === (fixedPhase || phaseKey));
  const field = phase.field || phase.key; // propriété de l'article portant l'état
  const columns = (statusOptions[phase.optionsField] || []).filter((c) => !phase.only || phase.only.includes(c.value));
  const canDrag = phase.c2r ? editAsAdmin : true;
  // Responsables : sur chaque carte, un choix par rôle de l'étape en cours (voir ROLES[].phase) — une seule personne par rôle,
  // choisie par recherche (MemberPicker). Liste des membres chargée une fois.
  const [members, setMembers] = useState([]);
  const [pickingFor, setPickingFor] = useState(null); // carte dont un champ de recherche est ouvert : on la rend non déplaçable
  useEffect(() => {
    api.members.list().then(setMembers).catch(() => {});
  }, []);

  // Colonnes d'une liste d'articles (une carte par article, rangée selon son état).
  function groupByColumn(list) {
    const map = new Map(columns.map((c) => [c.value, []]));
    for (const a of list) {
      const v = a[field];
      if (!map.has(v)) {
        if (phase.only) continue; // étape limitée à certaines colonnes : les articles d'autres états n'y figurent pas
        map.set(v, []); // a value not in the current vocab (shouldn't normally happen) still gets its own column rather than dropping the card
      }
      map.get(v).push(a);
    }
    return map;
  }

  // Un tableau par numéro, comme la vue Liste : « À découper » d'abord, puis du numéro le plus récent au plus ancien.
  const sections = useMemo(() => {
    const byIssue = new Map();
    for (const a of articles) {
      const label = a.issueLabel || UNASSIGNED_LABEL;
      const key = `${a.issueOrder}|${label}`;
      if (!byIssue.has(key)) byIssue.set(key, { key, order: a.issueOrder, label, month: a.issueMonth, articles: [] });
      byIssue.get(key).articles.push(a);
    }
    return Array.from(byIssue.values()).sort((x, y) => {
      const ux = x.label === UNASSIGNED_LABEL, uy = y.label === UNASSIGNED_LABEL;
      if (ux !== uy) return ux ? -1 : 1;
      return y.order - x.order;
    });
  }, [articles]);

  function handleDrop(e, value) {
    e.preventDefault();
    setDragOverValue(null);
    const articleId = Number(e.dataTransfer.getData("text/plain"));
    const article = articles.find((a) => a.id === articleId);
    if (article && article[field] !== value) onPatch(article, { [field]: value });
  }

  return (
    <div>
      {!fixedPhase && (
        <div className="section-toolbar">
          {PHASES.map((p) => (
            <button key={p.key} className={`select-chip ${phaseKey === p.key ? "active" : ""}`} onClick={() => setPhaseKey(p.key)}>
              {p.label}
            </button>
          ))}
          {phase.c2r && !editAsAdmin && (
            <span className="admin-only-note">Étape réservée au C2R — demande à un membre du comité de glisser-déposer.</span>
          )}
        </div>
      )}

      {sections.map((section) => (
      <div className="kanban-issue" key={section.key}>
      <div className="kanban-issue__head">{section.label}<span className="kanban-issue__count">{section.articles.length}</span></div>
      <div className="kanban-board">
        {Array.from(groupByColumn(section.articles).entries()).map(([value, cards]) => {
          const col = columns.find((c) => c.value === value);
          return (
            <div
              key={`${section.key}|${value}`}
              className={`kanban-col ${dragOverValue === `${section.key}|${value}` ? "kanban-col--over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOverValue(`${section.key}|${value}`); }}
              onDragLeave={() => setDragOverValue((v) => (v === `${section.key}|${value}` ? null : v))}
              onDrop={(e) => handleDrop(e, value)}
            >
              <div className="kanban-col__head">
                <span className="color-swatch" style={{ background: col?.color || "#9aa5b1" }} />
                <span>{value || "(sans statut)"}</span>
                <span className="kanban-col__count">{cards.length}</span>
              </div>
              <div className="kanban-col__body">
                {cards.map((a) => (
                  <div
                    key={a.id}
                    className="kanban-card"
                    draggable={canDrag && pickingFor !== a.id}
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", String(a.id))}
                    style={{ cursor: canDrag ? "grab" : "default", opacity: canDrag ? 1 : 0.75 }}
                    title={canDrag ? "Glisser vers une autre colonne" : "Mode admin requis pour déplacer cette carte"}
                  >
                    <div className="kanban-card__title">{a.subject}</div>
                    <div className="kanban-card__meta">
                      {a.topic && <span className="tag" style={{ borderColor: a.topicColor || undefined }}>{a.topic}</span>}
                      {a.author && <span className="muted small">{a.author.displayName}</span>}
                    </div>
                    <div className="kanban-card__roles">
                      {ROLES.filter((r) => r.phase === phase.key && (!roleKeys || roleKeys.includes(r.key))).map((r) => (
                        <div key={r.key} className="kanban-card__role">
                          <b>{r.label} :</b>
                          <MemberPicker
                            members={members}
                            selectedIds={a[r.field] ? [a[r.field].id] : []}
                            onAdd={(id) => onPatch(a, { [r.key]: id })}
                            onRemove={() => onPatch(a, { [r.key]: null })}
                            onOpenChange={(open) => setPickingFor(open ? a.id : null)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                {cards.length === 0 && <div className="kanban-col__empty muted small">Vide</div>}
              </div>
            </div>
          );
        })}
      </div>
      </div>
      ))}

    </div>
  );
}

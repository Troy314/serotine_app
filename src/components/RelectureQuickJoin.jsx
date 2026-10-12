/** Non-admin-mode view of an article's relecture (proofreader) list: the
 * existing names as plain read-only tags, plus a single self-service
 * toggle for the current user — "I'll proofread this" / "I'm off it" —
 * rather than a picker that could assign anyone. The full multi-member
 * picker (RelectureEditor) is reserved for C2R. */
export default function RelectureQuickJoin({ members, selectedIds, currentUserId, onToggleSelf }) {
  const selected = members.filter((m) => selectedIds.includes(m.id));
  const amIn = selectedIds.includes(currentUserId);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center" }}>
      {selected.map((m) => (
        <span className={`tag ${m.active === false ? "tag--gone" : ""}`} key={m.id} title={m.active === false ? "N'est plus inscrit·e au projet Sérotine" : undefined}>{m.displayName}</span>
      ))}
      {amIn ? (
        <button className="icon-btn" title="Me retirer" onClick={onToggleSelf}>
          <i className="fa-solid fa-xmark" aria-hidden="true" />
        </button>
      ) : (
        <button className="btn-plain" onClick={onToggleSelf} disabled={!currentUserId}>
          <i className="fa-solid fa-plus" aria-hidden="true" /> Moi
        </button>
      )}
    </div>
  );
}

import { useToastList } from "../lib/toast.jsx";

const ICON = { info: "fa-circle-info", success: "fa-circle-check", error: "fa-triangle-exclamation" };
const COLOR = { info: "var(--violet)", success: "#1baf7a", error: "var(--danger)" };

export default function Toasts() {
  const { toasts, dismiss } = useToastList();
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", bottom: 16, right: 16, zIndex: 100, display: "flex", flexDirection: "column", gap: 8, maxWidth: 360 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className="card"
          style={{ margin: 0, padding: "10px 14px", display: "flex", alignItems: "flex-start", gap: 10, borderLeft: `3px solid ${COLOR[t.type]}` }}
        >
          <i className={`fa-solid ${ICON[t.type]}`} style={{ color: COLOR[t.type], marginTop: 2 }} aria-hidden="true" />
          <span style={{ flex: 1, fontSize: 13 }}>{t.message}</span>
          <button className="icon-btn" onClick={() => dismiss(t.id)} title="Fermer">
            <i className="fa-solid fa-xmark" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

// `access` picks who sees an item beyond the socle commun (À faire, Tableau de Bohr, Documents
// Technique, visible to everyone — undefined/omitted). Two kinds:
//  - "adminOnly" : C2R (isAdmin) only, no tag unlocks it (Statistiques).
//  - a pôle tag ("mise_en_page"/"podcast"/"communication") : requires that exact tag in
//    user.roles — 2026-10-09, C2R no longer bypasses this. Being on the comité de rédaction
//    doesn't by itself mean working on mise en page, podcast or communication ; someone needs
//    the actual tag (see AdminPanel.jsx's MemberTags) to see that section, C2R included.
const ITEMS = [
  { id: "todo", icon: "fa-solid fa-list-check", label: "À faire" },
  { id: "bohr", icon: "fa-solid fa-table-list", label: "Tableau de Bohr" },
  { id: "miseenpage", icon: "fa-solid fa-palette", label: "Mise en page", access: "mise_en_page" },
  { id: "complan", icon: "fa-solid fa-bullhorn", label: "Plan de Communication", access: "communication" },
  { id: "podcast", icon: "fa-solid fa-microphone", label: "Podcast", access: "podcast" },
  { id: "docs", icon: "fa-solid fa-folder-open", label: "Documents Technique" },
  { id: "stats", icon: "fa-solid fa-chart-column", label: "Statistiques", access: "adminOnly" },
];

// Icon-only rail — labels survive as a custom CSS hover tooltip
// (data-tooltip, styled in styles.css) rather than visible text, to keep
// the pane narrow, and rather than the native `title` tooltip, which is
// slow to appear and unstyled.
export default function LeftNav({ section, onSelect, siteUrl, user }) {
  const isAdmin = !!user?.isAdmin;
  const roles = user?.roles || [];
  const visible = ITEMS.filter((item) => {
    if (!item.access) return true; // socle commun
    if (item.access === "adminOnly") return isAdmin;
    return roles.includes(item.access); // pôle : C2R ne passe plus outre
  });
  return (
    <>
      <ul className="nav-list">
        {visible.map((item) => (
          <li key={item.id}>
            <button
              className={`nav-btn ${section === item.id ? "active" : ""}`}
              onClick={() => onSelect(item.id)}
              data-tooltip={item.label}
              aria-label={item.label}
            >
              <span className="nav-btn__icon"><i className={item.icon} aria-hidden="true" /></span>
              <span className="nav-btn__label">{item.label}</span>
            </button>
          </li>
        ))}
        {isAdmin && (
          <li>
            <button
              className={`nav-btn ${section === "admin" ? "active" : ""}`}
              onClick={() => onSelect("admin")}
              data-tooltip="Administration"
              aria-label="Administration"
            >
              <span className="nav-btn__icon"><i className="fa-solid fa-gear" aria-hidden="true" /></span>
              <span className="nav-btn__label">Administration</span>
            </button>
          </li>
        )}
      </ul>
      <div className="nav-footer">
        <a
          className="nav-btn"
          href={siteUrl || "https://serotine.fr"}
          target="_blank"
          rel="noreferrer"
          data-tooltip="Sérotine.fr"
          aria-label="Sérotine.fr"
        >
          <span className="nav-btn__icon nav-btn__icon--logo">
            <img src="/media/serotine-mark.svg" alt="" />
          </span>
          <span className="nav-btn__label">Sérotine.fr</span>
        </a>
      </div>
    </>
  );
}

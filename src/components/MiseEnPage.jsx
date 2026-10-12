import LinkSettingsEditor from "./LinkSettingsEditor.jsx";
import BohrPhasePanel from "./BohrPhasePanel.jsx";

const FIELDS = [
  { key: "mise_en_page_canva_url", label: "Dossier Canva (Mise en page)" },
  { key: "heyzine_url", label: "Page Heyzine" },
  { key: "mise_en_page_canva_embed_url", label: "Canva à intégrer (URL de partage publique)" },
];

// Canva's own embed convention: a public design's share URL, with an
// `embed` query flag appended, works directly as an <iframe> src (no
// special embed-code generation needed on Canva's side for a public
// design). Handles a URL that already has a query string.
function toCanvaEmbedUrl(url) {
  if (!url) return null;
  return url.includes("?") ? `${url}&embed` : `${url}?embed`;
}

export default function MiseEnPage({ settings, isAdmin, isSuperAdmin, onSettingsChanged }) {
  return (
    <div>
    <div className="card">
      <div className="link-row">
        {settings.mise_en_page_canva_url ? (
          <a className="link-btn" href={settings.mise_en_page_canva_url} target="_blank" rel="noreferrer">
            <i className="fa-solid fa-palette" aria-hidden="true" /> Dossier Canva <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
          </a>
        ) : (
          <span className="admin-only-note">Lien Canva non configuré.</span>
        )}
        {settings.heyzine_url ? (
          <a className="link-btn" href={settings.heyzine_url} target="_blank" rel="noreferrer">
            <i className="fa-solid fa-book-open" aria-hidden="true" /> Page Heyzine <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
          </a>
        ) : (
          <span className="admin-only-note">Lien Heyzine non configuré.</span>
        )}
        {isSuperAdmin && <LinkSettingsEditor fields={FIELDS} settings={settings} onSaved={onSettingsChanged} />}
      </div>

      {settings.mise_en_page_canva_embed_url ? (
        <div style={{ position: "relative", width: "100%", paddingTop: "56.25%", marginTop: 12 }}>
          <iframe
            src={toCanvaEmbedUrl(settings.mise_en_page_canva_embed_url)}
            title="Présentation Canva"
            allow="fullscreen"
            allowFullScreen
            // Defense-in-depth: this URL is admin-supplied (Administration
            // is already a trusted role), but there's no reason to hand a
            // random embedded page more than it needs — Canva's viewer
            // needs scripts/same-origin/popups/forms to actually work,
            // nothing else.
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-presentation"
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}
          />
        </div>
      ) : (
        <p className="admin-only-note" style={{ marginTop: 12 }}>
          Aucune présentation Canva intégrée — colle l'URL de partage publique d'un design Canva dans « Canva à intégrer ».
        </p>
      )}
    </div>

    <h3>Sujets en mise en page et illustration</h3>
    <BohrPhasePanel
      isAdmin={isAdmin}
      views={[
        { label: "Mise en page", phaseKey: "etatMiseEnPage" },
        { label: "Illustration", phaseKey: "illustrations" },
      ]}
    />
    </div>
  );
}

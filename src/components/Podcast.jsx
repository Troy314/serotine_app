import EditableLinkList from "./EditableLinkList.jsx";
import LinkSettingsEditor from "./LinkSettingsEditor.jsx";
import BohrPhasePanel from "./BohrPhasePanel.jsx";

const FIELDS = [{ key: "podcast_rss_url", label: "RSS.com" }];

export default function Podcast({ settings, isAdmin, isSuperAdmin, onSettingsChanged }) {
  return (
    <div>
      <div className="card">
        <h3>Plateformes</h3>
        <EditableLinkList section="podcast" canEdit={isSuperAdmin} />

        <h3 style={{ marginTop: 20 }}>RSS.com</h3>
        <div className="link-row">
          {settings.podcast_rss_url ? (
            <a className="link-btn" href={settings.podcast_rss_url} target="_blank" rel="noreferrer">
              <i className="fa-solid fa-podcast" aria-hidden="true" /> RSS.com <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
            </a>
          ) : (
            <span className="admin-only-note">Lien RSS.com non configuré.</span>
          )}
          {isSuperAdmin && <LinkSettingsEditor fields={FIELDS} settings={settings} onSaved={onSettingsChanged} />}
        </div>
      </div>

      <h3>Sujets en version audio</h3>
      <BohrPhasePanel
        isAdmin={isAdmin}
        views={[
          { label: "Audio", phaseKey: "etatAudio" },
          { label: "Montage", phaseKey: "etatAudio", roleKeys: ["montageId"] },
        ]}
      />
    </div>
  );
}

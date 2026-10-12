import { useEffect, useState } from "react";
import { api } from "../lib/api.js";
import { useToast } from "../lib/toast.jsx";
import { BOHR_COLUMNS, COMPLAN_COLUMNS } from "../lib/columnWidths.js";

// Secours de développement uniquement (sans annuaire core_db) : rôle Discord qui donne accès. En fonctionnement normal l'accès vient du projet Sérotine dans core_db.
const DISCORD_FIELDS = [{ key: "discord_role_id", label: "Rôle Discord — accès à l'application (mode sans annuaire)" }];

const SETTINGS_FIELDS = [
  { key: "ics_url", label: "Calendrier (URL ICS)" },
  { key: "minutes_url", label: "Comptes-rendus (lien Nextcloud Collective — l'accès dépend des droits Nextcloud de la personne, pas de Sérotine App)" },
  { key: "mise_en_page_canva_url", label: "Canva — Mise en page" },
  { key: "mise_en_page_canva_embed_url", label: "Canva à intégrer (Mise en page)" },
  { key: "heyzine_url", label: "Heyzine" },
  { key: "comm_canva_url", label: "Canva — Communication" },
  { key: "fedica_url", label: "Fedica" },
  { key: "podcast_rss_url", label: "RSS.com" },
  { key: "serotine_site_url", label: "Sérotine.fr" },
];

// Les liens/images en haut de chaque page — super admin seulement (miroir de PAGE_LINK_SETTINGS
// côté serveur, qui refuse de toute façon l'enregistrement si quelqu'un d'autre les touche ici).
const PAGE_LINK_KEYS = new Set(["mise_en_page_canva_url", "mise_en_page_canva_embed_url", "heyzine_url", "comm_canva_url", "fedica_url", "podcast_rss_url"]);

const STATUS_FIELDS = [
  { key: "etat_redaction", label: "État rédaction" },
  { key: "etat_mise_en_page", label: "État mise en page" },
  { key: "illustrations", label: "Illustrations" },
  { key: "etat_audio", label: "État audio" },
  { key: "communication_rs", label: "Communication RS" },
  { key: "concept", label: "Concept" },
];

function SettingsTab({ settings, onSaved, accessMode, isSuperAdmin }) {
  const allFields = [...DISCORD_FIELDS, ...SETTINGS_FIELDS];
  const [form, setForm] = useState(() => Object.fromEntries(allFields.map((f) => [f.key, settings[f.key] || ""])));
  async function save(e) {
    e.preventDefault();
    await api.settings.update(form);
    onSaved?.();
  }
  return (
    <form className="card" onSubmit={save}>
      <h3>Accès à l'outil</h3>
      {accessMode === "directory" ? (
        <p className="admin-only-note">
          L'accès se décide ainsi : la personne se connecte avec <strong>Discord</strong> (seule méthode pour l'instant), puis doit être <strong>inscrite au projet
          Sérotine</strong> dans l'annuaire de l'association (<code>core_db</code>) — rien à régler ici. Les membres du <strong>comité de rédaction</strong> se
          désignent dans l'onglet « Membres & Crédits ». Ni rôle ni serveur Discord n'intervient plus.
        </p>
      ) : (
        <>
          <p className="admin-only-note">
            Mode sans annuaire (développement) : l'accès repose sur un rôle Discord — un ID de rôle (pas un nom), clic droit sur le rôle dans Discord
            (mode développeur) → « Copier l'ID du rôle ».
          </p>
          {DISCORD_FIELDS.map((f) => (
            <div className="field" key={f.key}>
              <label>{f.label}</label>
              <input value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder="ID de rôle Discord" />
            </div>
          ))}
        </>
      )}

      <h3 style={{ marginTop: 20 }}>Liens</h3>
      {PAGE_LINK_KEYS.size > 0 && !isSuperAdmin && (
        <p className="admin-only-note">
          Les liens en haut de chaque page (Canva, Heyzine, Fedica, RSS.com) sont réservés au super admin — lecture seule ici.
        </p>
      )}
      {SETTINGS_FIELDS.map((f) => (
        <div className="field" key={f.key}>
          <label>{f.label}</label>
          <input
            value={form[f.key]}
            onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
            placeholder="https://…"
            disabled={PAGE_LINK_KEYS.has(f.key) && !isSuperAdmin}
          />
        </div>
      ))}
      <button className="link-btn" type="submit">Enregistrer</button>
    </form>
  );
}

// Reads a settings JSON-string column-width map, filling in any column
// missing from it (or the whole thing being unset/malformed) with that
// column's own hardcoded default — so a brand-new install, or a column
// added after someone last saved this form, still shows a sane starting
// value instead of blank/NaN.
function parseWidths(json, meta) {
  let overrides = {};
  if (json) {
    try {
      overrides = JSON.parse(json);
    } catch {
      overrides = {};
    }
  }
  return Object.fromEntries(meta.map((c) => [c.key, Number(overrides[c.key]) || c.defaultWidth]));
}

function ColumnsTab({ settings, onSaved }) {
  const [bohrWidths, setBohrWidths] = useState(() => parseWidths(settings.bohr_column_widths, BOHR_COLUMNS));
  const [complanWidths, setComplanWidths] = useState(() => parseWidths(settings.complan_column_widths, COMPLAN_COLUMNS));

  async function save(e) {
    e.preventDefault();
    await api.settings.update({
      bohr_column_widths: JSON.stringify(bohrWidths),
      complan_column_widths: JSON.stringify(complanWidths),
    });
    onSaved?.();
  }

  return (
    <form className="card" onSubmit={save}>
      <p className="admin-only-note">
        Largeur des colonnes (en pixels) pour Tableau de Bohr et Plan de Communication —
        pratique quand un texte est coupé ou qu'une colonne prend trop de place.
      </p>

      <h3>Tableau de Bohr</h3>
      <button
        type="button"
        className="icon-btn"
        style={{ marginBottom: 8 }}
        title="Réinitialiser aux valeurs par défaut"
        onClick={() => setBohrWidths(Object.fromEntries(BOHR_COLUMNS.map((c) => [c.key, c.defaultWidth])))}
      >
        <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Réinitialiser
      </button>
      <div className="row-2">
        {BOHR_COLUMNS.filter((c) => !c.fixed).map((c) => (
          <div className="field" key={c.key}>
            <label>{c.label}</label>
            <input
              type="number"
              min={30}
              value={bohrWidths[c.key]}
              onChange={(e) => setBohrWidths({ ...bohrWidths, [c.key]: Number(e.target.value) || c.defaultWidth })}
            />
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 24 }}>Plan de Communication</h3>
      <button
        type="button"
        className="icon-btn"
        style={{ marginBottom: 8 }}
        title="Réinitialiser aux valeurs par défaut"
        onClick={() => setComplanWidths(Object.fromEntries(COMPLAN_COLUMNS.map((c) => [c.key, c.defaultWidth])))}
      >
        <i className="fa-solid fa-rotate-left" aria-hidden="true" /> Réinitialiser
      </button>
      <div className="row-2">
        {COMPLAN_COLUMNS.map((c) => (
          <div className="field" key={c.key}>
            <label>{c.label}</label>
            <input
              type="number"
              min={30}
              value={complanWidths[c.key]}
              onChange={(e) => setComplanWidths({ ...complanWidths, [c.key]: Number(e.target.value) || c.defaultWidth })}
            />
          </div>
        ))}
      </div>

      <button className="link-btn" type="submit" style={{ marginTop: 16 }}>Enregistrer</button>
    </form>
  );
}

// The Brevo API key never round-trips to the browser (see server/index.js's
// SECRET_SETTINGS) — this only ever gets back { connected, senderName,
// senderEmail }, never the key itself, same as achievement-vault's GitHub
// PAT / Steam key forms. Leaving the "clé API" field blank on save keeps
// whatever's already stored, so updating just the sender name doesn't
// force re-pasting the key.
function NewsletterTab() {
  const showToast = useToast();
  const [status, setStatus] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [senderName, setSenderName] = useState("");
  const [senderEmail, setSenderEmail] = useState("");

  function load() {
    api.newsletter.brevoStatus().then((s) => {
      setStatus(s);
      setSenderName(s.senderName || "");
      setSenderEmail(s.senderEmail || "");
    });
  }
  useEffect(load, []);

  async function save(e) {
    e.preventDefault();
    await api.newsletter.saveBrevo({ apiKey: apiKey.trim(), senderName, senderEmail });
    setApiKey("");
    showToast("Réglages Brevo enregistrés.");
    load();
  }

  async function disconnect() {
    if (!confirm("Déconnecter Brevo ? La clé API enregistrée sera supprimée.")) return;
    await api.newsletter.disconnectBrevo();
    showToast("Brevo déconnecté.");
    load();
  }

  if (!status) return <p className="muted">Chargement…</p>;

  return (
    <form className="card" onSubmit={save}>
      <h3>Envoi de newsletter (Brevo)</h3>
      <p className="admin-only-note">
        {status.connected
          ? "Brevo est connecté — le générateur de newsletter peut envoyer un test puis la diffusion, à des adresses saisies à la main (pas encore de liste Brevo)."
          : "Non connecté. Créez une clé API dans Brevo (Paramètres → Clés API SMTP & API) et collez-la ici."}
      </p>
      <div className="field">
        <label>Clé API Brevo {status.connected && "(déjà enregistrée — laisser vide pour la garder)"}</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={status.connected ? "••••••••••••" : "xkeysib-…"}
        />
      </div>
      <div className="row-2">
        <div className="field">
          <label>Nom d'expéditeur</label>
          <input value={senderName} onChange={(e) => setSenderName(e.target.value)} placeholder="Sérotine" />
        </div>
        <div className="field">
          <label>Adresse d'expédition</label>
          <input
            type="email"
            value={senderEmail}
            onChange={(e) => setSenderEmail(e.target.value)}
            placeholder="webzine@auroralpes.fr"
          />
        </div>
      </div>
      <p className="admin-only-note">
        L'adresse d'expédition doit être vérifiée dans Brevo (Expéditeurs & IP) avant de pouvoir l'utiliser.
      </p>
      <div style={{ display: "flex", gap: 10 }}>
        <button className="link-btn" type="submit">Enregistrer</button>
        {status.connected && (
          <button className="link-btn secondary" type="button" onClick={disconnect}>Déconnecter</button>
        )}
      </div>
    </form>
  );
}

function StatusOptionsTab() {
  const [byField, setByField] = useState({});
  const [topics, setTopics] = useState([]);
  const [newOpt, setNewOpt] = useState({});
  const [newTopic, setNewTopic] = useState({ name: "", color: "#65466e" });

  function load() {
    api.statusOptions.list().then((opts) => {
      const grouped = {};
      for (const o of opts) (grouped[o.field] ||= []).push(o);
      setByField(grouped);
    });
    api.topics.list().then(setTopics);
  }
  useEffect(load, []);

  async function saveOption(o, body) {
    await api.statusOptions.update(o.id, body);
    load();
  }
  async function removeOption(o) {
    await api.statusOptions.remove(o.id);
    load();
  }
  async function addOption(field) {
    const draft = newOpt[field];
    if (!draft?.value?.trim()) return;
    await api.statusOptions.create({ field, value: draft.value.trim(), color: draft.color || "#9aa5b1" });
    setNewOpt({ ...newOpt, [field]: { value: "", color: "#9aa5b1" } });
    load();
  }

  async function saveTopic(t, body) {
    await api.topics.update(t.id, body);
    load();
  }
  async function removeTopic(t) {
    await api.topics.remove(t.id);
    load();
  }
  async function addTopic() {
    if (!newTopic.name.trim()) return;
    await api.topics.create(newTopic);
    setNewTopic({ name: "", color: "#65466e" });
    load();
  }

  return (
    <div>
      {STATUS_FIELDS.map((f) => (
        <div className="card" key={f.key}>
          <h3>{f.label}</h3>
          {(byField[f.key] || []).map((o) => (
            <div key={o.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <input type="color" value={o.color} onChange={(e) => saveOption(o, { color: e.target.value })} />
              <input value={o.value} onChange={(e) => saveOption(o, { value: e.target.value })} style={{ width: 200 }} />
              <button className="icon-btn" onClick={() => removeOption(o)}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="color"
              value={newOpt[f.key]?.color || "#9aa5b1"}
              onChange={(e) => setNewOpt({ ...newOpt, [f.key]: { ...newOpt[f.key], color: e.target.value } })}
            />
            <input
              placeholder="Nouvelle valeur…"
              value={newOpt[f.key]?.value || ""}
              onChange={(e) => setNewOpt({ ...newOpt, [f.key]: { ...newOpt[f.key], value: e.target.value } })}
              style={{ width: 200 }}
            />
            <button className="link-btn secondary" onClick={() => addOption(f.key)}>+ ajouter</button>
          </div>
        </div>
      ))}

      <div className="card">
        <h3>Thématiques scientifiques</h3>
        {topics.map((t) => (
          <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <input type="color" value={t.color} onChange={(e) => saveTopic(t, { color: e.target.value })} />
            <input value={t.name} onChange={(e) => saveTopic(t, { name: e.target.value })} style={{ width: 200 }} />
            <button className="icon-btn" onClick={() => removeTopic(t)}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="color" value={newTopic.color} onChange={(e) => setNewTopic({ ...newTopic, color: e.target.value })} />
          <input placeholder="Nouvelle thématique…" value={newTopic.name} onChange={(e) => setNewTopic({ ...newTopic, name: e.target.value })} style={{ width: 200 }} />
          <button className="link-btn secondary" onClick={addTopic}>+ ajouter</button>
        </div>
      </div>
    </div>
  );
}

function MembersTab() {
  const showToast = useToast();
  const [members, setMembers] = useState([]);
  const [mergeTarget, setMergeTarget] = useState({});
  const [importing, setImporting] = useState(false);

  function load() {
    api.members.list().then(setMembers);
  }
  useEffect(load, []);

  async function importFromCoreDb() {
    setImporting(true);
    try {
      const { created } = await api.members.importFromCoreDb();
      showToast(
        created.length === 0
          ? "Aucun nouveau membre à ajouter : tout le monde du projet Sérotine a déjà un profil."
          : `${created.length} membre(s) ajouté(s) : ${created.map((c) => c.displayName).join(", ")}`,
        { type: created.length === 0 ? "info" : "success" }
      );
      load();
    } catch (err) {
      showToast(err.message, { type: "error" });
    } finally {
      setImporting(false);
    }
  }

  async function save(m, body) {
    try {
      await api.members.update(m.id, body);
      load();
    } catch (err) {
      // Most likely a duplicate Discord ID (the column is UNIQUE) — surface
      // it instead of letting the update silently no-op in the UI.
      showToast(err.message, { type: "error" });
      load(); // re-fetch so the input snaps back to whatever's actually saved
    }
  }
  async function remove(m) {
    if (!confirm(`Supprimer ${m.displayName} ? (les champs qui y font référence seront vidés)`)) return;
    await api.members.remove(m.id);
    load();
  }
  async function merge(m) {
    const targetId = mergeTarget[m.id];
    if (!targetId) return;
    // Name the actual target, not just "le membre choisi" — a vague
    // confirm here is exactly what let a real merge-the-wrong-way mistake
    // through once already (the row you click "merge" on is the one that
    // gets DELETED, not the one that survives).
    const target = members.find((x) => String(x.id) === String(targetId));
    if (
      !confirm(
        `« ${m.displayName} » sera SUPPRIMÉ et fusionné dans « ${target?.displayName || "?"} », qui sera conservé.\n\nCette action est irréversible. Continuer ?`
      )
    )
      return;
    try {
      await api.members.mergeInto(m.id, targetId);
      load();
    } catch (err) {
      showToast(err.message, { type: "error" });
    }
  }

  return (
    <div className="card" style={{ overflowX: "auto" }}>
      <p className="admin-only-note">
        Un membre sans compte Discord lié (créé par l'import ou ajouté à la main) peut être fusionné
        dans le vrai membre une fois que la personne s'est connectée au moins une fois.
      </p>
      <p className="admin-only-note">
        <strong>Tags</strong> : <strong>C2R</strong> (comité de rédaction) débloque les accès du comité (champs réservés du Tableau de Bohr — toujours actifs, plus de bascule —,
        Administration, vue d'équipe de « À faire », Statistiques). Ça ne donne <em>pas</em> accès à Mise en page / Podcast / Communication : il faut le tag du pôle
        correspondant, C2R compris. <strong>Super Admin</strong> (implique C2R) va plus loin : seul·e à pouvoir modifier les liens/images en haut de chaque page, et
        « se connecter en tant que » (onglet dédié) — à n'accorder qu'avec confiance, c'est un compte complet d'un·e autre membre. Les trois tags de pôle donnent accès
        à une section en plus du socle commun (Tableau de Bohr, À faire, Documents Technique) — indépendants, une personne peut en porter plusieurs. Gardés dans la base
        privée de l'outil, gérés uniquement ici.
      </p>
      <p className="admin-only-note">
        <button className="link-btn secondary" onClick={importFromCoreDb} disabled={importing}>
          <i className="fa-solid fa-rotate" aria-hidden="true" /> {importing ? "Vérification…" : "Ajouter les nouveaux membres du projet Sérotine"}
        </button>{" "}
        Crée un profil (sans compte au comité) pour chaque personne déjà inscrite au projet Sérotine dans l'annuaire de l'association qui n'a pas encore de profil ici — sans attendre sa première connexion. N'enlève et ne modifie jamais personne.
      </p>
      <table className="data-table">
        <thead>
          <tr>
            <th>Nom</th>
            <th>ID Discord</th>
            <th>LinkedIn</th>
            <th>Instagram</th>
            <th>Bluesky</th>
            <th>Collab Insta</th>
            <th>Tags</th>
            <th>Cette ligne disparaît, fusionnée dans…</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td><input value={m.displayName} onChange={(e) => save(m, { displayName: e.target.value })} style={{ width: 130 }} />{m.archived ? <div className="muted small" title="Archivé·e : n'est plus proposé·e dans les listes de choix ni désignable ; garde son nom sur ses anciens articles">archivé·e</div> : m.active === false && <div className="muted small" title="Plus inscrit·e au projet Sérotine : ne peut plus se connecter ni être désigné·e ; garde son nom sur ses anciens articles">plus au projet</div>}</td>
              <td>
                <input
                  value={m.discordId || ""}
                  onChange={(e) => save(m, { discordId: e.target.value })}
                  placeholder="non lié — coller un ID Discord"
                  style={{ width: 150 }}
                />
                {m.discordUsername && <div className="muted small">{m.discordUsername}</div>}
              </td>
              <td><input value={m.creditLinkedin} onChange={(e) => save(m, { creditLinkedin: e.target.value })} style={{ width: 130 }} /></td>
              <td><input value={m.creditInstagram} onChange={(e) => save(m, { creditInstagram: e.target.value })} style={{ width: 130 }} /></td>
              <td><input value={m.creditBluesky} onChange={(e) => save(m, { creditBluesky: e.target.value })} style={{ width: 130 }} /></td>
              <td><input type="checkbox" checked={m.collabInstagram} onChange={(e) => save(m, { collabInstagram: e.target.checked })} /></td>
              <td><MemberTags member={m} onChange={(body) => save(m, body)} /></td>
              <td>
                <select value={mergeTarget[m.id] || ""} onChange={(e) => setMergeTarget({ ...mergeTarget, [m.id]: e.target.value })}>
                  <option value="">—</option>
                  {members.filter((x) => x.id !== m.id).map((x) => <option key={x.id} value={x.id}>{x.displayName}</option>)}
                </select>
                <button className="icon-btn" title={`Supprimer « ${m.displayName} » et transférer ses données vers le membre choisi`} onClick={() => merge(m)}>
                  <i className="fa-solid fa-arrow-right" aria-hidden="true" />
                </button>
              </td>
              <td>
                <button
                  className="icon-btn"
                  title={m.archived ? "Désarchiver : redevient proposé·e dans les listes" : "Archiver : n'est plus proposé·e ni désignable, garde son nom sur l'existant"}
                  onClick={() => save(m, { archived: !m.archived })}
                >
                  <i className={`fa-solid ${m.archived ? "fa-box-open" : "fa-box-archive"}`} aria-hidden="true" />
                </button>
                <button className="icon-btn" onClick={() => remove(m)}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// One unified tag-selection control per member: C2R (comité de rédaction) plus the three pôles.
// C2R toggles `isAdmin` (the real security boundary, a separate column — see server/db.js) ; the
// other three toggle membership in the `roles` tag array. Visually a single control either way.
const TAG_DEFS = [
  { key: "c2r", label: "C2R", title: "Comité de rédaction — débloque tous les accès (Statistiques, Administration, champs réservés…) et donne accès à tout le reste" },
  { key: "mise_en_page", label: "Mise en page", title: "Accès à la section Mise en page" },
  { key: "podcast", label: "Podcast", title: "Accès à la section Podcast" },
  { key: "communication", label: "Communication", title: "Accès à la section Plan de Communication" },
  { key: "super_admin", label: "Super Admin", title: "Un cran au-dessus du C2R (qu'il implique) : seul·e à pouvoir modifier les liens/images en haut de chaque page, et « se connecter en tant que »" },
];
function MemberTags({ member, onChange }) {
  function toggle(key) {
    if (key === "c2r") {
      // Désactiver C2R désactive aussi le super admin (le serveur l'impose de toute façon) — reflété
      // ici tout de suite pour ne pas attendre un rechargement.
      onChange(member.isAdmin ? { isAdmin: false, isSuperAdmin: false } : { isAdmin: true });
      return;
    }
    if (key === "super_admin") {
      // Devenir super admin implique C2R (le serveur l'impose aussi).
      onChange(member.isSuperAdmin ? { isSuperAdmin: false } : { isSuperAdmin: true, isAdmin: true });
      return;
    }
    const has = member.roles.includes(key);
    onChange({ roles: has ? member.roles.filter((r) => r !== key) : [...member.roles, key] });
  }
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {TAG_DEFS.map((t) => {
        const active = t.key === "c2r" ? member.isAdmin : t.key === "super_admin" ? member.isSuperAdmin : member.roles.includes(t.key);
        return (
          <button
            key={t.key}
            type="button"
            className={`select-chip ${active ? "active" : ""}`}
            title={t.title}
            onClick={() => toggle(t.key)}
            style={{ fontSize: 11, padding: "2px 8px" }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// "Se connecter en tant que" (2026-10-09, super admin only) : voir l'appli comme un autre membre
// la voit, pour tester ou aider sans lui demander ses identifiants — même idée que le menu
// équivalent d'AurAgenda. Le serveur journalise chaque passage (server/index.js, impersonation_log)
// et n'accorde jamais plus de droits que ceux de la personne imitée (voir requireSuperAdmin).
function ImpersonateTab() {
  const showToast = useToast();
  const [members, setMembers] = useState([]);
  const [target, setTarget] = useState("");
  const [log, setLog] = useState([]);

  function load() {
    api.admin.impersonatable().then(setMembers);
    api.admin.impersonationLog().then(setLog).catch(() => {});
  }
  useEffect(load, []);

  async function go() {
    if (!target) return;
    try {
      await api.admin.impersonate(target);
      window.location.reload(); // repart de zéro comme la personne imitée (nav, sections visibles, etc.)
    } catch (err) {
      showToast(err.message, { type: "error" });
    }
  }

  return (
    <div className="card">
      <p className="admin-only-note">
        Tu vois alors l'application exactement comme cette personne la voit — pas plus, pas moins. Une barre en haut de l'écran permet de revenir à ton
        compte à tout moment. Journalisé (ci-dessous) : qui a vu l'appli comme qui, et quand.
      </p>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 20 }}>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">— choisir un membre —</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName}</option>
          ))}
        </select>
        <button className="link-btn" onClick={go} disabled={!target}>Se connecter en tant que</button>
      </div>
      <table className="data-table">
        <thead><tr><th>Admin</th><th>Vu comme</th><th>Début</th><th>Fin</th></tr></thead>
        <tbody>
          {log.map((l) => (
            <tr key={l.id}>
              <td>{l.admin_name}</td>
              <td>{l.target_name}</td>
              <td>{l.started_at}</td>
              <td>{l.ended_at || <span className="muted small">en cours</span>}</td>
            </tr>
          ))}
          {log.length === 0 && <tr><td colSpan={4} className="muted small">Aucun passage pour l'instant.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function formatBytes(n) {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

function BackupsTab() {
  const [backups, setBackups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [restarting, setRestarting] = useState(false);

  function load() {
    api.maintenance.listBackups().then((b) => {
      setBackups(b);
      setLoading(false);
    });
  }
  useEffect(load, []);

  async function backupNow() {
    setWorking(true);
    try {
      await api.maintenance.backupNow();
      load();
    } finally {
      setWorking(false);
    }
  }

  async function restore(name) {
    // Genuine two-step confirm, not the instant+undo pattern used
    // elsewhere in this app — an undo toast doesn't make sense for
    // something that needs a server restart to even take effect, and
    // replacing the *entire* database warrants more friction than
    // deleting one row.
    if (!confirm(`Restaurer la sauvegarde « ${name} » ? Toutes les données actuelles seront remplacées.`)) return;
    if (!confirm("Vraiment sûr ? Cette action redémarre le serveur et est irréversible (une sauvegarde de sécurité de l'état actuel sera quand même prise avant).")) return;
    try {
      await api.maintenance.restore(name);
    } catch {
      // The server closes its DB and exits right after responding — a
      // network error here is the expected shape of "it worked", not a
      // real failure.
    }
    setRestarting(true);
  }

  if (restarting) {
    return (
      <div className="card">
        <h3>Restauration en cours</h3>
        <p>Le serveur redémarre. Recharge cette page dans quelques secondes.</p>
      </div>
    );
  }

  return (
    <div className="card table-scroll">
      <p className="admin-only-note">
        Une sauvegarde automatique est prise une fois par jour au démarrage du serveur (les 14 dernières
        sont conservées). Une sauvegarde manuelle ou de sécurité avant restauration n'est jamais supprimée automatiquement.
      </p>
      <button className="link-btn" onClick={backupNow} disabled={working} style={{ marginBottom: 12 }}>
        <i className="fa-solid fa-database" aria-hidden="true" /> {working ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
      </button>
      {loading ? (
        <p className="muted">Chargement…</p>
      ) : (
        <table className="data-table">
          <thead>
            <tr>
              <th>Fichier</th>
              <th>Date</th>
              <th>Taille</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {backups.map((b) => (
              <tr key={b.name}>
                <td className="small">{b.name}</td>
                <td className="small">{new Date(b.mtime).toLocaleString("fr-FR")}</td>
                <td className="small">{formatBytes(b.size)}</td>
                <td>
                  <button className="icon-btn" title="Restaurer cette sauvegarde" onClick={() => restore(b.name)}>
                    <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
            {backups.length === 0 && <tr><td colSpan={4} className="muted">Aucune sauvegarde pour le moment.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}

export default function AdminPanel({ settings, onSettingsChanged, accessMode, isSuperAdmin }) {
  const [tab, setTab] = useState("settings");
  return (
    <div>
      <div className="tabs">
        <button className={`tab-btn ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>Liens & paramètres</button>
        <button className={`tab-btn ${tab === "statuses" ? "active" : ""}`} onClick={() => setTab("statuses")}>Statuts & couleurs</button>
        <button className={`tab-btn ${tab === "columns" ? "active" : ""}`} onClick={() => setTab("columns")}>Colonnes</button>
        <button className={`tab-btn ${tab === "members" ? "active" : ""}`} onClick={() => setTab("members")}>Membres & Crédits</button>
        <button className={`tab-btn ${tab === "newsletter" ? "active" : ""}`} onClick={() => setTab("newsletter")}>Newsletter</button>
        <button className={`tab-btn ${tab === "backups" ? "active" : ""}`} onClick={() => setTab("backups")}>Sauvegardes</button>
        {isSuperAdmin && <button className={`tab-btn ${tab === "impersonate" ? "active" : ""}`} onClick={() => setTab("impersonate")}>Se connecter en tant que</button>}
      </div>
      {tab === "settings" && <SettingsTab settings={settings} onSaved={onSettingsChanged} accessMode={accessMode} isSuperAdmin={isSuperAdmin} />}
      {tab === "statuses" && <StatusOptionsTab />}
      {tab === "columns" && <ColumnsTab settings={settings} onSaved={onSettingsChanged} />}
      {tab === "members" && <MembersTab />}
      {tab === "newsletter" && <NewsletterTab />}
      {tab === "backups" && <BackupsTab />}
      {tab === "impersonate" && isSuperAdmin && <ImpersonateTab />}
    </div>
  );
}

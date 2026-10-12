import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import StatusSelect from "./StatusSelect.jsx";
import MemberSelect from "./MemberSelect.jsx";
import RelectureEditor from "./RelectureEditor.jsx";
import RelectureQuickJoin from "./RelectureQuickJoin.jsx";
import AchievementBadge from "./AchievementBadge.jsx";
import BohrKanban from "./BohrKanban.jsx";
import { seasonSortKey } from "../lib/seasons.js";
import { useToast } from "../lib/toast.jsx";
import { BOHR_COLUMNS, buildColumnList } from "../lib/columnWidths.js";

// The cells styled grey below (via `c2rCls`) mirror server/index.js's
// C2R_ONLY_FIELDS — everything the server silently ignores writes to from
// a non-admin. Les responsables (correction, sources, mise en page, illustration, enregistrement, montage,
// communication) ne sont PAS restreints côté serveur : ils s'affichent et se modifient dans le Kanban (BohrKanban.jsx),
// plus dans la liste.

// The real Saison 3 sheet used this exact label for a subject not yet
// slotted into an issue ("cut into" a specific magazine, i.e. laid out) —
// reused here as the default bucket for a freshly-created article and for
// any article an admin pulls back out of an issue.
const UNASSIGNED_LABEL = "À découper";

// The real sheet's own five column groups (its row-2 headers: "Couv |
// Rédaction | Relecture | Mise en page | Version audio | Communication").
// Each is independently toggleable in the list view, same as collapsing a
// column group in Excel — "Couv" isn't included here since its one real
// column (the issue label) is already its own admin-mode-only "Numéro"
// control, not a content field to show/hide. Sujet itself is always
// shown regardless of the Rédaction toggle, even though the real sheet's
// grouping includes it — hiding the one column that identifies which
// article a row even *is* would make every other group meaningless to
// look at on its own.
const GROUPS = [
  { key: "redaction", label: "Rédaction", fields: ["topic", "author", "concept", "etatRedaction"] },
  { key: "relecture", label: "Relecture", fields: ["relecture", "correctionValide", "sourceValide", "ligneEditoriale", "comiteSci"] },
  { key: "miseenpage", label: "Mise en page", fields: ["etatMiseEnPage", "illustrations", "pages"] },
  { key: "audio", label: "Version audio", fields: ["etatAudio", "podcastUrl"] },
  { key: "communication", label: "Communication", fields: ["linkedPosts"] },
];

// « 2026-09-21 » → « 21/09/2026 » (découpage du texte, pas de Date : pas de décalage de fuseau) ; « Sans date » si vide.
function formatPostDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "Sans date";
}

/** Lien du podcast d'un article : champ texte validé à la sortie du champ (pas à chaque frappe) + icône pour ouvrir le lien. */
function PodcastLink({ value, onCommit }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input
        key={value}
        type="url"
        defaultValue={value}
        placeholder="https://…"
        style={{ flex: 1, minWidth: 140, color: "var(--violet)" }}
        onBlur={(e) => { const v = e.target.value.trim(); if (v !== (value || "")) onCommit(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />
      {value && <a href={value} target="_blank" rel="noreferrer" title="Ouvrir le podcast" style={{ color: "var(--violet)" }}><i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /></a>}
    </div>
  );
}

export default function BohrBoard({ isAdmin, currentUserId, settings }) {
  const showToast = useToast();
  const [articles, setArticles] = useState([]);
  const [members, setMembers] = useState([]);
  const [topics, setTopics] = useState([]);
  const [statusOptions, setStatusOptions] = useState({});
  const [comPosts, setComPosts] = useState([]);
  const [season, setSeason] = useState(null);
  const [extraSeasons, setExtraSeasons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("liste"); // "liste" | "kanban"
  // Rédaction + Relecture only by default — Mise en page/Audio/
  // Communication are still one click away via the group toggle chips,
  // but a first look at the board doesn't need every step's columns at
  // once.
  // Un seul groupe de colonnes actif à la fois (demande du 2026-10-09) : on garde un Set pour que le reste du code (`visibleGroups.has(…)`) ne change pas.
  const [visibleGroups, setVisibleGroups] = useState(() => new Set(["redaction"]));

  // Frozen header row + frozen "Sujet" column (see the .frozen-table CSS
  // notes) — the header/col strips never scroll on their own (overflow:
  // hidden), .frozen-table__body is the only real scroll surface (horizontal
  // only now — the table grows to its full height instead of capping and
  // scrolling vertically), and this handler pushes its scrollLeft onto the
  // header strip on every scroll (the scrollTop push onto the column strip
  // is now a no-op, since nothing scrolls vertically here any more).
  const headerScrollRef = useRef(null);
  const colScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  function handleBodyScroll() {
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft;
    if (colScrollRef.current) colScrollRef.current.scrollTop = bodyScrollRef.current.scrollTop;
  }
  // Row heights across the two independent <table>s (frozen column vs.
  // main body) are kept in sync by *measuring* each pane's own natural
  // (unconstrained) height for a given row and applying the larger of the
  // two to both — not by guessing a pixel formula from character count.
  // A guessed formula was tried first and reliably undershot the real
  // height of a wrapped multi-line Sujet textarea (it doesn't account for
  // the textarea's own padding/line-height or the link/edit icons below
  // it) — since a <tr>'s `height` is only a *minimum*, an undershoot lets
  // the real content grow past it, and the two tables drift further out
  // of alignment with every row that undershoots. That drift is also why
  // the panes could be scrolled to different maximum offsets (their total
  // content heights genuinely differed) — fixing the alignment fixes the
  // over-scroll too, since both tables end up the same total height.
  const [rowHeights, setRowHeights] = useState({});
  const colRowRefs = useRef({});
  const bodyRowRefs = useRef({});
  useLayoutEffect(() => {
    setRowHeights((prev) => {
      let changed = false;
      const next = { ...prev };
      const ids = new Set([...Object.keys(colRowRefs.current), ...Object.keys(bodyRowRefs.current)]);
      for (const id of ids) {
        const colEl = colRowRefs.current[id];
        const bodyEl = bodyRowRefs.current[id];
        const h = Math.max(colEl?.getBoundingClientRect().height || 0, bodyEl?.getBoundingClientRect().height || 0);
        if (h && Math.abs((prev[id] || 0) - h) > 0.5) {
          next[id] = h;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  });
  const ISSUE_HEADING_HEIGHT = 31;

  // Comme des boutons radio : cliquer un groupe l'active et désactive l'autre ; cliquer le groupe actif ne fait rien (il y en a toujours un).
  function toggleGroup(key) {
    setVisibleGroups(new Set([key]));
  }

  // C2R always has the reserved controls on (2026-10-09 — the earlier "admin mode" toggle, off by
  // default even for admins, was dropped: the comité de rédaction wanted it always on, not a switch).
  const editAsAdmin = isAdmin;

  // Same underlying problem as row heights above, but for column *widths*:
  // .frozen-table__header and .frozen-table__body render two independent
  // <table>s, so a native table's own auto-layout sizes each one's
  // columns purely from its own content — the header table only ever has
  // short label text, the body table has real (sometimes wide) data, so
  // their column widths were never actually going to agree on their own.
  // That's what "columns don't line up" *and* the extra horizontal
  // scroll room were both symptoms of: two tables with genuinely
  // different total widths. Fixed by giving both tables an identical
  // <colgroup> (built from this one shared list) plus table-layout:fixed,
  // so column widths are authoritative instead of content-driven —
  // deterministic agreement instead of another thing to keep in sync.
  // Colonnes ajustées à leur plus grand contenu (2026-10-12) : on mesure la largeur NATURELLE de chaque colonne (en-tête + toutes
  // les lignes, mise en page automatique le temps de la mesure), puis les deux tables reçoivent ces mêmes largeurs fixes. Mesure faite
  // avant l'affichage (useLayoutEffect) : pas de scintillement. Les réglages de largeur de l'Administration ne servent plus au Bohr.
  const headerTableRef = useRef(null);
  const bodyTableRef = useRef(null);
  const [autoWidths, setAutoWidths] = useState({});
  useLayoutEffect(() => {
    const ht = headerTableRef.current;
    const bt = bodyTableRef.current;
    if (!ht || !bt) return;
    const tables = [ht, bt];
    const cols = tables.flatMap((t) => [...t.querySelectorAll("col")]);
    const saved = tables.map((t) => [t.style.tableLayout, t.style.width, t.style.minWidth]);
    const savedCols = cols.map((c) => c.style.width);
    tables.forEach((t) => { t.style.tableLayout = "auto"; t.style.width = "max-content"; t.style.minWidth = "0"; });
    cols.forEach((c) => { c.style.width = ""; });
    const keys = [...ht.querySelectorAll("col")].map((c) => c.dataset.key);
    const next = {};
    const grow = (cells) => cells.forEach((cell, i) => {
      next[keys[i]] = Math.max(next[keys[i]] || 0, Math.ceil(cell.getBoundingClientRect().width));
    });
    grow([...ht.querySelectorAll("thead th")]);
    bt.querySelectorAll("tbody tr").forEach((tr) => {
      if (tr.children.length === keys.length) grow([...tr.children]);
    });
    tables.forEach((t, k) => { t.style.tableLayout = saved[k][0]; t.style.width = saved[k][1]; t.style.minWidth = saved[k][2]; });
    cols.forEach((c, k) => { c.style.width = savedCols[k]; });
    setAutoWidths((prev) => (keys.every((k) => Math.abs((prev[k] || 0) - next[k]) < 1) ? prev : next));
  }, [articles, members, comPosts, statusOptions, visibleGroups, view, editAsAdmin, season, loading]);

  function buildColumns() {
    const keys = ["avancement"];
    if (visibleGroups.has("redaction")) keys.push("thematique", "redacteur", "concept", "etatRed");
    if (visibleGroups.has("relecture")) keys.push("relecture", "correction", "sources", "ligneEdito", "comiteSci");
    if (visibleGroups.has("miseenpage")) keys.push("etatMep", "respMep", "illustrations", "respIllu", "pages");
    if (visibleGroups.has("miseenpage") && editAsAdmin) keys.push("numero");
    if (visibleGroups.has("audio")) keys.push("etatAudio", "enregistrement", "montage", "podcast");
    if (visibleGroups.has("communication")) keys.push("postLie");
    if (editAsAdmin) keys.push("delete");
    return buildColumnList(BOHR_COLUMNS, keys, null).map((c) => (BOHR_COLUMNS.find((m) => m.key === c.key)?.fixed ? c : { ...c, width: autoWidths[c.key] || c.width }));
  }
  const bodyColumns = buildColumns();
  // Table à 100 % avec min-width = somme des colonnes ; la colonne `flexKey` n'a pas de largeur fixée et absorbe le reste : les autres ne
  // s'étirent pas et la table remplit toujours la carte (la bordure droite est ainsi toujours au bord, jamais au milieu du vide).
  // Colonne qui absorbe la place restante, selon le groupe ouvert (« Numéro » en Mise en page, « Podcast » en Version audio, « Post lié » en
  // Communication) ; sinon la dernière colonne de contenu (jamais la croix de suppression).
  const flexKey = ["numero", "podcast", "postLie"].find((k) => bodyColumns.some((c) => c.key === k)) || [...bodyColumns].reverse().find((c) => c.key !== "delete")?.key;
  const tableWidth = bodyColumns.reduce((sum, c) => sum + c.width, 0);

  function load() {
    Promise.all([
      api.bohr.list(),
      api.members.list(),
      api.topics.list(),
      api.statusOptions.list(),
      api.com.list(),
    ]).then(([arts, mem, tops, opts, posts]) => {
      setArticles(arts);
      setMembers(mem);
      setTopics(tops);
      const byField = {};
      for (const o of opts) (byField[o.field] ||= []).push(o);
      setStatusOptions(byField);
      setComPosts(posts);
      setLoading(false);
    });
  }
  useEffect(load, []);

  // Which Plan de Com post(s) reference each article — replaces the old
  // freeform "Communication RS" status column, which just duplicated (and
  // could drift from) what Plan de Com's own posts + their `posted` flag
  // already track. One real cross-reference beats a second, separately-
  // maintained status field.
  const postsByArticle = useMemo(() => {
    const map = new Map();
    for (const p of comPosts) {
      if (!p.linkedArticleId) continue;
      if (!map.has(p.linkedArticleId)) map.set(p.linkedArticleId, []);
      map.get(p.linkedArticleId).push(p);
    }
    return map;
  }, [comPosts]);

  const seasons = useMemo(() => {
    const s = new Set(articles.map((a) => a.season).filter(Boolean));
    ["Saison 1", "Saison 2", "Saison 3"].forEach((x) => s.add(x));
    extraSeasons.forEach((x) => s.add(x));
    // Most recent season first, per season-number descending — requested
    // explicitly over the previous alphabetical-ascending order.
    return Array.from(s).sort((a, b) => seasonSortKey(b) - seasonSortKey(a));
  }, [articles, extraSeasons]);

  // Default to the most recent season once we know what that is, rather
  // than a hardcoded guess — but only ever set this once (or when the
  // current selection stops existing), so it doesn't fight a manual pick.
  useEffect(() => {
    if (seasons.length && !seasons.includes(season)) setSeason(seasons[0]);
  }, [seasons, season]);

  // Every distinct issue already in the current season, for the "cut into
  // this issue" assignment select — admin-mode only, see below.
  const seasonIssues = useMemo(() => {
    const map = new Map();
    for (const a of articles) {
      if (a.season !== season) continue;
      if (!a.issueLabel || a.issueLabel === UNASSIGNED_LABEL) continue;
      const key = `${a.issueOrder}|${a.issueLabel}`;
      if (!map.has(key)) map.set(key, { order: a.issueOrder, label: a.issueLabel, month: a.issueMonth });
    }
    return Array.from(map.values()).sort((a, b) => b.order - a.order);
  }, [articles, season]);

  const issues = useMemo(() => {
    const filtered = articles.filter((a) => a.season === season);
    const byIssue = new Map();
    for (const a of filtered) {
      const key = `${a.issueOrder}|${a.issueLabel || UNASSIGNED_LABEL}`; // « sans numéro » et « À découper » forment UN groupe (même libellé affiché, donc même clé)
      if (!byIssue.has(key)) byIssue.set(key, { order: a.issueOrder, label: a.issueLabel || UNASSIGNED_LABEL, month: a.issueMonth, rows: [] });
      byIssue.get(key).rows.push(a);
    }
    // Most recent issue first — same "last to first" ordering as the
    // season chips — except the unassigned/"À découper" bucket, which
    // always floats to the very top regardless of its numeric order,
    // since it's the most immediately actionable pile.
    return Array.from(byIssue.values()).sort((a, b) => {
      const ua = a.label === UNASSIGNED_LABEL, ub = b.label === UNASSIGNED_LABEL;
      if (ua !== ub) return ua ? -1 : 1;
      return b.order - a.order;
    });
  }, [articles, season]);

  async function patch(article, body) {
    const updated = await api.bohr.update(article.id, body);
    setArticles((prev) => prev.map((a) => (a.id === article.id ? updated : a)));
  }

  // Sujet's title/link/Discord-thread are no longer editable inline (a
  // live-patching textarea on every keystroke) — a small edit modal
  // instead, opened via the pencil icon to the left of each row, editing
  // all three together. subjectUrl/discordThreadUrl are both normal, open
  // (non-C2R) columns server-side — anyone can set them, same as before.
  const [editingArticle, setEditingArticle] = useState(null);
  const [editForm, setEditForm] = useState({ subject: "", subjectUrl: "", discordThreadUrl: "" });
  function openEditArticle(article) {
    setEditForm({
      subject: article.subject,
      subjectUrl: article.subjectUrl || "",
      discordThreadUrl: article.discordThreadUrl || "",
    });
    setEditingArticle(article);
  }
  function saveEditArticle(e) {
    e.preventDefault();
    patch(editingArticle, {
      subject: editForm.subject.trim(),
      subjectUrl: editForm.subjectUrl.trim(),
      discordThreadUrl: editForm.discordThreadUrl.trim(),
    });
    setEditingArticle(null);
  }

  async function addArticle() {
    const created = await api.bohr.create({ season, subject: "Nouveau sujet", issueLabel: UNASSIGNED_LABEL });
    setArticles((prev) => [...prev, created]);
  }

  async function removeArticle(article) {
    if (!confirm(`Supprimer « ${article.subject} » ?`)) return;
    await api.bohr.remove(article.id);
    setArticles((prev) => prev.filter((a) => a.id !== article.id));
  }

  async function toggleRelecture(article, memberId) {
    const ids = article.relecture.map((m) => m.id);
    const next = ids.includes(memberId) ? ids.filter((id) => id !== memberId) : [...ids, memberId];
    const updated = await api.bohr.setRelecture(article.id, next);
    setArticles((prev) => prev.map((a) => (a.id === article.id ? updated : a)));
  }

  function addSeason() {
    const suggestion = `Saison ${(seasons.reduce((m, s) => Math.max(m, seasonSortKey(s)), 0) || 0) + 1}`;
    const name = window.prompt("Nom de la nouvelle saison :", suggestion);
    if (!name?.trim()) return;
    setExtraSeasons((prev) => [...prev, name.trim()]);
    setSeason(name.trim());
  }

  // "For now" (an interim workflow, while some editing still happens in
  // the spreadsheet in parallel with the app) — lets an admin re-import
  // an updated .xlsx/.xlsm at any time, not just the one-time migration.
  // Upserts by (season, subject): the spreadsheet's fields win on a match,
  // so this is a real, if unusual, one-way sync — hence the confirm.
  async function importXlsm(e) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file next time
    if (!file) return;
    if (
      !confirm(
        `Importer « ${file.name} » ? Pour chaque sujet déjà présent (même saison, même titre), les champs venant du tableur remplaceront ceux de l'app. Les nouveaux sujets seront ajoutés.`
      )
    )
      return;
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(",")[1]); // strip the data: URL prefix
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    try {
      const result = await api.bohr.importXlsm(base64);
      showToast(`Import terminé : ${result.created} sujet(s) créé(s), ${result.updated} mis à jour.`, { type: "success" });
      load();
    } catch (err) {
      showToast(`Échec de l'import : ${err.message}`, { type: "error" });
    }
  }

  // The "cut into an issue" control — moving an article between issues
  // (or back to unassigned, or into a brand new issue) is the admin-mode
  // equivalent of the spreadsheet's "A découper" workflow.
  function assignIssue(article, value) {
    if (value === "__new__") {
      const label = window.prompt("Numéro du nouveau numéro (ex: #8) :");
      if (!label?.trim()) return;
      const month = window.prompt("Mois (ex: Novembre 2026) :", "") || "";
      const nextOrder = seasonIssues.reduce((m, i) => Math.max(m, i.order), 0) + 1;
      patch(article, { issueLabel: label.trim(), issueMonth: month.trim(), issueOrder: nextOrder });
      return;
    }
    if (value === "__unassigned__") {
      patch(article, { issueLabel: UNASSIGNED_LABEL, issueMonth: "", issueOrder: 0 });
      return;
    }
    const found = seasonIssues.find((i) => `${i.order}|${i.label}` === value);
    if (found) patch(article, { issueLabel: found.label, issueMonth: found.month, issueOrder: found.order });
  }

  if (loading) return <p className="muted">Chargement…</p>;

  // Pastilles des posts liés (date + coche « posté ») — même contenu dans les groupes Communication et Version audio.
  const postsCell = (a) => (
    <>
    {(postsByArticle.get(a.id) || []).length === 0 ? (
      <span className="muted small">—</span>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {[...postsByArticle.get(a.id)].sort((x, y) => (x.postDate || "9999").localeCompare(y.postDate || "9999")).map((p) => (
          <span key={p.id} className="tag" title={[p.itemTitle, p.reseaux.join(", ")].filter(Boolean).join(" — ")}>
            <i
              className={p.posted ? "fa-solid fa-circle-check" : "fa-regular fa-circle"}
              aria-hidden="true"
              style={{ color: p.posted ? "#1baf7a" : "var(--muted)", marginRight: 4 }}
            />
            {formatPostDate(p.postDate)}
          </span>
        ))}
      </div>
    )}
    </>
  );

  const opt = (field) => statusOptions[field] || [];
  const c2rCls = editAsAdmin ? "" : "c2r-cell";
  const colCount =
    2 + // Sujet + Avancement, always shown
    (visibleGroups.has("redaction") ? 4 : 0) +
    (visibleGroups.has("relecture") ? 5 : 0) +
    (visibleGroups.has("miseenpage") ? (editAsAdmin ? 6 : 5) : 0) +
    (visibleGroups.has("audio") ? 4 : 0) +
    (visibleGroups.has("communication") ? 1 : 0) +
    (editAsAdmin ? 1 : 0); // delete, admin only (Numéro is counted with Mise en page)

  return (
    <div>
      <div className="section-toolbar">
        {seasons.map((s) => (
          <button key={s} className={`select-chip ${season === s ? "active" : ""}`} onClick={() => setSeason(s)}>
            {s}
          </button>
        ))}
        {editAsAdmin && <button className="select-chip" onClick={addSeason}>+ Nouvelle saison</button>}
        {editAsAdmin && (
          <label className="select-chip" style={{ cursor: "pointer" }}>
            <i className="fa-solid fa-file-import" aria-hidden="true" /> Importer .xlsx/.xlsm
            <input type="file" accept=".xlsx,.xlsm" onChange={importXlsm} style={{ display: "none" }} />
          </label>
        )}
        <span style={{ flex: 1 }} />
        <button className={`select-chip ${view === "liste" ? "active" : ""}`} onClick={() => setView("liste")}>
          <i className="fa-solid fa-table-list" aria-hidden="true" /> Liste
        </button>
        <button className={`select-chip ${view === "kanban" ? "active" : ""}`} onClick={() => setView("kanban")}>
          <i className="fa-brands fa-trello" aria-hidden="true" /> Kanban
        </button>
        <button className="link-btn" onClick={addArticle}><i className="fa-solid fa-plus" aria-hidden="true" /> Nouveau sujet</button>
        {!editAsAdmin && <span className="admin-only-note">Les cellules grisées sont réservées au C2R.</span>}
      </div>

      {view === "liste" && (
        <div className="section-toolbar">
          <span className="muted small">Groupes de colonnes :</span>
          {GROUPS.map((g) => (
            <button
              key={g.key}
              className={`select-chip ${visibleGroups.has(g.key) ? "active" : ""}`}
              onClick={() => toggleGroup(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
      )}

      {view === "kanban" ? (
        <BohrKanban
          articles={articles.filter((a) => a.season === season)}
          statusOptions={statusOptions}
          editAsAdmin={editAsAdmin}
          onPatch={patch}
        />
      ) : (
      <div className="card">
      <div className="frozen-table">
        <div className="frozen-table__corner">Sujet</div>
        <div className="frozen-table__header" ref={headerScrollRef}>
        <table className="data-table" ref={headerTableRef} style={{ tableLayout: "fixed", width: "100%", minWidth: tableWidth }}>
          <colgroup>
            {bodyColumns.map((c) => <col key={c.key} data-key={c.key} style={c.key === flexKey ? undefined : { width: c.width }} />)}
          </colgroup>
          <thead>
            <tr>
              <th title="Avancement — survole un cercle pour le détail par étape" aria-label="Avancement" style={{ textAlign: "center" }}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden="true" style={{ verticalAlign: "middle" }}>
                  <circle cx="12" cy="12" r="9" opacity="0.25" />
                  <path d="M12 3a9 9 0 0 1 9 9" />
                </svg>
              </th>
              {visibleGroups.has("redaction") && (
                <>
                  <th>Thématique</th>
                  <th>Rédacteur·ice</th>
                  <th>Concept</th>
                  <th>État réd.</th>
                </>
              )}
              {visibleGroups.has("relecture") && (
                <>
                  <th>Relecture</th>
                  <th>Correction</th>
                  <th>Sources</th>
                  <th className={c2rCls}>Ligne édito.</th>
                  <th className={c2rCls}>Comité sci</th>
                </>
              )}
              {visibleGroups.has("miseenpage") && (
                <>
                  <th className={c2rCls}>État mise en page</th>
                  <th>Resp. mise en page</th>
                  <th className={c2rCls}>Illustrations</th>
                  <th>Resp. illustration</th>
                  <th className={c2rCls}>Pages</th>
                  {editAsAdmin && <th>Numéro</th>}
                </>
              )}
              {visibleGroups.has("audio") && (
                <>
                  <th className={c2rCls}>État audio</th>
                  <th>Resp. enregistrement</th>
                  <th>Resp. montage</th>
                  <th>Podcast</th>
                </>
              )}
              {visibleGroups.has("communication") && <th>Post lié</th>}
              {editAsAdmin && <th></th>}
            </tr>
          </thead>
        </table>
        </div>
        <div className="frozen-table__col" ref={colScrollRef}>
        <table className="data-table">
          <tbody>
            {issues.map((issue) => {
              const bannerId = `banner-${issue.label}-${issue.month}`;
              return (
              <Fragment key={bannerId}>
                <tr
                  className="issue-heading"
                  ref={(el) => { if (el) colRowRefs.current[bannerId] = el; else delete colRowRefs.current[bannerId]; }}
                  style={{ height: rowHeights[bannerId] ?? ISSUE_HEADING_HEIGHT }}
                >
                  <td>&nbsp;</td>
                </tr>
                {issue.rows.map((a) => (
                  <tr
                    key={a.id}
                    ref={(el) => { if (el) colRowRefs.current[a.id] = el; else delete colRowRefs.current[a.id]; }}
                    style={{ height: rowHeights[a.id] }}
                  >
                    <td style={{ minWidth: 200 }}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className="icon-btn"
                          title="Modifier le titre / lien / fil Discord"
                          onClick={() => openEditArticle(a)}
                          style={{ fontSize: 11, flexShrink: 0 }}
                        >
                          <i className="fa-solid fa-pen" aria-hidden="true" />
                        </button>
                        {/* Plain inline flow (not flex) — the title and its
                            icons are the same text run, so they wrap
                            together and the icons always trail the last
                            word, instead of being separate flex items that
                            get pushed onto their own line once the title
                            wraps to 2+ lines. */}
                        <div style={{ flex: 1, whiteSpace: "normal", overflowWrap: "break-word" }}>
                          {a.subject}
                          {a.subjectUrl && (
                            <a href={a.subjectUrl} target="_blank" rel="noreferrer" title="Ouvrir le document" style={{ marginLeft: 6 }}>
                              <i className="fa-solid fa-file-lines" aria-hidden="true" />
                            </a>
                          )}
                          {a.discordThreadUrl && (
                            <a href={a.discordThreadUrl} target="_blank" rel="noreferrer" title="Ouvrir le fil Discord" style={{ marginLeft: 4 }}>
                              <i className="fa-brands fa-discord" aria-hidden="true" />
                            </a>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </Fragment>
              );
            })}
          </tbody>
        </table>
        </div>
        <div className="frozen-table__body" ref={bodyScrollRef} onScroll={handleBodyScroll}>
        <table className="data-table" ref={bodyTableRef} style={{ tableLayout: "fixed", width: "100%", minWidth: tableWidth }}>
          <colgroup>
            {bodyColumns.map((c) => <col key={c.key} data-key={c.key} style={c.key === flexKey ? undefined : { width: c.width }} />)}
          </colgroup>
          <tbody>
            {issues.map((issue) => {
              const bannerId = `banner-${issue.label}-${issue.month}`;
              return (
              <Fragment key={bannerId}>
                <tr
                  className="issue-heading"
                  ref={(el) => { if (el) bodyRowRefs.current[bannerId] = el; else delete bodyRowRefs.current[bannerId]; }}
                  style={{ height: rowHeights[bannerId] ?? ISSUE_HEADING_HEIGHT }}
                >
                  <td colSpan={colCount - 1}>
                    {issue.label} {issue.month && `— ${issue.month}`}
                    <span className="issue-heading__count">{issue.rows.length}</span>
                  </td>
                </tr>
                {issue.rows.map((a) => (
                  <tr
                    key={a.id}
                    ref={(el) => { if (el) bodyRowRefs.current[a.id] = el; else delete bodyRowRefs.current[a.id]; }}
                    style={{ height: rowHeights[a.id] }}
                  >
                    <td>
                      <AchievementBadge article={a} linkedPosts={postsByArticle.get(a.id) || []} visibleGroups={visibleGroups} />
                    </td>
                    {visibleGroups.has("redaction") && (
                      <>
                        <td style={{ whiteSpace: "nowrap", overflow: "hidden" }}>
                          {a.topicColor && <span className="color-swatch" style={{ background: a.topicColor, marginRight: 4 }} />}
                          <input
                            list="topic-list"
                            value={a.topic}
                            onChange={(e) => patch(a, { topic: e.target.value })}
                            size={1}
                            // Was ch-sized to the content's own length, growing the
                            // column to fit — that conflicts with the column now
                            // having a fixed, shared width (see bodyColumns above),
                            // so it's capped to the cell instead; longer topics
                            // scroll within the input (native input behavior)
                            // rather than being fully visible unfocused.
                            style={{ width: "100%", maxWidth: "100%" }}
                          />
                        </td>
                        <td>
                          <MemberSelect members={members} value={a.author?.id} onChange={(id) => patch(a, { authorId: id })} />
                        </td>
                        <td>
                          <StatusSelect options={opt("concept")} value={a.concept} onChange={(v) => patch(a, { concept: v })} />
                        </td>
                        <td>
                          <StatusSelect options={opt("etat_redaction")} value={a.etatRedaction} onChange={(v) => patch(a, { etatRedaction: v })} />
                        </td>
                      </>
                    )}
                    {visibleGroups.has("relecture") && (
                      <>
                        <td>
                          {editAsAdmin ? (
                            <RelectureEditor members={members} selectedIds={a.relecture.map((m) => m.id)} onToggle={(id) => toggleRelecture(a, id)} />
                          ) : (
                            <RelectureQuickJoin
                              members={members}
                              selectedIds={a.relecture.map((m) => m.id)}
                              currentUserId={currentUserId}
                              onToggleSelf={() => toggleRelecture(a, currentUserId)}
                            />
                          )}
                        </td>
                        <td>
                          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input type="checkbox" checked={a.correctionValide} disabled={!currentUserId} onChange={(e) => patch(a, { correctionValide: e.target.checked })} />
                            {a.correctionValide && a.correctionValidePar && <span className="muted" title="A validé">{a.correctionValidePar.displayName}</span>}
                          </label>
                        </td>
                        <td>
                          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input type="checkbox" checked={a.sourceValide} disabled={!currentUserId} onChange={(e) => patch(a, { sourceValide: e.target.checked })} />
                            {a.sourceValide && a.sourceValidePar && <span className="muted" title="A validé">{a.sourceValidePar.displayName}</span>}
                          </label>
                        </td>
                        <td className={c2rCls}>
                          <input type="checkbox" disabled={!editAsAdmin} checked={a.ligneEditoriale} onChange={(e) => patch(a, { ligneEditoriale: e.target.checked })} />
                        </td>
                        <td className={c2rCls}>
                          <input type="checkbox" disabled={!editAsAdmin} checked={a.comiteSci} onChange={(e) => patch(a, { comiteSci: e.target.checked })} />
                        </td>
                      </>
                    )}
                    {visibleGroups.has("miseenpage") && (
                      <>
                        <td className={c2rCls}>
                          <StatusSelect options={opt("etat_mise_en_page")} value={a.etatMiseEnPage} disabled={!editAsAdmin} onChange={(v) => patch(a, { etatMiseEnPage: v })} />
                        </td>
                        <td>
                          <MemberSelect members={members} value={a.miseEnPage?.id} onChange={(id) => patch(a, { miseEnPageId: id })} />
                        </td>
                        <td className={c2rCls}>
                          <StatusSelect options={opt("illustrations")} value={a.illustrations} disabled={!editAsAdmin} onChange={(v) => patch(a, { illustrations: v })} />
                        </td>
                        <td>
                          <MemberSelect members={members} value={a.illustration?.id} onChange={(id) => patch(a, { illustrationId: id })} />
                        </td>
                        <td className={c2rCls}>
                          <input
                            type="number"
                            disabled={!editAsAdmin}
                            value={a.pages}
                            onChange={(e) => patch(a, { pages: Number(e.target.value) })}
                            style={{ width: 55 }}
                          />
                        </td>
                        {editAsAdmin && (
                      <td>
                        <select value={`${a.issueOrder}|${a.issueLabel}`} onChange={(e) => assignIssue(a, e.target.value)}>
                          <option value="__unassigned__">{UNASSIGNED_LABEL}</option>
                          {seasonIssues.map((i) => (
                            <option key={`${i.order}|${i.label}`} value={`${i.order}|${i.label}`}>{i.label}</option>
                          ))}
                          <option value="__new__">+ Nouveau numéro…</option>
                        </select>
                      </td>
                    )}
                      </>
                    )}
                    {visibleGroups.has("audio") && (
                      <>
                        <td className={c2rCls}>
                          <StatusSelect options={opt("etat_audio")} value={a.etatAudio} disabled={!editAsAdmin} onChange={(v) => patch(a, { etatAudio: v })} />
                        </td>
                        <td>
                          <MemberSelect members={members} value={a.enregistrement?.id} onChange={(id) => patch(a, { enregistrementId: id })} />
                        </td>
                        <td>
                          <MemberSelect members={members} value={a.montage?.id} onChange={(id) => patch(a, { montageId: id })} />
                        </td>
                        <td>
                          <PodcastLink value={a.podcastUrl} onCommit={(v) => patch(a, { podcastUrl: v })} />
                        </td>
                      </>
                    )}
                    {visibleGroups.has("communication") && <td>{postsCell(a)}</td>}
                    {editAsAdmin && (
                      <td>
                        <button className="icon-btn" title="Supprimer" onClick={() => removeArticle(a)}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
                      </td>
                    )}
                  </tr>
                ))}
              </Fragment>
              );
            })}
            {issues.length === 0 && (
              <tr><td colSpan={colCount - 1} className="muted">Aucun sujet pour cette saison.</td></tr>
            )}
          </tbody>
        </table>
        </div>
      </div>
      </div>
      )}
      <datalist id="topic-list">
        {topics.map((t) => (
          <option key={t.id} value={t.name} />
        ))}
      </datalist>
      {editingArticle && (
        <div className="modal-overlay" onClick={() => setEditingArticle(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Modifier le sujet</h3>
              <button className="icon-btn" onClick={() => setEditingArticle(null)}>
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
            <form onSubmit={saveEditArticle}>
              <div className="field">
                <label>Titre</label>
                <textarea
                  value={editForm.subject}
                  onChange={(e) => setEditForm({ ...editForm, subject: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="field">
                <label>Lien (ex : Google Doc)</label>
                <input
                  value={editForm.subjectUrl}
                  onChange={(e) => setEditForm({ ...editForm, subjectUrl: e.target.value })}
                  placeholder="https://…"
                />
              </div>
              <div className="field">
                <label>Fil Discord</label>
                <input
                  value={editForm.discordThreadUrl}
                  onChange={(e) => setEditForm({ ...editForm, discordThreadUrl: e.target.value })}
                  placeholder="https://discord.com/channels/…"
                />
              </div>
              <button className="link-btn" type="submit">Enregistrer</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

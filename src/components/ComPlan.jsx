import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api.js";
import MemberSelect from "./MemberSelect.jsx";
import LinkSettingsEditor from "./LinkSettingsEditor.jsx";
import { seasonSortKey, sortSeasonsDesc } from "../lib/seasons.js";
import { chipStyle } from "../lib/color.js";
import ComCalendar from "./ComCalendar.jsx";
import { COMPLAN_COLUMNS, buildColumnList } from "../lib/columnWidths.js";

const LINK_FIELDS = [
  { key: "comm_canva_url", label: "Dossier Canva (Communication)" },
  { key: "fedica_url", label: "Fedica" },
];

const RESEAUX_OPTIONS = [
  "Linkedin", "Echoscience", "Bluesky (thread)", "Bluesky (annonce)",
  "Insta (Post)", "Insta (Story)", "Newsletter",
];
const KIND_LABEL = { post: "Post", issue_release: "Sortie de numéro", reminder: "Rappel" };

// The standard réseau set for each post type — applied as a convenience
// default (only when a post doesn't already have any réseau picked), not
// a hard restriction; the "+ réseau" picker still offers every option so
// a real exception stays one click away.
const DEFAULT_RESEAUX_BY_KIND = {
  post: ["Insta (Post)", "Insta (Story)"],
  issue_release: ["Linkedin", "Echoscience", "Bluesky (thread)", "Newsletter"],
};

// The réseau chip's own base color — chipStyle() tints/borders whatever
// hex it's given assuming a light backdrop, so the light-mode violet
// doesn't survive onto a dark surface (background/border tinted at
// 16-40% opacity of an already-dark color reads as barely-there, which
// is exactly the "borders not displayed right" report in dark mode). Dark
// mode gets the app's own light-green accent instead, both because it
// stays legible at low opacity against a dark surface and to match the
// rest of the dark theme's "green is the pop color" convention.
const RESEAU_CHIP_HEX = { light: "#65466e", dark: "#c3f56a" };

export default function ComPlan({ settings, isAdmin, isSuperAdmin, onSettingsChanged, theme }) {
  const [posts, setPosts] = useState([]);
  const [articles, setArticles] = useState([]);
  const [members, setMembers] = useState([]);
  const [season, setSeason] = useState(null);
  const [extraSeasons, setExtraSeasons] = useState([]); // saisons créées à la main, sans post pour l'instant
  const [loading, setLoading] = useState(true);
  const [hidePosted, setHidePosted] = useState(true);
  const [view, setView] = useState("liste"); // "liste" | "calendrier"
  // Which post's "Article lié" is currently showing its <select> instead
  // of its plain-text label — a <select> can't be shown *and* wrap its
  // full title without showing the (truncated) selected option a second
  // time, so the two are mutually exclusive per row: text by default,
  // the picker only while actually changing it.
  const [editingLinkFor, setEditingLinkFor] = useState(null);

  function load() {
    Promise.all([api.com.list(), api.bohr.list(), api.members.list()]).then(([p, a, m]) => {
      setPosts(p);
      setArticles(a);
      setMembers(m);
      setLoading(false);
    });
  }
  useEffect(load, []);

  const seasons = useMemo(() => {
    const s = new Set(posts.map((p) => p.season).filter(Boolean));
    ["Saison 1", "Saison 2"].forEach((x) => s.add(x));
    extraSeasons.forEach((x) => s.add(x));
    // Most recent season first — same convention as Tableau de Bohr.
    return sortSeasonsDesc(s);
  }, [posts, extraSeasons]);

  function addSeason() {
    const suggestion = `Saison ${seasons.reduce((m, x) => Math.max(m, seasonSortKey(x)), 0) + 1}`;
    const name = window.prompt("Nom de la nouvelle saison :", suggestion);
    if (!name?.trim()) return;
    setExtraSeasons((prev) => [...prev, name.trim()]);
    setSeason(name.trim());
  }

  // Default to the most recent season once known, rather than a
  // hardcoded guess — but only when the current selection doesn't exist
  // (initial load, or a season disappearing), so it never fights a
  // manual pick.
  useEffect(() => {
    if (seasons.length && !seasons.includes(season)) setSeason(seasons[0]);
  }, [seasons, season]);

  const rows = useMemo(
    () =>
      posts
        .filter((p) => p.season === season)
        .filter((p) => !hidePosted || !p.posted)
        .sort((a, b) => (a.postDate || "").localeCompare(b.postDate || "")),
    [posts, season, hidePosted]
  );

  const [texteFor, setTexteFor] = useState(null); // id du post dont le texte est ouvert en fenêtre
  const texteRow = texteFor != null ? posts.find((p) => p.id === texteFor) : null;

  async function patch(post, body) {
    const updated = await api.com.update(post.id, body);
    setPosts((prev) => prev.map((p) => (p.id === post.id ? updated : p)));
  }

  async function addPost(postDate) {
    // New posts start as kind "post" server-side — seed its default
    // réseaux immediately rather than waiting for someone to touch the
    // Type select (which, already showing "post", wouldn't fire a change).
    const created = await api.com.create({
      season,
      itemTitle: "Nouveau post",
      postDate: postDate || "",
      reseaux: DEFAULT_RESEAUX_BY_KIND.post,
    });
    setPosts((prev) => [...prev, created]);
  }

  async function removePost(post) {
    if (!confirm(`Supprimer « ${post.itemTitle || "ce post"} » ?`)) return;
    await api.com.remove(post.id);
    setPosts((prev) => prev.filter((p) => p.id !== post.id));
  }

  function toggleReseau(post, r) {
    const has = post.reseaux.includes(r);
    patch(post, { reseaux: has ? post.reseaux.filter((x) => x !== r) : [...post.reseaux, r] });
  }

  function toggleReseauPosted(post, r) {
    patch(post, { reseauxPosted: { ...post.reseauxPosted, [r]: !post.reseauxPosted[r] } });
  }

  function changeKind(post, kind) {
    const body = { kind };
    // Only fills in the default set when nothing's picked yet — never
    // overwrites a real, already-chosen réseau list.
    if (post.reseaux.length === 0 && DEFAULT_RESEAUX_BY_KIND[kind]) {
      body.reseaux = DEFAULT_RESEAUX_BY_KIND[kind];
    }
    patch(post, body);
  }

  // Same tinted fill chipStyle() computes for every réseau chip, minus its
  // borderColor — the border now belongs to the group as a whole (see the
  // Réseaux <td> below), not to each individual social-network chip.
  const { borderColor: _reseauBorder, ...reseauChipFill } = chipStyle(
    RESEAU_CHIP_HEX[theme === "dark" ? "dark" : "light"]
  );

  // Frozen header row, same idea as Tableau de Bohr's but scoped to just
  // the row (no frozen column was asked for here) — a real header
  // <table>, kept outside the scrolling body, with its own scrollLeft
  // pushed by the body's onScroll rather than position:sticky. Learned
  // from Tableau de Bohr's own mistake the first time around: the header
  // and body are two *independent* <table>s again, so they need an
  // identical <colgroup> or their columns won't agree on a width — this
  // one shared `columns` list drives both, so there's nothing to drift
  // out of sync. Unlike Tableau de Bohr, there's no row-height concern
  // here at all, since there's only one body <table> (not a second,
  // separately-laid-out column pane) — every row's cells already share
  // one <tr>, which a native table already keeps at a consistent height
  // on its own.
  const headerScrollRef = useRef(null);
  const bodyScrollRef = useRef(null);
  function handleBodyScroll() {
    if (headerScrollRef.current) headerScrollRef.current.scrollLeft = bodyScrollRef.current.scrollLeft;
  }
  const columnKeys = ["date", "type", "articleLie", "reseaux", "coPost", "texte", "lien", "posted"];
  if (isAdmin) columnKeys.push("delete");
  const columns = buildColumnList(COMPLAN_COLUMNS, columnKeys, settings?.complan_column_widths);

  return (
    <div>
      <div className="card">
        <div className="link-row">
          {settings.comm_canva_url ? (
            <a className="link-btn" href={settings.comm_canva_url} target="_blank" rel="noreferrer">
              <i className="fa-solid fa-palette" aria-hidden="true" /> Dossier Canva <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
            </a>
          ) : (
            <span className="admin-only-note">Lien Canva non configuré (Administration).</span>
          )}
          {settings.fedica_url ? (
            <a className="link-btn" href={settings.fedica_url} target="_blank" rel="noreferrer">
              <i className="fa-solid fa-calendar-days" aria-hidden="true" /> Fedica <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
            </a>
          ) : (
            <span className="admin-only-note">Lien Fedica non configuré (Administration).</span>
          )}
          <a className="link-btn accent" href="/tools/newsletter-builder.html" target="_blank" rel="noreferrer">
            <i className="fa-solid fa-envelope" aria-hidden="true" /> Ouvrir le générateur de newsletter
          </a>
          {isSuperAdmin && <LinkSettingsEditor fields={LINK_FIELDS} settings={settings} onSaved={onSettingsChanged} />}
        </div>
      </div>

      <div className="section-toolbar">
        {seasons.map((s) => (
          <button key={s} className={`select-chip ${season === s ? "active" : ""}`} onClick={() => setSeason(s)}>{s}</button>
        ))}
        {isAdmin && <button className="select-chip" onClick={addSeason}>+ Nouvelle saison</button>}
        <button className={`select-chip ${hidePosted ? "active" : ""}`} onClick={() => setHidePosted((v) => !v)}>
          <i className="fa-solid fa-eye-slash" aria-hidden="true" /> Masquer les postés
        </button>
        <span style={{ flex: 1 }} />
        <button className={`select-chip ${view === "liste" ? "active" : ""}`} onClick={() => setView("liste")}>
          <i className="fa-solid fa-table-list" aria-hidden="true" /> Liste
        </button>
        <button className={`select-chip ${view === "calendrier" ? "active" : ""}`} onClick={() => setView("calendrier")}>
          <i className="fa-solid fa-calendar-days" aria-hidden="true" /> Calendrier
        </button>
        <button className="link-btn" onClick={() => addPost()}><i className="fa-solid fa-plus" aria-hidden="true" /> Nouveau post</button>
      </div>

      {loading ? (
        <p className="muted">Chargement…</p>
      ) : view === "calendrier" ? (
        <ComCalendar posts={rows} onAddPost={(iso) => addPost(iso)} />
      ) : (
        <div className="card">
        <div className="frozen-table frozen-table--row-only">
          <div className="frozen-table__header" ref={headerScrollRef}>
          <table className="data-table" style={{ tableLayout: "fixed" }}>
            <colgroup>
              {columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
            </colgroup>
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Article lié</th>
                <th>Réseaux</th>
                <th>Co-post</th>
                <th>Texte</th>
                <th>Lien</th>
                <th title="Coché une fois que chaque réseau l'est individuellement">Posté (tout)</th>
                {isAdmin && <th></th>}
              </tr>
            </thead>
          </table>
          </div>
          <div className="frozen-table__body" ref={bodyScrollRef} onScroll={handleBodyScroll}>
          <table className="data-table" style={{ tableLayout: "fixed" }}>
            <colgroup>
              {columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
            </colgroup>
            <tbody>
              {rows.map((p) => {
                // One line per réseau choice, not one crowded cell of
                // checkboxes — a post with no network yet still gets one
                // line (with just the "+ réseau" picker) so it's never
                // dropped from the table entirely.
                const networks = p.reseaux.length ? p.reseaux : [null];
                const span = networks.length;
                const unpicked = RESEAUX_OPTIONS.filter((r) => !p.reseaux.includes(r));
                return networks.map((r, i) => (
                  <tr key={`${p.id}-${i}`}>
                    {i === 0 && (
                      <>
                        <td rowSpan={span}>
                          <input type="date" value={p.postDate || ""} onChange={(e) => patch(p, { postDate: e.target.value })} style={{ width: 130 }} />
                          <div className="muted small">{p.monthLabel}</div>
                        </td>
                        <td rowSpan={span}>
                          <select value={p.kind} onChange={(e) => changeKind(p, e.target.value)}>
                            {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                        </td>
                        <td rowSpan={span}>
                          {/* A <select>'s own closed-state box never wraps its
                              selected option (a native browser limit, not a
                              styling gap) — showing it *alongside* a wrapped
                              text label just duplicated the same title twice.
                              So: text label by default (wraps fully), select
                              shown only while actually changing the link. */}
                          {editingLinkFor === p.id ? (
                            <select
                              autoFocus
                              value={p.linkedArticleId || ""}
                              onChange={(e) => {
                                patch(p, { linkedArticleId: e.target.value ? Number(e.target.value) : null });
                                setEditingLinkFor(null);
                              }}
                              onBlur={() => setEditingLinkFor(null)}
                              style={{ width: "100%" }}
                            >
                              <option value="">—</option>
                              {articles.map((a) => (
                                <option key={a.id} value={a.id}>{a.season} · {a.subject}</option>
                              ))}
                            </select>
                          ) : (
                            <div style={{ display: "flex", alignItems: "flex-start", gap: 4 }}>
                              <span style={{ whiteSpace: "normal", overflowWrap: "break-word", flex: 1 }}>
                                {p.linkedArticleTitle || <span className="muted small">—</span>}
                              </span>
                              <button
                                className="icon-btn"
                                style={{ fontSize: 11, flexShrink: 0 }}
                                title="Changer l'article lié"
                                onClick={() => setEditingLinkFor(p.id)}
                              >
                                <i className="fa-solid fa-pen" aria-hidden="true" />
                              </button>
                            </div>
                          )}
                        </td>
                      </>
                    )}
                    {/* One border around the whole item's réseau group, not one
                        per social network inside it — suppress the row grid
                        line between réseau lines of the *same* item (every
                        line but the last), so only the boundary between one
                        item's group and the next still shows a line. The
                        individual chips below drop their own border for the
                        same reason (reseauChipFill omits chipStyle()'s
                        borderColor) — color/background stays, so each
                        network is still identifiable, just without a ring
                        around every single one. */}
                    {/* For i > 0, every other column is rowSpan'd from row 0
                        (see the {i === 0 && ...} blocks below/above), so
                        this <td> is the *only* cell in its own <tr> —
                        genuinely :last-child from the DOM's point of view,
                        which triggered ".data-table td:last-child {
                        border-right: none }" and silently dropped its right
                        border on every réseau line but the first. Forced
                        back on explicitly rather than relying on
                        not-last-child. */}
                    <td
                      style={{
                        overflow: "hidden",
                        borderBottom: i === span - 1 ? undefined : "none",
                        borderRight: "1px solid var(--border)",
                      }}
                    >
                      {r && (
                        <span className="chip" style={{ ...reseauChipFill, marginRight: 4 }}>
                          <input
                            type="checkbox"
                            checked={!!p.reseauxPosted[r]}
                            onChange={() => toggleReseauPosted(p, r)}
                            title="Posté sur ce réseau"
                            style={{ marginRight: 4, cursor: "pointer" }}
                          />
                          {r}
                          <button className="icon-btn" style={{ padding: 0, fontSize: 10 }} onClick={() => toggleReseau(p, r)}>
                            <i className="fa-solid fa-xmark" aria-hidden="true" />
                          </button>
                        </span>
                      )}
                      {i === span - 1 && unpicked.length > 0 && (
                        <select value="" onChange={(e) => e.target.value && toggleReseau(p, e.target.value)} style={{ fontSize: 11 }}>
                          <option value="">+ réseau</option>
                          {unpicked.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                    </td>
                    {i === 0 && (
                      <>
                        <td rowSpan={span}>
                          <MemberSelect members={members} value={p.coPost?.id} onChange={(id) => patch(p, { coPostMemberId: id })} />
                          {!p.coPost && p.coPostRaw && <div className="muted small">« {p.coPostRaw} »</div>}
                        </td>
                        <td rowSpan={span}>
                          <button
                            type="button"
                            className="texte-btn"
                            onClick={() => setTexteFor(p.id)}
                            title="Ouvrir le texte du post"
                            aria-label={`Texte du post « ${p.itemTitle || "sans titre"} »`}
                          >
                            {p.texte ? <span className="texte-btn__preview">{p.texte}</span> : <span className="muted"><i className="fa-solid fa-pen" aria-hidden="true" /> Écrire…</span>}
                          </button>
                        </td>
                        <td rowSpan={span}>
                          {p.lien && <a href={p.lien} target="_blank" rel="noreferrer"><i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" /></a>}
                          <input value={p.lien} onChange={(e) => patch(p, { lien: e.target.value })} style={{ width: 100 }} />
                        </td>
                        <td rowSpan={span}>
                          <input
                            type="checkbox"
                            checked={p.posted}
                            disabled
                            title="Calculé : coché une fois que chaque réseau ci-contre est lui-même coché"
                          />
                        </td>
                        {isAdmin && (
                          <td rowSpan={span}>
                            <button className="icon-btn" onClick={() => removePost(p)}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
                          </td>
                        )}
                      </>
                    )}
                  </tr>
                ));
              })}
              {rows.length === 0 && <tr><td colSpan={columns.length} className="muted">Aucun post pour cette saison.</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
        </div>
      )}

      {texteRow && (
        <TexteModal
          post={texteRow}
          onClose={() => setTexteFor(null)}
          onSave={async (texte) => {
            await patch(texteRow, { texte });
            setTexteFor(null);
          }}
        />
      )}
    </div>
  );
}

// Fenêtre par-dessus la page pour écrire / relire le texte d'un post (trop long pour une cellule de tableau).
// Brouillon local : rien n'est envoyé tant qu'on n'a pas cliqué « Enregistrer » ; Échap ou « Annuler » l'abandonne
// (avec confirmation s'il y a des modifications).
function TexteModal({ post, onClose, onSave }) {
  const [draft, setDraft] = useState(post.texte || "");
  const [saving, setSaving] = useState(false);
  const dirty = draft !== (post.texte || "");
  const taRef = useRef(null);

  const close = () => {
    if (dirty && !window.confirm("Abandonner les modifications du texte ?")) return;
    onClose();
  };
  useEffect(() => {
    taRef.current?.focus();
    const onKey = (e) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return (
    <div className="modal-overlay" onClick={close}>
      <div className="modal-box" role="dialog" aria-modal="true" aria-label="Texte du post" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ margin: 0 }}>{post.itemTitle || "Texte du post"}</h3>
          <button className="icon-btn" onClick={close} aria-label="Fermer"><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
        </div>
        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ width: "100%", minHeight: 260, resize: "vertical", boxSizing: "border-box" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, gap: 8 }}>
          <span className="muted small">{draft.length} caractère{draft.length > 1 ? "s" : ""}</span>
          <span style={{ display: "flex", gap: 8 }}>
            <button className="link-btn secondary" onClick={close}>Annuler</button>
            <button
              className="link-btn"
              disabled={!dirty || saving}
              onClick={async () => {
                setSaving(true);
                try {
                  await onSave(draft);
                } finally {
                  setSaving(false);
                }
              }}
            >
              <i className="fa-solid fa-check" aria-hidden="true" /> Enregistrer
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

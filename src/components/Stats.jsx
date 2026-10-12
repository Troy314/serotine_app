import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { sortSeasonsDesc } from "../lib/seasons.js";
import { toCsv, downloadCsv } from "../lib/csv.js";
import StatsExport from "./StatsExport.jsx";
import DonutChart from "./DonutChart.jsx";
import BarChart from "./BarChart.jsx";

const MONTH_LABEL = {
  "01": "Jan", "02": "Fév", "03": "Mars", "04": "Avr", "05": "Mai", "06": "Juin",
  "07": "Juil", "08": "Août", "09": "Sept", "10": "Oct", "11": "Nov", "12": "Déc",
};

const BOHR_CSV_COLUMNS = [
  { label: "Numéro", get: (a) => a.issueLabel },
  { label: "Mois", get: (a) => a.issueMonth },
  { label: "Sujet", get: (a) => a.subject },
  { label: "Thématique", get: (a) => a.topic },
  { label: "Rédacteur·ice", get: (a) => a.author?.displayName || "" },
  { label: "Concept", get: (a) => a.concept },
  { label: "État rédaction", get: (a) => a.etatRedaction },
  { label: "État mise en page", get: (a) => a.etatMiseEnPage },
  { label: "Pages", get: (a) => a.pages },
  { label: "État audio", get: (a) => a.etatAudio },
  { label: "Communication RS", get: (a) => a.communicationRs },
];

const COM_CSV_COLUMNS = [
  { label: "Date", get: (p) => p.postDate },
  { label: "Type", get: (p) => p.kind },
  { label: "Item", get: (p) => p.itemTitle },
  { label: "Réseaux", get: (p) => p.reseaux.join(" / ") },
  { label: "Co-post", get: (p) => p.coPost?.displayName || p.coPostRaw || "" },
  { label: "Posté", get: (p) => (p.posted ? "oui" : "non") },
];

const ALL_SEASONS = "__all__";

// "À découper" (see BohrBoard.jsx) is a real spreadsheet convention for
// "not yet slotted into a magazine" — it isn't a real issue, so it's
// excluded from every "per magazine"/"nb of magazines" count here.
function isRealIssue(label) {
  return label && label !== "À découper";
}

export default function Stats({ isAdmin }) {
  const [articles, setArticles] = useState([]);
  const [posts, setPosts] = useState([]);
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.bohr.list(), api.com.list()]).then(([a, p]) => {
      setArticles(a);
      setPosts(p);
      setLoading(false);
    });
  }, []);

  const seasons = useMemo(
    () => sortSeasonsDesc(new Set([...articles.map((a) => a.season), ...posts.map((p) => p.season)].filter(Boolean))),
    [articles, posts]
  );
  useEffect(() => {
    // A real bug: without the ALL_SEASONS exception, this immediately
    // snapped "Toutes saisons" back to a real season the instant it was
    // picked, since ALL_SEASONS is never itself a member of `seasons` —
    // caught by the report that the toggle "wasn't opening" at all.
    if (seasons.length && season !== ALL_SEASONS && !seasons.includes(season)) setSeason(seasons[0]);
  }, [seasons, season]);

  const isAllTime = season === ALL_SEASONS;
  const seasonArticles = useMemo(
    () => (isAllTime ? articles : articles.filter((a) => a.season === season)),
    [articles, season, isAllTime]
  );
  const seasonPosts = useMemo(
    () => (isAllTime ? posts : posts.filter((p) => p.season === season)),
    [posts, season, isAllTime]
  );

  const totalPages = seasonArticles.reduce((sum, a) => sum + (a.pages || 0), 0);
  const postedCount = seasonPosts.filter((p) => p.posted).length;
  const contributorCount = new Set(seasonArticles.filter((a) => a.author).map((a) => a.author.id)).size;
  const magazineCount = useMemo(
    () => new Set(seasonArticles.filter((a) => isRealIssue(a.issueLabel)).map((a) => `${a.season}|${a.issueLabel}`)).size,
    [seasonArticles]
  );

  // Pages per article type (concept), per magazine — a real matrix table:
  // rows = magazines in view, columns = whichever concepts actually
  // appear. A table, not a chart: it's genuinely two-dimensional
  // (magazine × concept), which a single pie/donut can't represent.
  const perMagazine = useMemo(() => {
    const concepts = Array.from(new Set(seasonArticles.map((a) => a.concept).filter(Boolean))).sort();
    const byIssue = new Map();
    for (const a of seasonArticles) {
      const key = `${a.season}|${a.issueOrder}|${a.issueLabel}`;
      if (!byIssue.has(key)) {
        byIssue.set(key, { season: a.season, label: a.issueLabel || "À découper", month: a.issueMonth, order: a.issueOrder, byConcept: {}, total: 0 });
      }
      const row = byIssue.get(key);
      row.byConcept[a.concept] = (row.byConcept[a.concept] || 0) + (a.pages || 0);
      row.total += a.pages || 0;
    }
    const rows = Array.from(byIssue.values()).sort((a, b) => (a.season === b.season ? b.order - a.order : b.season.localeCompare(a.season)));
    return { concepts, rows };
  }, [seasonArticles]);

  const articlesByTopic = useMemo(() => {
    const map = new Map();
    for (const a of seasonArticles) {
      const key = a.topic || "(sans thématique)";
      map.set(key, (map.get(key) || 0) + 1);
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [seasonArticles]);

  const pagesByTopic = useMemo(() => {
    const map = new Map();
    for (const a of seasonArticles) {
      const key = a.topic || "(sans thématique)";
      map.set(key, (map.get(key) || 0) + (a.pages || 0));
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [seasonArticles]);

  const postsByReseau = useMemo(() => {
    const map = new Map();
    for (const p of seasonPosts) {
      for (const r of p.reseaux) map.set(r, (map.get(r) || 0) + 1);
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [seasonPosts]);

  const articlesByAuthor = useMemo(() => {
    const map = new Map();
    for (const a of seasonArticles) {
      if (!a.author) continue;
      map.set(a.author.displayName, (map.get(a.author.displayName) || 0) + 1);
    }
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [seasonArticles]);

  // Posts per calendar month, chronological — a real "trend over time"
  // shape (unlike the part-to-whole breakdowns above), so a sequential
  // bar chart per the dataviz skill rather than another donut. Uses
  // postDate (a real date) rather than Bohr's free-text issueMonth, and
  // naturally spans the whole timeline when "Toutes saisons" is active.
  const postsByMonth = useMemo(() => {
    const map = new Map();
    for (const p of seasonPosts) {
      if (!p.postDate) continue;
      const ym = p.postDate.slice(0, 7); // YYYY-MM
      map.set(ym, (map.get(ym) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([ym, value]) => {
        const [y, m] = ym.split("-");
        return { label: `${MONTH_LABEL[m] || m} ${y.slice(2)}`, value };
      });
  }, [seasonPosts]);

  if (loading) return <p className="muted">Chargement…</p>;

  const seasonLabel = isAllTime ? "toutes saisons" : season;
  const csvSuffix = isAllTime ? "toutes-saisons" : season;

  return (
    <div>
      <div className="section-toolbar">
        {seasons.map((s) => (
          <button key={s} className={`select-chip ${season === s ? "active" : ""}`} onClick={() => setSeason(s)}>{s}</button>
        ))}
        <button className={`select-chip ${isAllTime ? "active" : ""}`} onClick={() => setSeason(ALL_SEASONS)}>
          <i className="fa-solid fa-infinity" aria-hidden="true" /> Toutes saisons
        </button>
        <span style={{ flex: 1 }} />
        <button
          className="link-btn secondary"
          onClick={() => downloadCsv(`tableau-de-bohr-${csvSuffix}.csv`, toCsv(seasonArticles, BOHR_CSV_COLUMNS))}
        >
          <i className="fa-solid fa-download" aria-hidden="true" /> Tableau de Bohr (CSV)
        </button>
        <button
          className="link-btn secondary"
          onClick={() => downloadCsv(`plan-de-communication-${csvSuffix}.csv`, toCsv(seasonPosts, COM_CSV_COLUMNS))}
        >
          <i className="fa-solid fa-download" aria-hidden="true" /> Plan de Com (CSV)
        </button>
      </div>

      <div className="card">
        <h3 style={{ textTransform: "capitalize" }}>Vue d'ensemble — {seasonLabel}</h3>
        <p>
          <strong>{magazineCount}</strong> numéro(s) · <strong>{seasonArticles.length}</strong> sujet(s) · <strong>{totalPages}</strong> page(s) ·{" "}
          <strong>{contributorCount}</strong> contributeur·ice(s)
        </p>
        <p><strong>{seasonPosts.length}</strong> post(s) planifiés · <strong>{postedCount}</strong> posté(s)</p>
      </div>

      <div className="card table-scroll">
        <h3 style={{ textTransform: "capitalize" }}>Pages par type d'article, par numéro — {seasonLabel}</h3>
        {perMagazine.rows.length === 0 ? (
          <p className="muted small">Aucun sujet.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Numéro</th>
                {isAllTime && <th>Saison</th>}
                {perMagazine.concepts.map((c) => <th key={c}>{c}</th>)}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {perMagazine.rows.map((row) => (
                <tr key={`${row.season}-${row.order}-${row.label}`}>
                  <td>{row.label}{row.month && ` — ${row.month}`}</td>
                  {isAllTime && <td className="muted small">{row.season}</td>}
                  {perMagazine.concepts.map((c) => <td key={c}>{row.byConcept[c] || 0}</td>)}
                  <td><strong>{row.total}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="row-2">
        <div className="card">
          <h3>Articles par thématique</h3>
          <DonutChart data={articlesByTopic} valueLabel="sujets" />
        </div>
        <div className="card">
          <h3>Pages par thématique</h3>
          <DonutChart data={pagesByTopic} valueLabel="pages" />
        </div>
      </div>

      <div className="row-2">
        <div className="card">
          <h3>Contributeur·ices (par nombre de sujets)</h3>
          <DonutChart data={articlesByAuthor} valueLabel="sujets" />
        </div>
        <div className="card">
          <h3>Posts par réseau</h3>
          <DonutChart data={postsByReseau} valueLabel="posts" />
        </div>
      </div>

      <div className="card">
        <h3 style={{ textTransform: "capitalize" }}>Posts par mois — {seasonLabel}</h3>
        <BarChart data={postsByMonth} valueLabel="post(s)" />
      </div>

      {isAdmin && <StatsExport />}
    </div>
  );
}

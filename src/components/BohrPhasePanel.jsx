import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { sortSeasonsDesc } from "../lib/seasons.js";
import BohrKanban from "./BohrKanban.jsx";

/** Embeds one Tableau de Bohr "step" board inside another section — Mise
 * en page and Podcast both got this so they're a working list of what
 * needs doing, not just a page of outbound links. Self-contained: fetches
 * its own Bohr data rather than requiring the parent section to know
 * anything about Bohr. */
export default function BohrPhasePanel({ phaseKey, isAdmin, views }) {
  // `views` (facultatif) : plusieurs Kanban au choix, un seul affiché à la fois — [{ label, phaseKey, roleKeys? }]. `roleKeys` limite
  // les responsables montrés sur les cartes (ex. « Montage » seulement). Sans `views`, un seul Kanban : `phaseKey`.
  const [viewIdx, setViewIdx] = useState(0);
  const view = views ? views[viewIdx] : { phaseKey };
  const [articles, setArticles] = useState([]);
  const [statusOptions, setStatusOptions] = useState({});
  const [season, setSeason] = useState(null);
  const [loading, setLoading] = useState(true);

  function load() {
    Promise.all([api.bohr.list(), api.statusOptions.list()]).then(([arts, opts]) => {
      setArticles(arts);
      const byField = {};
      for (const o of opts) (byField[o.field] ||= []).push(o);
      setStatusOptions(byField);
      setLoading(false);
    });
  }
  useEffect(load, []);

  const seasons = useMemo(() => sortSeasonsDesc(new Set(articles.map((a) => a.season).filter(Boolean))), [articles]);
  useEffect(() => {
    if (seasons.length && !seasons.includes(season)) setSeason(seasons[0]);
  }, [seasons, season]);

  async function patch(article, body) {
    const updated = await api.bohr.update(article.id, body);
    setArticles((prev) => prev.map((a) => (a.id === article.id ? updated : a)));
  }

  if (loading) return <p className="muted">Chargement…</p>;

  const filtered = articles.filter((a) => a.season === season);

  return (
    <div>
      <div className="section-toolbar">
        {seasons.map((s) => (
          <button key={s} className={`select-chip ${season === s ? "active" : ""}`} onClick={() => setSeason(s)}>{s}</button>
        ))}
        {views && <span style={{ flex: 1 }} />}
        {views && views.map((v, i) => (
          <button key={v.label} className={`select-chip ${viewIdx === i ? "active" : ""}`} onClick={() => setViewIdx(i)}>{v.label}</button>
        ))}
      </div>
      <BohrKanban
        articles={filtered}
        statusOptions={statusOptions}
        editAsAdmin={isAdmin}
        onPatch={patch}
        fixedPhase={view.phaseKey}
        roleKeys={view.roleKeys}
      />
    </div>
  );
}

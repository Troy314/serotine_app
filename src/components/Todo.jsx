import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { MIN_RELECTEURS, articlesToProofread, pendingTasksFor, pendingTasksByArticle } from "../lib/todo.js";

// Page « À faire » : (1) les articles qui n'ont pas encore assez de relecteurs, (2) les tâches en attente d'une personne
// (par défaut la personne connectée). Règles dans src/lib/todo.js.
export default function Todo({ currentUserId, isAdmin }) {
  const [articles, setArticles] = useState(null);
  const [posts, setPosts] = useState([]);
  const [members, setMembers] = useState([]);
  const [whoId, setWhoId] = useState(currentUserId);
  const [busyId, setBusyId] = useState(null);
  const [showComplete, setShowComplete] = useState(false); // aussi les articles qui ont déjà 3 relecteurs ou plus

  useEffect(() => {
    Promise.all([api.bohr.list(), api.com.list(), api.members.list()]).then(([arts, ps, ms]) => {
      setArticles(arts);
      setPosts(ps);
      setMembers(ms);
    });
  }, []);

  const toProofread = useMemo(() => (articles ? articlesToProofread(articles, { includeComplete: showComplete }) : []), [articles, showComplete]);
  const missingCount = useMemo(() => (articles ? articlesToProofread(articles).length : 0), [articles]);
  const tasks = useMemo(() => (articles ? pendingTasksFor(whoId, articles, posts) : []), [articles, posts, whoId]);

  const team = useMemo(() => (articles && isAdmin ? pendingTasksByArticle(members, articles, posts) : []), [articles, members, posts, isAdmin]);
  const teamTotal = team.reduce((n, g) => n + g.entries.length, 0);

  if (!articles) return <p className="muted">Chargement…</p>;

  async function toggleMe(a) {
    const ids = a.relecture.map((m) => m.id);
    const next = ids.includes(currentUserId) ? ids.filter((id) => id !== currentUserId) : [...ids, currentUserId];
    setBusyId(a.id);
    try {
      const updated = await api.bohr.setRelecture(a.id, next);
      setArticles((prev) => prev.map((x) => (x.id === a.id ? updated : x)));
    } finally {
      setBusyId(null);
    }
  }

  const who = members.find((m) => m.id === whoId);
  const isMe = whoId === currentUserId;

  return (
    <div className="todo">
      <section className="card">
        <h2>À relire</h2>
        <p className="muted small">
          Un article est « ok » à partir de {MIN_RELECTEURS} relecteurs — c'est un <strong>minimum</strong>, pas un maximum : on peut être aussi nombreux·ses qu'on veut à relire.
          Voici ceux qui n'en ont pas assez ({missingCount}), les plus urgents d'abord. Les articles terminés ou annulés n'apparaissent pas.
        </p>
        <label className="muted small" style={{ display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
          <input type="checkbox" checked={showComplete} onChange={(e) => setShowComplete(e.target.checked)} />
          Afficher aussi les articles qui ont déjà {MIN_RELECTEURS} relecteurs ou plus (pour en ajouter d'autres)
        </label>
        {toProofread.length === 0 ? (
          <p className="muted"><i className="fa-solid fa-circle-check" aria-hidden="true" /> Tous les articles en cours ont assez de relecteurs (cochez la case ci-dessus pour en ajouter d'autres).</p>
        ) : (
          <ul className="todo-list">
            {toProofread.map((a) => {
              const mine = a.relecture.some((m) => m.id === currentUserId);
              return (
                <li key={a.id} className="todo-item">
                  <div className="todo-item__main">
                    <strong>{a.subject || "(sans titre)"}</strong>
                    <div className="muted small">
                      {[a.season, a.issueLabel].filter(Boolean).join(" · ")} — {a.etatRedaction}
                    </div>
                    <div className="small">
                      {a.relecture.length === 0 ? <span className="muted">Aucun relecteur</span> : a.relecture.map((m) => <span key={m.id} className="tag" style={{ marginRight: 4 }}>{m.displayName}</span>)}
                    </div>
                  </div>
                  <div className="todo-item__side">
                    <span className={`todo-count ${a.relecture.length === 0 ? "todo-count--none" : ""} ${a.relecture.length >= MIN_RELECTEURS ? "todo-count--ok" : ""}`} title={a.relecture.length >= MIN_RELECTEURS ? "Minimum atteint — on peut encore en ajouter" : "Relecteurs / minimum"}>
                      {a.relecture.length >= MIN_RELECTEURS ? `✓ ${a.relecture.length}` : `${a.relecture.length}/${MIN_RELECTEURS}`}
                    </span>
                    <button className={mine ? "link-btn secondary" : "link-btn"} disabled={busyId === a.id || !currentUserId} onClick={() => toggleMe(a)}>
                      {mine ? "Me retirer" : <><i className="fa-solid fa-plus" aria-hidden="true" /> Je relis</>}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{isMe ? "Mes tâches en attente" : `Tâches en attente — ${who?.displayName || ""}`}</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
          <label className="muted small" htmlFor="todo-who">Voir les tâches de :</label>
          <select id="todo-who" value={whoId ?? ""} onChange={(e) => setWhoId(Number(e.target.value))}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.displayName}{m.id === currentUserId ? " (moi)" : ""}{m.active === false ? " (ancien·ne)" : ""}</option>)}
          </select>
        </div>
        {tasks.length === 0 ? (
          <p className="muted"><i className="fa-solid fa-circle-check" aria-hidden="true" /> Rien en attente.</p>
        ) : (
          <ul className="todo-list">
            {tasks.map((t, i) => (
              <li key={`${t.article.id}-${t.role}-${i}`} className="todo-item">
                <div className="todo-item__main">
                  <strong>{t.article.subject || "(sans titre)"}</strong>
                  <div className="muted small">{[t.article.season, t.article.issueLabel].filter(Boolean).join(" · ")}</div>
                </div>
                <div className="todo-item__side">
                  <span className="tag">{t.role}</span>
                  <span className="muted small">{t.detail}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
        <details className="muted small" style={{ marginTop: 10 }}>
          <summary>Comment une tâche est comptée</summary>
          <ul>
            <li>Rédaction, relecture, correction, sources : tant que l'état de rédaction n'est ni « Finito » ni « Annulé ».</li>
            <li>Mise en page : tant que l'état n'est pas « Finito » ; illustration : tant qu'il n'est ni « Finito » ni « Non » (pas d'illustration prévue).</li>
            <li>Enregistrement : tant que l'audio est « Pas commencé » ; montage : jusqu'à « Traité » (« Non » = pas de version audio).</li>
            <li>Communication : tant qu'aucun post n'est lié à l'article, ou qu'un post lié n'est pas publié.</li>
          </ul>
        </details>
      </section>

      {isAdmin && (
        <section className="card">
          <h2>Toute l'équipe — tâches en attente</h2>
          <p className="muted small">
            Réservé aux admins (C2R). {teamTotal} tâche{teamTotal > 1 ? "s" : ""} en attente sur {team.length} article{team.length > 1 ? "s" : ""}, classés comme dans le Tableau de Bohr
            (saison et numéro les plus récents d'abord) ; mêmes règles que ci-dessus. Les rôles sans responsable ne sont pas comptés ici.
          </p>
          {team.length === 0 ? (
            <p className="muted"><i className="fa-solid fa-circle-check" aria-hidden="true" /> Aucune tâche en attente dans l'équipe.</p>
          ) : (
            team.map(({ article, entries }) => (
              <details key={article.id} className="team-group" open={entries.length <= 6}>
                <summary>
                  <strong>{article.subject || "(sans titre)"}</strong>
                  <span className="muted small">{[article.season, article.issueLabel].filter(Boolean).join(" · ")}</span>
                  <span className="todo-count">{entries.length}</span>
                </summary>
                <ul className="todo-list">
                  {entries.map((e, i) => (
                    <li key={`${e.member.id}-${e.role}-${i}`} className="todo-item">
                      <div className="todo-item__main">
                        <span>{e.member.displayName}</span>
                        {e.member.active === false && <span className="tag tag--gone" style={{ marginLeft: 6 }} title="À réattribuer">n'est plus au projet</span>}
                      </div>
                      <div className="todo-item__side">
                        <span className="tag">{e.role}</span>
                        <span className="muted small">{e.detail}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            ))
          )}
        </section>
      )}
    </div>
  );
}

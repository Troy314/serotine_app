import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api.js";
import { toCsv, downloadCsv } from "../lib/csv.js";
import LineChart from "./LineChart.jsx";
import BarChart from "./BarChart.jsx";

// PROTOTYPE (admins) — statistiques du compte Instagram via l'API officielle (voir server/instagram-stats.js). Rien n'est enregistré
// côté base à part le jeton d'accès (côté serveur, jamais renvoyé au navigateur).
const COLUMNS = [
  { label: "Date", get: (p) => p.date },
  { label: "Type", get: (p) => p.type },
  { label: "Légende", get: (p) => p.caption },
  { label: "Lien", get: (p) => p.permalink },
  { label: "Portée", get: (p) => p.reach ?? "" },
  { label: "Vues", get: (p) => p.views ?? "" },
  { label: "J'aime", get: (p) => p.likes ?? "" },
  { label: "Commentaires", get: (p) => p.comments ?? "" },
  { label: "Partages", get: (p) => p.shares ?? "" },
  { label: "Enregistrements", get: (p) => p.saved ?? "" },
  { label: "Interactions", get: (p) => p.interactions ?? "" },
  { label: "Taux d'engagement (%)", get: (p) => p.engagementRate ?? "" },
];
const short = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "?");
const fmt = (n) => (n == null ? "—" : n.toLocaleString("fr-FR"));
const avg = (xs) => { const v = xs.filter((x) => x != null); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null; };

export default function InstagramStats() {
  const [status, setStatus] = useState(null); // { connected, username, expiresAt }
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null); // { account, posts }

  useEffect(() => {
    api.instagram.status().then(setStatus).catch((e) => setError(e.message));
  }, []);

  async function run(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const recent = useMemo(() => (data ? [...data.posts].filter((p) => p.date).sort((a, b) => a.date.localeCompare(b.date)) : []), [data]);

  return (
    <>
      <h3 style={{ marginTop: 20 }}>Instagram — publications du compte</h3>
      {status === null && !error && <p className="muted small">Chargement…</p>}

      {status && !status.connected && (
        <form className="muted small" onSubmit={(e) => { e.preventDefault(); run(async () => { setStatus(await api.instagram.connect(token.trim())); setToken(""); }); }}>
          <p>
            Pas encore connecté. Il faut un compte Instagram <strong>professionnel</strong> et un jeton d'accès généré dans l'application Meta de l'association
            (« API Instagram avec connexion Instagram », permissions <code>instagram_business_basic</code> et <code>instagram_business_manage_insights</code>).
            Collez-le ici : il est vérifié puis gardé côté serveur.
          </p>
          <input type="password" autoComplete="off" placeholder="Jeton d'accès Instagram" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: "min(420px, 100%)" }} />
          <button className="link-btn" type="submit" disabled={busy || !token.trim()} style={{ marginLeft: 8 }}>Connecter</button>
        </form>
      )}

      {status?.connected && (
        <>
          <p className="muted small">
            Connecté{status.username && <> en tant que <strong>@{status.username}</strong></>}.{" "}
            {status.expiresAt ? `Jeton valable jusqu'au ${new Date(status.expiresAt).toLocaleDateString("fr-FR")}.` : "Un jeton longue durée est valable 60 jours : pensez à le renouveler (bouton ci-dessous)."}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="link-btn" disabled={busy} onClick={() => run(async () => setData(await api.stats.instagram()))}>
              <i className="fa-brands fa-instagram" aria-hidden="true" /> {busy ? "Chargement…" : "Charger les statistiques Instagram"}
            </button>
            <button className="link-btn secondary" disabled={busy} onClick={() => run(async () => setStatus(await api.instagram.refresh()))}>Renouveler le jeton</button>
            <button className="link-btn secondary" disabled={busy} onClick={() => { if (window.confirm("Oublier le jeton Instagram ?")) run(async () => { setStatus(await api.instagram.disconnect()); setData(null); }); }}>Déconnecter</button>
          </div>
        </>
      )}
      {error && <p className="error-box" role="alert">{error}</p>}

      {data && (
        <div style={{ marginTop: 14 }}>
          <div className="viz-tiles">
            <div className="viz-tile"><span className="muted small">Abonnés</span><strong>{fmt(data.account.followers)}</strong></div>
            <div className="viz-tile"><span className="muted small">Publications analysées</span><strong>{data.posts.length}</strong></div>
            <div className="viz-tile"><span className="muted small">Portée moyenne</span><strong>{fmt(avg(data.posts.map((p) => p.reach)))}</strong></div>
            <div className="viz-tile"><span className="muted small">Interactions moyennes</span><strong>{fmt(avg(data.posts.map((p) => p.interactions)))}</strong></div>
            <div className="viz-tile"><span className="muted small">Engagement moyen</span><strong>{avg(data.posts.map((p) => p.engagementRate)) == null ? "—" : `${avg(data.posts.map((p) => p.engagementRate))} %`}</strong></div>
          </div>
          {recent.length > 0 && (
            <>
              <LineChart
                title="Taux d'engagement par publication"
                unit=" %"
                series={[{ key: "rate", label: "Interactions / portée", color: "var(--viz-1)" }]}
                points={recent.map((p) => ({ label: short(p.date), title: `${p.type}${p.caption ? " — " + p.caption.slice(0, 50) : ""}`, values: { rate: p.engagementRate } }))}
              />
              <h4 style={{ margin: "18px 0 6px" }}>Portée par publication</h4>
              <BarChart data={recent.map((p) => ({ label: short(p.date), value: p.reach ?? p.views ?? 0 }))} valueLabel="personnes atteintes" />
              {recent.every((p) => p.reach == null) && <p className="muted small">Meta n'a pas fourni la portée : le graphique montre les vues (ou 0 si rien n'est disponible).</p>}
            </>
          )}
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table className="data-table">
              <thead><tr><th>Date</th><th>Type</th><th>Légende</th><th>Portée</th><th>J'aime</th><th>Comm.</th><th>Interactions</th></tr></thead>
              <tbody>
                {data.posts.slice(0, 10).map((p) => (
                  <tr key={p.id}>
                    <td>{p.date}</td><td>{p.type}</td>
                    <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}>{p.permalink ? <a href={p.permalink} target="_blank" rel="noreferrer">{p.caption || "(sans légende)"}</a> : p.caption}</td>
                    <td>{fmt(p.reach)}</td><td>{fmt(p.likes)}</td><td>{fmt(p.comments)}</td><td>{fmt(p.interactions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="link-btn secondary" style={{ marginTop: 8 }} disabled={data.posts.length === 0} onClick={() => downloadCsv("instagram-publications.csv", toCsv(data.posts, COLUMNS))}>
            <i className="fa-solid fa-download" aria-hidden="true" /> Télécharger le CSV
          </button>
        </div>
      )}
    </>
  );
}

import { useState } from "react";
import { api } from "../lib/api.js";
import { toCsv, downloadCsv } from "../lib/csv.js";
import BrevoCharts from "./BrevoCharts.jsx";
import InstagramStats from "./InstagramStats.jsx";

// PROTOTYPE (admins) — statistiques e-mail (Brevo) et Instagram, toutes deux via leur API officielle, en lecture seule.
// Rien n'est enregistré dans la base : on charge, on vérifie l'aperçu, on télécharge un CSV propre.
const BREVO_COLUMNS = [
  { label: "Campagne", get: (c) => c.name },
  { label: "Objet", get: (c) => c.subject },
  { label: "Date d'envoi", get: (c) => c.sentDate },
  { label: "Envoyés", get: (c) => c.sent },
  { label: "Délivrés", get: (c) => c.delivered },
  { label: "Ouvertures uniques", get: (c) => c.opens },
  { label: "Taux d'ouverture (%)", get: (c) => c.openRate ?? "" },
  { label: "Personnes ayant cliqué", get: (c) => c.clickers },
  { label: "Clics uniques", get: (c) => c.clicks },
  { label: "Taux de clic (%)", get: (c) => c.clickRate ?? "" },
  { label: "Désabonnements", get: (c) => c.unsubscriptions },
  { label: "Rebonds durs", get: (c) => c.hardBounces },
  { label: "Rebonds doux", get: (c) => c.softBounces },
  { label: "Plaintes", get: (c) => c.complaints },
];

export default function StatsExport() {
  const [brevo, setBrevo] = useState(null); // { campaigns } | { error } | "loading"

  async function loadBrevo() {
    setBrevo("loading");
    try {
      setBrevo(await api.stats.brevo());
    } catch (e) {
      setBrevo({ error: e.message });
    }
  }

  return (
    <div className="card">
      <h2>Exporter des statistiques <span className="tag">prototype</span></h2>
      <p className="muted small">
        Réservé aux admins. Rien n'est enregistré (sauf le jeton Instagram, côté serveur) : on charge, on vérifie, on télécharge un CSV. Les formats réels (réponses de Brevo et d'Instagram)
        n'ont pas encore été comparés à vos données — vérifiez les chiffres avec les sites eux-mêmes.
      </p>

      <h3>Brevo — campagnes e-mail envoyées</h3>
      <button className="link-btn" onClick={loadBrevo} disabled={brevo === "loading"}>
        <i className="fa-solid fa-envelope-open-text" aria-hidden="true" /> {brevo === "loading" ? "Chargement…" : "Charger les campagnes Brevo"}
      </button>
      {brevo?.error && <p className="error-box" role="alert">{brevo.error}</p>}
      {brevo?.campaigns && (
        <>
          <p className="muted small">{brevo.campaigns.length} campagne(s) envoyée(s).</p>
          <BrevoCharts campaigns={brevo.campaigns} />
          {brevo.campaigns.length > 0 && (
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Campagne</th><th>Date</th><th>Délivrés</th><th>Ouvertures</th><th>Clics</th><th>Désabo.</th></tr></thead>
                <tbody>
                  {brevo.campaigns.slice(0, 10).map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td><td>{c.sentDate}</td><td>{c.delivered}</td>
                      <td>{c.opens}{c.openRate != null && ` (${c.openRate} %)`}</td>
                      <td>{c.clickers}{c.clickRate != null && ` (${c.clickRate} %)`}</td>
                      <td>{c.unsubscriptions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {brevo.campaigns.length > 10 && <p className="muted small">Aperçu des 10 plus récentes ; le CSV contient tout.</p>}
          <button className="link-btn secondary" disabled={brevo.campaigns.length === 0} onClick={() => downloadCsv("brevo-campagnes.csv", toCsv(brevo.campaigns, BREVO_COLUMNS))}>
            <i className="fa-solid fa-download" aria-hidden="true" /> Télécharger le CSV
          </button>
        </>
      )}

      <InstagramStats />
    </div>
  );
}

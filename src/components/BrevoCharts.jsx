import { useMemo } from "react";
import LineChart from "./LineChart.jsx";
import BarChart from "./BarChart.jsx";

// Graphiques des campagnes Brevo : 4 chiffres clés (pastilles, pas de faux graphique pour un seul nombre), l'évolution des taux d'ouverture et
// de clic (une seule échelle : des %), et le volume délivré par campagne. Les 12 campagnes les plus récentes, de la plus ancienne à la plus récente.
const SERIES = [
  { key: "open", label: "Taux d'ouverture", color: "var(--viz-1)" },
  { key: "click", label: "Taux de clic", color: "var(--viz-2)" },
];
const short = (iso) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "?");

export default function BrevoCharts({ campaigns }) {
  const recent = useMemo(() => [...campaigns].filter((c) => c.sentDate).sort((a, b) => a.sentDate.localeCompare(b.sentDate)).slice(-12), [campaigns]);
  const totals = useMemo(() => {
    const t = campaigns.reduce((a, c) => ({ delivered: a.delivered + c.delivered, opens: a.opens + c.opens, clickers: a.clickers + c.clickers, unsub: a.unsub + c.unsubscriptions }), { delivered: 0, opens: 0, clickers: 0, unsub: 0 });
    const pct = (a) => (t.delivered > 0 ? Math.round((a / t.delivered) * 1000) / 10 : null); // moyenne pondérée par le volume
    return { ...t, openRate: pct(t.opens), clickRate: pct(t.clickers) };
  }, [campaigns]);
  if (campaigns.length === 0) return null;
  const fmt = (n) => (n == null ? "—" : n.toLocaleString("fr-FR"));

  return (
    <div style={{ marginTop: 14 }}>
      <div className="viz-tiles">
        <div className="viz-tile"><span className="muted small">Campagnes envoyées</span><strong>{fmt(campaigns.length)}</strong></div>
        <div className="viz-tile"><span className="muted small">E-mails délivrés</span><strong>{fmt(totals.delivered)}</strong></div>
        <div className="viz-tile"><span className="muted small">Ouverture (moyenne)</span><strong>{totals.openRate == null ? "—" : `${totals.openRate} %`}</strong></div>
        <div className="viz-tile"><span className="muted small">Clic (moyenne)</span><strong>{totals.clickRate == null ? "—" : `${totals.clickRate} %`}</strong></div>
        <div className="viz-tile"><span className="muted small">Désabonnements</span><strong>{fmt(totals.unsub)}</strong></div>
      </div>
      <LineChart
        title="Taux d'ouverture et de clic par campagne"
        unit=" %"
        series={SERIES}
        points={recent.map((c) => ({ label: short(c.sentDate), title: c.name, values: { open: c.openRate, click: c.clickRate } }))}
      />
      <h4 style={{ margin: "18px 0 6px" }}>E-mails délivrés par campagne</h4>
      <BarChart data={recent.map((c) => ({ label: short(c.sentDate), value: c.delivered }))} valueLabel="e-mails délivrés" />
      {recent.length < campaigns.length && <p className="muted small">Graphiques sur les {recent.length} campagnes les plus récentes (sur {campaigns.length}).</p>}
    </div>
  );
}

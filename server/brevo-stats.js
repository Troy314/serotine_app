/**
 * brevo-stats.js — PROTOTYPE : statistiques des campagnes e-mail Brevo (envoyées), pour export.
 *
 * Accès : API officielle Brevo v3 (`GET /emailCampaigns?statistics=globalStats`), clé API déjà enregistrée dans Administration → Newsletter
 * (stockée côté serveur, jamais renvoyée au navigateur ; une erreur n'affiche jamais la clé). Lecture seule.
 * ⚠️ Le format de réponse ci-dessous vient de la documentation Brevo, pas d'une réponse réelle de VOTRE compte : à comparer avec un vrai appel
 * (voir tests/brevo-stats.test.mjs pour la forme attendue) avant de s'y fier.
 */

const BREVO_API = "https://api.brevo.com/v3";
const PAGE = 100;
const MAX_CAMPAIGNS = 500; // garde-fou

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null); // % à une décimale, null si division impossible

/** Une campagne Brevo → une ligne à plat. Tolère une campagne sans statistiques (jamais d'exception sur un champ manquant). */
export function mapBrevoCampaign(c) {
  const g = c?.statistics?.globalStats || {};
  const delivered = num(g.delivered);
  return {
    id: c?.id ?? null,
    name: c?.name ?? "",
    subject: c?.subject ?? "",
    sentDate: c?.sentDate ? String(c.sentDate).slice(0, 10) : "", // « 2026-10-01T09:00:00.000+02:00 » → « 2026-10-01 »
    sent: num(g.sent),
    delivered,
    opens: num(g.uniqueViews), // ouvertures uniques
    clickers: num(g.clickers), // personnes ayant cliqué
    clicks: num(g.uniqueClicks), // clics uniques
    unsubscriptions: num(g.unsubscriptions),
    hardBounces: num(g.hardBounces),
    softBounces: num(g.softBounces),
    complaints: num(g.complaints),
    openRate: pct(num(g.uniqueViews), delivered),
    clickRate: pct(num(g.clickers), delivered),
  };
}

/** Campagnes envoyées, les plus récentes d'abord (pagination de 100, 500 au plus). Lève une erreur sans jamais inclure la clé. */
export async function fetchBrevoCampaigns(apiKey) {
  const out = [];
  for (let offset = 0; offset < MAX_CAMPAIGNS; offset += PAGE) {
    let res;
    try {
      res = await fetch(`${BREVO_API}/emailCampaigns?type=classic&status=sent&statistics=globalStats&sort=desc&limit=${PAGE}&offset=${offset}`, {
        headers: { "api-key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new Error("Brevo injoignable (réseau coupé ou délai dépassé)");
    }
    if (res.status === 401 || res.status === 403) throw new Error("Brevo a refusé la clé API (vérifier Administration → Newsletter)");
    if (!res.ok) throw new Error(`Brevo a répondu HTTP ${res.status}`);
    const body = await res.json();
    const list = Array.isArray(body?.campaigns) ? body.campaigns : [];
    out.push(...list.map(mapBrevoCampaign));
    if (list.length < PAGE) break;
  }
  return out;
}

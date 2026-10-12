/**
 * instagram-stats.js — PROTOTYPE : statistiques du compte Instagram de l'association, pour la page Statistiques (admins).
 *
 * Accès : API officielle « Instagram API with Instagram Login » (hôte graph.instagram.com), lecture seule, avec un jeton d'utilisateur Instagram
 * (permissions instagram_business_basic + instagram_business_manage_insights) généré dans l'application Meta de l'association. Le compte doit être
 * professionnel (Business ou Creator). Le jeton reste côté serveur (réglages), n'est jamais renvoyé au navigateur ni écrit dans une erreur.
 * Jeton « longue durée » : valable 60 jours, renouvelable (refreshInstagramToken) tant qu'il n'a pas expiré.
 *
 * ⚠️ Écrit d'après la documentation Meta, pas d'après une réponse réelle de VOTRE compte : les noms de mesures acceptés varient selon le type de
 * publication (photo, vidéo, reel, carrousel) et Meta les fait évoluer. Le code est donc tolérant : les compteurs « j'aime » et commentaires viennent
 * de la liste des publications (toujours disponibles) ; les mesures d'insights (portée, vues, partages, enregistrements, interactions) sont
 * demandées publication par publication et valent `null` quand Meta ne les fournit pas — jamais 0 inventé.
 */

const HOST = process.env.INSTAGRAM_API_HOST || "https://graph.instagram.com"; // INSTAGRAM_API_HOST : uniquement pour les essais contre une maquette
const VERSION = "v23.0";
const TIMEOUT = 15000;
const MAX_POSTS = 30; // appels d'insights faits un par un (le skill external-source-import demande du séquentiel) : on reste raisonnable

// Mesures d'insights par publication : l'ensemble complet d'abord, puis un repli minimal si Meta refuse la combinaison pour ce type de média.
const METRICS_FULL = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions"];
const METRICS_MIN = ["views", "likes", "comments", "total_interactions"];

const TYPE_LABEL = { IMAGE: "Image", VIDEO: "Vidéo", CAROUSEL_ALBUM: "Carrousel" };
const numOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const pct = (a, b) => (a != null && b != null && b > 0 ? Math.round((a / b) * 1000) / 10 : null);

/** Réponse d'insights de Meta → { mesure: valeur }. Tolère une réponse vide ou mal formée (renvoie {}). */
export function insightsToMap(body) {
  const out = {};
  for (const item of Array.isArray(body?.data) ? body.data : []) {
    const v = item?.values?.[0]?.value ?? item?.total_value?.value;
    if (item?.name && numOrNull(v) != null) out[item.name] = Number(v);
  }
  return out;
}

/** Une publication + ses insights → une ligne à plat. Aucune exception sur un champ manquant. */
export function mapInstagramPost(media, insights = {}) {
  const likes = numOrNull(insights.likes) ?? numOrNull(media?.like_count);
  const comments = numOrNull(insights.comments) ?? numOrNull(media?.comments_count);
  const shares = numOrNull(insights.shares);
  const saved = numOrNull(insights.saved);
  const reach = numOrNull(insights.reach);
  const views = numOrNull(insights.views);
  // Interactions : la mesure de Meta si on l'a, sinon la somme de ce qu'on connaît.
  const known = [likes, comments, shares, saved].filter((x) => x != null);
  const interactions = numOrNull(insights.total_interactions) ?? (known.length ? known.reduce((a, b) => a + b, 0) : null);
  const isReel = media?.media_product_type === "REELS";
  return {
    id: media?.id ?? null,
    date: /^\d{4}-\d{2}-\d{2}/.test(media?.timestamp || "") ? media.timestamp.slice(0, 10) : "",
    type: isReel ? "Reel" : TYPE_LABEL[media?.media_type] || media?.media_type || "",
    caption: String(media?.caption || "").replace(/\s+/g, " ").trim().slice(0, 140),
    permalink: media?.permalink || "",
    likes, comments, shares, saved, reach, views, interactions,
    engagementRate: pct(interactions, reach ?? views), // interactions / portée (à défaut : / vues)
  };
}

async function igGet(path, params, token) {
  const url = new URL(`${HOST}/${VERSION}/${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token); // méthode documentée partout par Meta ; l'URL n'est jamais journalisée ni mise dans une erreur ici
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT) });
  } catch {
    throw Object.assign(new Error("Instagram injoignable (réseau coupé ou délai dépassé)"), { status: 0 });
  }
  if (res.ok) return res.json();
  let code = null;
  try { code = (await res.json())?.error?.code ?? null; } catch { /* corps non JSON */ }
  // 190 = jeton invalide/expiré ; 10/200 = permission manquante
  if (res.status === 401 || code === 190) throw Object.assign(new Error("Instagram a refusé le jeton (invalide ou expiré) — le régénérer dans l'application Meta"), { status: res.status });
  if (code === 10 || code === 200) throw Object.assign(new Error("Il manque une permission sur le jeton (instagram_business_manage_insights)"), { status: res.status });
  throw Object.assign(new Error(`Instagram a répondu HTTP ${res.status}${code ? ` (code ${code})` : ""}`), { status: res.status });
}

/** Vérifie un jeton : renvoie { username }. */
export async function checkInstagramToken(token) {
  const me = await igGet("me", { fields: "username" }, token);
  return { username: me?.username || "" };
}

/** Prolonge un jeton longue durée (60 jours de plus) ; renvoie { token, expiresAt }. */
export async function refreshInstagramToken(token) {
  const url = new URL(`${HOST}/refresh_access_token`);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  let res;
  try { res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT) }); } catch { throw new Error("Instagram injoignable (réseau coupé ou délai dépassé)"); }
  if (!res.ok) throw new Error(`Renouvellement refusé (HTTP ${res.status}) — le jeton a peut-être expiré ou a moins de 24 h : le régénérer dans l'application Meta`);
  const body = await res.json();
  if (!body?.access_token) throw new Error("Réponse de renouvellement inattendue");
  return { token: body.access_token, expiresAt: body.expires_in ? new Date(Date.now() + Number(body.expires_in) * 1000).toISOString() : null };
}

/** Compte + dernières publications avec leurs mesures. { account: { username, followers, mediaCount }, posts: [...] } */
export async function fetchInstagramStats(token, { limit = MAX_POSTS, log = console.warn } = {}) {
  const me = await igGet("me", { fields: "username,followers_count,media_count" }, token);
  const list = await igGet("me/media", { fields: "id,caption,media_type,media_product_type,permalink,timestamp,like_count,comments_count", limit: String(Math.min(limit, MAX_POSTS)) }, token);
  const posts = [];
  for (const media of Array.isArray(list?.data) ? list.data : []) {
    let insights = {};
    for (const metrics of [METRICS_FULL, METRICS_MIN]) {
      try {
        insights = insightsToMap(await igGet(`${media.id}/insights`, { metric: metrics.join(",") }, token));
        break;
      } catch (err) {
        if (err.status === 401) throw err; // jeton refusé : inutile de continuer
        log(`Instagram insights ${media.id} (${metrics.length} mesures) : ${err.message}`); // pas de jeton dans ce message
      }
    }
    posts.push(mapInstagramPost(media, insights));
  }
  return { account: { username: me?.username || "", followers: numOrNull(me?.followers_count), mediaCount: numOrNull(me?.media_count) }, posts };
}

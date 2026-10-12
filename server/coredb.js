/**
 * coredb.js — lecture des membres du projet Sérotine dans `core_db`, via PostgREST (jamais de SQL direct).
 *
 * Rôle Postgres : `role_serotine_app` (core_db/db/init/14_serotine_app.sql) — il ne voit QUE la vue
 * `members.serotine_members_view` (id, prénom, pseudo Discord, discord_id, rôle dans le projet) :
 * pas d'email, pas de date de naissance, pas les autres membres de l'asso.
 * Authentification service-à-service : JWT HS256 signé avec le JWT_SECRET de core_db (décision 2026-10-04),
 * recréé à chaque appel (validité 60 s), jamais stocké.
 *
 * Variables : COREDB_URL (ex. http://postgrest:3000) et COREDB_JWT_SECRET. Si l'une manque, l'annuaire est
 * désactivé (mode développement hors serveur) : seul le rôle Discord contrôle l'accès, comme avant la mise
 * en conformité. Dès qu'elles sont posées, l'appartenance au projet Sérotine est EXIGÉE et une panne de
 * l'annuaire refuse la connexion (on échoue fermé, pas ouvert).
 */
import { createHmac } from "node:crypto";

const COREDB_URL = (process.env.COREDB_URL || "").replace(/\/$/, "");
const COREDB_JWT_SECRET = process.env.COREDB_JWT_SECRET || "";
const ROLE = "role_serotine_app";

export const coreDbEnabled = () => !!(COREDB_URL && COREDB_JWT_SECRET);

const b64url = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");

function makeJwt() {
  const head = b64url({ alg: "HS256", typ: "JWT" });
  const body = b64url({ role: ROLE, exp: Math.floor(Date.now() / 1000) + 60 });
  const sig = createHmac("sha256", COREDB_JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

async function get(path) {
  const res = await fetch(`${COREDB_URL}${path}`, {
    headers: { Authorization: `Bearer ${makeJwt()}`, "Accept-Profile": "members" },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) throw new Error(`core_db a répondu ${res.status} sur ${path.split("?")[0]}`);
  // discord_id est un BIGINT : PostgREST le renvoie en nombre JSON, que JavaScript arrondirait (18-19 chiffres).
  // On le remet entre guillemets avant de lire le JSON, comme le fait projectmanager.
  return JSON.parse((await res.text()).replace(/"discord_id":\s*(\d+)/g, '"discord_id":"$1"'));
}

/** Le membre du projet Sérotine qui porte ce Discord ID, ou null. Lève une erreur si l'annuaire est injoignable. */
export async function findSerotineMemberByDiscordId(discordId) {
  if (!/^\d{5,25}$/.test(String(discordId))) return null; // jamais d'identifiant libre dans l'URL
  const rows = await get(`/serotine_members_view?discord_id=eq.${discordId}&limit=1`);
  return rows[0] || null;
}

/** Tous les membres du projet Sérotine (une cinquantaine au plus). */
export async function listSerotineMembers() {
  return get(`/serotine_members_view?order=prenom`);
}

// ── Qui est encore dans le projet Sérotine ? (pour griser / interdire les personnes parties — voir server/index.js `active`) ─────────────
// L'accès à l'outil se décide à la connexion (échec fermé). Ici c'est autre chose : savoir, pour l'AFFICHAGE et les NOUVELLES désignations,
// si une personne du profil local est encore inscrite au projet. Cette lecture-là est « ouverte » : si l'annuaire est injoignable on garde
// le dernier résultat connu, et à défaut on considère tout le monde actif (on ne bloque pas le travail de l'équipe pour une panne).
let activeCache = { at: 0, ids: null };
export function resetActiveCache() { activeCache = { at: 0, ids: null }; }

/** Set des Discord ID encore inscrits au projet Sérotine, ou `null` = inconnu / annuaire désactivé (tout le monde est alors traité comme actif). */
export async function activeDiscordIds({ ttlMs = 60_000, now = Date.now, list = listSerotineMembers } = {}) {
  if (!coreDbEnabled()) return null;
  if (activeCache.ids && now() - activeCache.at < ttlMs) return activeCache.ids;
  try {
    const rows = await list();
    // Un projet vide est presque sûrement une erreur de configuration (projet renommé…) : mieux vaut « inconnu » que d'écarter toute l'équipe.
    if (rows.length === 0) {
      console.warn("core_db : le projet Sérotine ne contient personne — liste des membres actifs ignorée.");
      return activeCache.ids;
    }
    activeCache = { at: now(), ids: new Set(rows.map((r) => String(r.discord_id))) };
  } catch (err) {
    console.error("core_db injoignable (liste des membres actifs) :", err.message);
  }
  return activeCache.ids;
}

/** Une personne archivée à la main (`archived`) n'est jamais active. Sinon elle est « active » si l'annuaire est inconnu, si elle n'a pas de Discord ID (profil importé des tableurs) ou si son Discord ID est encore dans le projet. */
export const isActiveMember = (member, activeSet) =>
  !member?.archived && (!activeSet || !member?.discord_id || activeSet.has(String(member.discord_id)));

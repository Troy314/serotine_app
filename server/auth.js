/**
 * auth.js — connexion à l'outil (décidé le 2026-10-09).
 *
 * 1. IDENTIFICATION : une méthode de connexion. Discord OAuth2 est la seule pour l'instant (provisoire, avant l'OIDC de l'asso, voir
 *    _architecture/ARCHITECTURE.md §3.4). Discord ne sert qu'à dire QUI est la personne (son Discord ID) : on ne lit ni les rôles ni le serveur
 *    (scope `identify` seulement). Ce n'est pas un bot ; le jeton Discord est jeté dès l'identité lue.
 * 2. ACCÈS : la personne doit être INSCRITE AU PROJET SÉROTINE dans `core_db` (server/coredb.js, lecture seule). Oui → accès à l'outil ;
 *    non, ou `core_db` injoignable → refus (échec fermé).
 * 3. COMITÉ DE RÉDACTION : on regarde dans la BASE PRIVÉE de l'outil (colonne `members.is_admin`, appelée « comité de rédaction » / C2R dans
 *    l'interface) si la personne en fait partie ; si oui, les accès du comité sont débloqués (champs réservés du Tableau de Bohr — toujours
 *    actifs pour le C2R —, Administration, vue d'équipe, Statistiques). La liste se gère dans Administration → Membres ; plus aucun rôle
 *    Discord n'intervient. Un cran au-dessus, le super admin (implique C2R, colonne `is_super_admin`, requireSuperAdmin ci-dessous) :
 *    liens/images en haut de chaque page, « se connecter en tant que ».
 *    Amorçage : si personne n'est encore au comité, la première personne qui se connecte y entre (sinon plus personne ne pourrait désigner les autres).
 *
 * Mode développement SANS `core_db` (COREDB_URL / COREDB_JWT_SECRET absents) : l'ancien contrôle reste en secours — il faut alors avoir le rôle
 * Discord `discord_role_id` (réglage) sur le serveur DISCORD_GUILD_ID ; scope `guilds.members.read` demandé seulement dans ce mode.
 *
 * Une connexion réussie crée ou retrouve la ligne `members` (clé : discord_id). Le nom affiché n'est fixé qu'à la création (prénom de l'annuaire,
 * sinon pseudo Discord) et jamais écrasé ensuite : un nom personnalisé dans l'outil survit aux changements de pseudo Discord.
 */
import { randomBytes } from "node:crypto";
import db from "./db.js";
import { coreDbEnabled, findSerotineMemberByDiscordId } from "./coredb.js";

const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI, DISCORD_GUILD_ID } = process.env; // DISCORD_GUILD_ID : mode de secours seulement

const DISCORD_API = "https://discord.com/api/v10";
// Annuaire actif : on n'a besoin que de l'identité. Secours développement (rôle Discord) : il faut aussi lire les rôles sur un serveur.
const scopes = () => (coreDbEnabled() ? "identify" : "identify guilds.members.read");

async function getSetting(key) {
  return (await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key))?.value || "";
}

async function configWarning() {
  // DISCORD_GUILD_ID et le rôle d'accès ne servent qu'au mode de secours (sans annuaire core_db).
  const required = ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_REDIRECT_URI", ...(coreDbEnabled() ? [] : ["DISCORD_GUILD_ID"])];
  const missingEnv = required.filter((k) => !process.env[k]);
  if (missingEnv.length) return `Missing env vars: ${missingEnv.join(", ")} — copy .env.example to .env and fill them in.`;
  if (!coreDbEnabled() && !(await getSetting("discord_role_id"))) {
    return "No access role configured (mode sans annuaire) — set one in Administration → Liens & paramètres, or configure COREDB_URL / COREDB_JWT_SECRET.";
  }
  return null;
}

/** `accessMode` : « directory » (accès = inscrit au projet Sérotine dans core_db) ou « discord-role » (secours de développement). */
export async function authStatus() {
  const warning = await configWarning();
  return { configured: !warning, warning, accessMode: coreDbEnabled() ? "directory" : "discord-role" };
}

export function buildAuthorizeUrl(state) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", DISCORD_CLIENT_ID);
  url.searchParams.set("redirect_uri", DISCORD_REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", scopes());
  url.searchParams.set("state", state);
  return url.toString();
}

export function newState() {
  return randomBytes(16).toString("hex");
}

async function exchangeCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    client_secret: DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: DISCORD_REDIRECT_URI,
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status} ${await res.text()}`);
  return res.json(); // { access_token, token_type, expires_in, refresh_token, scope }
}

async function fetchJson(path, accessToken) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return { ok: false, status: res.status, body: await res.text().catch(() => "") };
  return { ok: true, status: res.status, data: await res.json() };
}

/**
 * Fin de la connexion OAuth : échange le `code`, lit l'identité Discord, vérifie l'accès (inscrit au projet Sérotine dans core_db ;
 * secours développement : rôle Discord), puis crée ou retrouve le profil dans la base privée (où l'on lit l'appartenance au comité).
 *
 * Renvoie { authorized: true, member } ou { authorized: false, reason }.
 */
export async function completeLogin(code) {
  const token = await exchangeCodeForToken(code);

  const userRes = await fetchJson("/users/@me", token.access_token);
  if (!userRes.ok) return { authorized: false, reason: "Could not fetch Discord profile." };
  const user = userRes.data; // { id, username, global_name, avatar, ... }

  let coreMember = null;
  let nick = null;
  if (coreDbEnabled()) {
    // Accès = inscrit au projet Sérotine dans l'annuaire de l'asso. Panne de l'annuaire → on refuse (échec fermé).
    try {
      coreMember = await findSerotineMemberByDiscordId(user.id);
    } catch (err) {
      console.error("core_db injoignable :", err.message);
      return { authorized: false, reason: "L'annuaire des membres est momentanément indisponible. Réessaie dans quelques minutes." };
    }
    if (!coreMember) return { authorized: false, reason: "Tu n'es pas inscrit·e au projet Sérotine dans l'annuaire de l'association." };
  } else {
    // Secours (développement, sans annuaire) : rôle Discord sur le serveur de l'équipe.
    const memberRes = await fetchJson(`/users/@me/guilds/${DISCORD_GUILD_ID}/member`, token.access_token);
    if (!memberRes.ok) return { authorized: false, reason: "You're not a member of the Sérotine Discord server." };
    const roles = Array.isArray(memberRes.data.roles) ? memberRes.data.roles : [];
    const roleId = await getSetting("discord_role_id");
    if (!roleId || !roles.includes(roleId)) return { authorized: false, reason: "You don't have the role required to access this app." };
    nick = memberRes.data.nick || null;
  }

  const member = await upsertMemberFromDiscord({
    coreMemberId: coreMember?.id ?? null,
    discordId: user.id,
    username: user.username,
    avatar: user.avatar,
    displayName: coreMember?.prenom || nick || user.global_name || user.username,
  });
  return { authorized: true, member };
}

async function upsertMemberFromDiscord({ coreMemberId, discordId, username, avatar, displayName }) {
  const existing = await db.prepare(`SELECT * FROM members WHERE discord_id = ?`).get(discordId);
  if (existing) {
    // Appartenance au comité de rédaction (`is_admin`) : lue dans la base privée, jamais modifiée par la connexion.
    await db.prepare(`UPDATE members SET discord_username = ?, discord_avatar = ?, core_member_id = COALESCE(?, core_member_id) WHERE id = ?`).run(
      username,
      avatar || "",
      coreMemberId,
      existing.id
    );
    return { ...existing, discord_username: username, discord_avatar: avatar || "", core_member_id: coreMemberId ?? existing.core_member_id };
  }
  // Nouvelle personne : pas au comité, sauf amorçage — si PERSONNE n'est encore au comité, la première connexion y entre, pour qu'il y ait
  // quelqu'un capable de désigner les autres (Administration → Membres).
  const anyCommittee = await db.prepare(`SELECT 1 AS x FROM members WHERE is_admin = 1 LIMIT 1`).get();
  const isAdmin = anyCommittee ? 0 : 1;
  const info = await db
    .prepare(
      `INSERT INTO members (discord_id, discord_username, discord_avatar, display_name, is_admin, core_member_id) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(discordId, username, avatar || "", displayName, isAdmin, coreMemberId);
  return db.prepare(`SELECT * FROM members WHERE id = ?`).get(info.lastInsertRowid);
}

// Tags de pôle (hors C2R, qui reste la colonne is_admin séparée) — voir server/db.js.
const POLE_ROLES = ["mise_en_page", "podcast", "communication"];
export function parseRoles(raw) {
  try {
    const arr = Array.isArray(raw) ? raw : JSON.parse(raw || "[]");
    return Array.isArray(arr) ? arr.filter((r) => POLE_ROLES.includes(r)) : [];
  } catch {
    return [];
  }
}

/** Shape stored in req.session.user — built at login, refreshed on every /api request
 * (see refreshSessionUser below) and again by POST /api/admin/impersonate. */
export function toSessionUser(m) {
  return {
    id: m.id,
    discordId: m.discord_id,
    displayName: m.display_name,
    avatar: m.discord_avatar,
    isAdmin: !!m.is_admin,
    isSuperAdmin: !!m.is_super_admin,
    roles: parseRoles(m.roles),
  };
}

/** Re-reads the signed-in member's row and refreshes req.session.user from it — so a tag change
 * (C2R, a pôle, super admin) made in Administration takes effect on this person's very next
 * request instead of requiring them to log out and back in. Cheap (primary-key lookup) and keeps
 * the session's rights fields honest: without this, requireAdmin/requireSuperAdmin below would
 * keep trusting a stale snapshot taken at login, so a change could look saved (it is, in the DB)
 * while doing nothing for the person who just made it. No-op if the row is gone (deleted member
 * mid-session) — leaves the stale session as is rather than guessing what to do about it. */
export async function refreshSessionUser(req) {
  if (!req.session?.user) return;
  const fresh = await db.prepare(`SELECT * FROM members WHERE id = ?`).get(req.session.user.id);
  if (fresh) req.session.user = toSessionUser(fresh);
}

/** Express middleware: 401s any /api route unless the session is logged in. */
export async function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Not logged in" });
  await refreshSessionUser(req);
  next();
}

/** Express middleware: 403s unless the logged-in member is an admin/C2R. */
export function requireAdmin(req, res, next) {
  if (req.session?.user?.isAdmin) return next();
  res.status(403).json({ error: "Admin (C2R) only" });
}

/** Express middleware: 403s unless the logged-in member is a super admin — a tier above C2R,
 * for the handful of actions sensitive enough that the whole committee shouldn't hold them by
 * default (the links/images at the top of each page, "se connecter en tant que"). */
export function requireSuperAdmin(req, res, next) {
  if (req.session?.user?.isSuperAdmin) return next();
  res.status(403).json({ error: "Super admin only" });
}

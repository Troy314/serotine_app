/**
 * index.js — REST API + Discord-OAuth2 login for the Sérotine project hub.
 *
 * Endpoints:
 *   GET  /auth/login                          redirect to Discord's OAuth2 consent screen
 *   GET  /auth/callback                        exchange code, check guild role, create/find the members row, log in
 *   GET  /auth/logout                          destroy the session
 *   GET  /auth/me                              current session's user + { configured, warning } for the Discord app setup
 *
 *   GET  /api/members                          list every member (id, discord fields, display_name, credit fields, is_admin)
 *   PATCH /api/members/me                      self-service: edit your own display_name + credit_* fields
 *   POST /api/members                          create a placeholder member (no discord_id yet) — for assigning an author who hasn't logged in
 *   PUT  /api/members/:id                      admin: edit any member's fields, including is_admin
 *   POST /api/members/:id/merge-into/:targetId admin: reassign every FK reference from :id to :targetId, delete :id
 *   DELETE /api/members/:id                    admin: delete a member (FKs referencing it null out)
 *
 *   GET  /api/topics                           thématique scientifique -> color list
 *   POST /api/topics                           admin: create
 *   PUT  /api/topics/:id                        admin: rename / recolor
 *   DELETE /api/topics/:id                       admin: delete
 *
 *   GET  /api/bohr/status-options?field=        editable vocab+color for a select field (or all, if no ?field=)
 *   POST /api/bohr/status-options                admin: add a new option
 *   PUT  /api/bohr/status-options/:id            admin: recolor / relabel / reorder
 *   DELETE /api/bohr/status-options/:id          admin: remove
 *
 *   GET  /api/bohr/articles?season=              list (resolved member names, relecture list, topic color)
 *   GET  /api/bohr/articles/:id                   single
 *   POST /api/bohr/articles                       create
 *   PUT  /api/bohr/articles/:id                    partial update (merge-before-validate); C2R-only fields silently ignored unless admin
 *   PUT  /api/bohr/articles/:id/relecture           replace the whole proofreader list { memberIds: [...] }
 *   DELETE /api/bohr/articles/:id                   delete
 *   POST /api/bohr/import-xlsm { fileBase64 }         admin: re-import an updated workbook, upserting by (season, subject)
 *
 *   GET  /api/com/posts?season=                    list (resolved linked article title, co-post member + their credit)
 *   GET  /api/com/posts/:id                          single
 *   POST /api/com/posts                              create
 *   PUT  /api/com/posts/:id                           partial update
 *   DELETE /api/com/posts/:id                         delete
 *
 *   GET  /api/settings                                all key/values (ICS url, minutes link, Canva/Heyzine/Fedica/podcast/site links) — secrets excluded, see SECRET_SETTINGS
 *   PUT  /api/settings                                admin: bulk-set { key: value, ... } (only known keys)
 *
 *   GET  /api/newsletter/brevo                          admin: { connected, senderName, senderEmail } — never the API key itself
 *   PUT  /api/newsletter/brevo                          admin: set { apiKey?, senderName?, senderEmail? } — blank apiKey keeps the existing one
 *   DELETE /api/newsletter/brevo                        admin: disconnect (deletes the stored key)
 *   POST /api/newsletter/send-test                      admin: { to, subject, html } — one test send via Brevo
 *   POST /api/newsletter/send                            admin: { recipients: [...], subject, html } — individual sends (not one multi-recipient email)
 *
 *   GET  /api/links/:section                          editable link list for documents_technique | podcast
 *   POST /api/links/:section                          admin: add one
 *   PUT  /api/links/:id                               admin: edit one
 *   DELETE /api/links/:id                              admin: remove one
 *
 *   GET  /api/events                                   upcoming events from the subscribed ICS url (cached 5 min)
 *   GET  /api/stats/brevo                              admin, PROTOTYPE: stats of sent Brevo email campaigns (official API, key stays server-side)
 *   GET  /api/instagram                                admin: { connected, username, expiresAt } — never the token
 *   PUT  /api/instagram { token }                        admin: verify (GET /me) then store the Instagram access token
 *   DELETE /api/instagram                                admin: forget the token
 *   POST /api/instagram/refresh                          admin: renew the long-lived token (+60 days)
 *   GET  /api/stats/instagram                            admin, PROTOTYPE: account + latest posts with insights (official Instagram API, read-only)
 *   GET  /api/documents/collective                      pages of the Nextcloud Collective (WebDAV, metadata only), newest first, for the right pane (cached 5 min)
 *
 *   GET  /api/maintenance/backups                       admin: list DB snapshots (pg_dump) in data/backups/
 *   POST /api/maintenance/backups                       admin: take one now
 *   POST /api/maintenance/backups/:name/restore           admin: restore the live DB from a named backup (pg_restore, pre-restore snapshot taken first)
 */
import "dotenv/config";
import express from "express";
import "express-async-errors"; // Express 4 : une erreur dans un handler async part au gestionnaire d'erreurs au lieu de bloquer la requête
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import helmet from "helmet";
import compression from "compression";
import { rateLimit } from "express-rate-limit";

import db, { pool, runStartupBackupIfNeeded, createBackupNow, listBackups, restoreBackup } from "./db.js";
import { authStatus, buildAuthorizeUrl, newState, completeLogin, requireAuth, requireAdmin, requireSuperAdmin, refreshSessionUser, toSessionUser, parseRoles } from "./auth.js";
import { coreDbEnabled, listSerotineMembers, activeDiscordIds, isActiveMember } from "./coredb.js";
import { fetchUpcomingEvents } from "./ics.js";
import { fetchBrevoCampaigns } from "./brevo-stats.js";
import { fetchInstagramStats, checkInstagramToken, refreshInstagramToken } from "./instagram-stats.js";
import { parseBohrWorkbook, readWorkbookFromBuffer } from "./bohr-parser.js";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(here, "..");
const PORT = process.env.PORT || 3101;

const app = express();

// Derrière le tunnel Cloudflare (HTTPS terminé en amont) : sans ça `secure: "auto"` ne poserait jamais le cookie.
if (process.env.BEHIND_HTTPS_PROXY === "1") app.set("trust proxy", 1);

// Security headers (clickjacking/MIME-sniffing/etc. protection), now with
// a real CSP tuned against what this app actually loads — worked out by
// auditing every external/inline resource the built app references,
// not guessed:
//   - script-src 'self' only — the whole app is one bundled JS file, no
//     inline <script> and nothing from a CDN (Font Awesome is the npm
//     package, bundled locally, not loaded from its own CDN).
//   - style-src needs 'unsafe-inline' — React's `style={{...}}` prop
//     (used throughout this codebase — BohrBoard, ComPlan, DonutChart's
//     SVG, etc.) compiles to real inline `style="..."` attributes, and
//     there's no practical nonce/hash story for that without a much
//     larger refactor. This is a real, deliberate gap (inline-style
//     injection is a smaller attack surface than script injection, but
//     not zero) — documented here rather than silently shipped.
//   - img-src allows Discord's CDN (ProfileMenu.jsx's avatar images) and
//     data: (a handful of small inline placeholders).
//   - frame-src allows Canva (MiseEnPage's embed — admin-configured, but
//     scoped to Canva's real domains rather than left as `https:` wide
//     open) alongside 'self' (the newsletter builder, served from this
//     app's own /tools/).
//   - connect-src is just 'self' — every fetch this app's client makes is
//     same-origin; third-party calls (ICS, Nominatim-equivalents, Steam/
//     PSN-style APIs) don't exist here — Discord OAuth and the ICS fetch
//     both happen server-side, never from the browser.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'", "data:", "https://cdn.discordapp.com"],
        connectSrc: ["'self'"],
        frameSrc: ["'self'", "https://www.canva.com", "https://*.canva.com"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
  })
);
app.use(compression());

// Default 100kb limit is too small for an uploaded workbook (base64-
// encoded in the request body), but there's no reason every *other*
// route should accept a 20mb body too. Registering a path-scoped parser
// with its own limit *before* the global one gives just this one route a
// bigger ceiling — express.json() checks `req._body` and no-ops if a
// body's already been parsed, so the global 1mb parser below correctly
// skips re-parsing (and re-checking its own smaller limit against) a
// request this one already handled.
app.use("/api/bohr/import-xlsm", express.json({ limit: "20mb" }));
app.use(express.json({ limit: "1mb" }));

// A small guard against automated login/callback abuse — generous enough
// to never bother a real person logging in a few times in a row.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use("/auth/login", authLimiter);
app.use("/auth/callback", authLimiter);
// A looser guard on the API as a whole — this app's own UI can
// legitimately fire many quick PATCH calls (typing in a table cell,
// dragging kanban cards), so this is sized to never get in the way of
// real use, just automated hammering.
app.use("/api", rateLimit({ windowMs: 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

app.use(
  session({
    // Sessions en base (table `session`, créée au besoin) : un redémarrage du conteneur ne déconnecte plus personne.
    store: new (connectPgSimple(session))({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "dev-only-insecure-secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 4, // 4 h, absolue (pas de prolongation) : borne le temps pendant lequel quelqu'un sorti du projet Sérotine reste connecté·e
      httpOnly: true, // no client-side JS access to the session cookie
      sameSite: "lax", // sent on normal navigation/GET, not on a cross-site POST — real CSRF mitigation for free
      secure: "auto", // only requires HTTPS when the request actually arrived over HTTPS (respects a reverse proxy's X-Forwarded-Proto if `app.set("trust proxy", ...)` is configured)
    },
  })
);

// ---------------------------------------------------------------- helpers

// parseRoles / toSessionUser live in auth.js now (imported above) — refreshSessionUser needs
// them too, and requireAuth refreshes req.session.user on every /api request from there.

function toMemberSummary(m) {
  if (!m) return null;
  return {
    id: m.id,
    discordId: m.discord_id,
    discordUsername: m.discord_username,
    discordAvatar: m.discord_avatar,
    displayName: m.display_name,
    legacyAliases: JSON.parse(m.legacy_aliases || "[]"),
    creditLinkedin: m.credit_linkedin,
    creditInstagram: m.credit_instagram,
    creditBluesky: m.credit_bluesky,
    collabInstagram: !!m.collab_instagram,
    isAdmin: !!m.is_admin,
    isSuperAdmin: !!m.is_super_admin,
    roles: parseRoles(m.roles),
    // false = n'est plus inscrit·e au projet Sérotine : son nom reste sur ses anciens articles, mais on ne peut plus le·la désigner (voir assertMembersActive).
    active: m._active !== false,
    // Archivé·e à la main par le C2R (Administration → Membres) : même effet que « plus au projet » (plus désignable), sans toucher à l'annuaire.
    archived: !!m.archived,
  };
}

async function memberById(id) {
  if (!id) return null;
  const row = await db.prepare(`SELECT * FROM members WHERE id = ?`).get(id);
  if (row) row._active = isActiveMember(row, await activeDiscordIds());
  return row;
}

/**
 * Tables de correspondance chargées UNE fois par requête (au lieu de ~8 requêtes SQL par article ou par post) :
 * membres par id, couleur des thématiques, relecteurs par article, titres d'articles. Ce sont de petites tables
 * (quelques dizaines de lignes) ; la liste des articles passe de ~200 requêtes à 4.
 */
async function loadLookups({ articles = false } = {}) {
  const [members, topics, relecture, subjects] = await Promise.all([
    db.prepare(`SELECT * FROM members`).all(),
    db.prepare(`SELECT name, color FROM topics`).all(),
    db.prepare(`SELECT article_id, member_id FROM bohr_article_relecture ORDER BY article_id, member_id`).all(),
    articles ? db.prepare(`SELECT id, subject, season, issue_label FROM bohr_articles`).all() : [],
  ]);
  const activeSet = await activeDiscordIds();
  for (const m of members) m._active = isActiveMember(m, activeSet);
  const memberMap = new Map(members.map((m) => [m.id, m]));
  const relectureMap = new Map();
  for (const r of relecture) {
    if (!relectureMap.has(r.article_id)) relectureMap.set(r.article_id, []);
    relectureMap.get(r.article_id).push(memberMap.get(r.member_id));
  }
  return {
    member: (id) => (id ? memberMap.get(id) || null : null),
    topicColor: new Map(topics.map((t) => [t.name, t.color])),
    relecture: (articleId) => (relectureMap.get(articleId) || []).filter(Boolean),
    article: new Map(subjects.map((a) => [a.id, a])),
  };
}

// ---------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------

app.get("/auth/login", async (req, res) => {
  const status = await authStatus();
  if (!status.configured) return res.status(500).send(`Discord app not configured. ${status.warning}`);
  const state = newState();
  req.session.oauthState = state;
  res.redirect(buildAuthorizeUrl(state));
});

app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== req.session.oauthState) {
    return res.status(400).send("Invalid or expired login attempt. Go back and try again.");
  }
  delete req.session.oauthState;
  try {
    const result = await completeLogin(code);
    if (!result.authorized) {
      return res.status(403).send(`Access denied: ${result.reason}`);
    }
    req.session.user = toSessionUser(result.member);
    res.redirect("/");
  } catch (err) {
    console.error(err);
    res.status(500).send("Login failed. Check the server logs.");
  }
});

app.get("/auth/logout", async (req, res) => {
  req.session.destroy(() => res.redirect("/"));
});

app.get("/auth/me", async (req, res) => {
  // Refreshed from the DB (not just the snapshot taken at login) — so a tag change (C2R, a pôle,
  // super admin) made in Administration shows up here, and in the nav it drives, right away.
  await refreshSessionUser(req);
  res.json({
    user: req.session.user || null,
    // Minimal — just enough for the UI to show "navigating as X (really: Y)" and a way back.
    impersonating: req.session.realUser ? { realUserDisplayName: req.session.realUser.displayName } : null,
    ...(await authStatus()),
  });
});

// Everything under /api requires a logged-in, role-gated session.
app.use("/api", requireAuth);

// ---------------------------------------------------------------------
// Members / Credits
// ---------------------------------------------------------------------

app.get("/api/members", async (req, res) => {
  const rows = await db.prepare(`SELECT * FROM members ORDER BY lower(display_name)`).all();
  const activeSet = await activeDiscordIds();
  for (const m of rows) m._active = isActiveMember(m, activeSet);
  res.json(rows.map(toMemberSummary));
});

// Admin : compare les profils locaux et l'annuaire de l'asso (membres du projet Sérotine, par discord_id).
// Sert à repérer qui sera refusé·e à la connexion (profil local sans rattachement au projet) et qui n'a pas encore de profil.
app.get("/api/members/core-sync", requireAdmin, async (req, res) => {
  if (!coreDbEnabled()) return res.json({ enabled: false });
  let core;
  try {
    core = await listSerotineMembers();
  } catch (err) {
    console.error("core-sync :", err.message);
    return res.status(502).json({ enabled: true, error: "L'annuaire des membres (core_db) est injoignable." });
  }
  const local = await db.prepare(`SELECT id, display_name, discord_id, core_member_id FROM members`).all();
  const coreIds = new Set(core.map((c) => String(c.discord_id)));
  const localIds = new Set(local.filter((m) => m.discord_id).map((m) => String(m.discord_id)));
  res.json({
    enabled: true,
    // profil local avec Discord, absent du projet Sérotine : ne pourra plus se connecter
    localNotInProject: local.filter((m) => m.discord_id && !coreIds.has(String(m.discord_id))).map((m) => ({ id: m.id, displayName: m.display_name })),
    // membre du projet sans profil local : aura un profil créé à sa première connexion
    projectNotYetLocal: core.filter((c) => c.discord_id && !localIds.has(String(c.discord_id))).map((c) => ({ prenom: c.prenom, pseudoDiscord: c.pseudo_discord })),
    // profils locaux sans Discord ID (placeholders d'import)
    localWithoutDiscord: local.filter((m) => !m.discord_id).length,
  });
});

// Admin : crée un profil local pour chaque membre du projet Sérotine qui n'en a pas encore (sans attendre sa première connexion).
// Jamais de retrait ni de modification d'un profil existant — seulement des ajouts, comme le bouton équivalent d'AurorAgendAlpes.
app.post("/api/members/core-sync/import", requireAdmin, async (req, res) => {
  if (!coreDbEnabled()) return res.status(400).json({ error: "Annuaire core_db non configuré." });
  let core;
  try {
    core = await listSerotineMembers();
  } catch (err) {
    console.error("core-sync/import :", err.message);
    return res.status(502).json({ error: "L'annuaire des membres (core_db) est injoignable." });
  }
  const local = await db.prepare(`SELECT discord_id FROM members`).all();
  const localIds = new Set(local.filter((m) => m.discord_id).map((m) => String(m.discord_id)));
  const toCreate = core.filter((c) => c.discord_id && !localIds.has(String(c.discord_id)));
  const created = [];
  for (const c of toCreate) {
    const info = await db
      .prepare(`INSERT INTO members (discord_id, display_name, is_admin, core_member_id) VALUES (?, ?, 0, ?)`)
      .run(String(c.discord_id), c.prenom, c.id);
    created.push({ id: info.lastInsertRowid, displayName: c.prenom });
  }
  res.json({ created });
});

app.patch("/api/members/me", async (req, res) => {
  const id = req.session.user.id;
  const existing = await memberById(id);
  if (!existing) return res.status(404).json({ error: "Member not found" });
  const b = req.body || {};
  await db.prepare(
    `UPDATE members SET display_name = ?, credit_linkedin = ?, credit_instagram = ?, credit_bluesky = ? WHERE id = ?`
  ).run(
    b.displayName ?? existing.display_name,
    b.creditLinkedin ?? existing.credit_linkedin,
    b.creditInstagram ?? existing.credit_instagram,
    b.creditBluesky ?? existing.credit_bluesky,
    id
  );
  res.json(toMemberSummary(await memberById(id)));
});

app.post("/api/members", async (req, res) => {
  const b = req.body || {};
  if (!b.displayName?.trim()) return res.status(400).json({ error: "displayName is required" });
  const info = await db.prepare(`INSERT INTO members (display_name) VALUES (?)`).run(b.displayName.trim());
  res.status(201).json(toMemberSummary(await memberById(info.lastInsertRowid)));
});

app.put("/api/members/:id", requireAdmin, async (req, res) => {
  const existing = await memberById(req.params.id);
  if (!existing) return res.status(404).json({ error: "Member not found" });
  const b = req.body || {};
  // Lets an admin link (or unlink) a member's Discord ID directly, without
  // waiting for that person to log in themselves — the more proactive
  // counterpart to merge-into (below), which only works once a real login
  // has already created the target member. A blank string means "unlink",
  // not "store an empty string" — discord_id is nullable and UNIQUE, so
  // two members both holding "" would collide on that constraint.
  const nextDiscordId = b.discordId === undefined ? existing.discord_id : b.discordId?.trim() || null;
  const nextRoles = b.roles !== undefined ? JSON.stringify(parseRoles(b.roles)) : existing.roles;
  // Only an existing super admin can grant or revoke super admin — otherwise any C2R member could
  // hand themselves the higher tier through this same endpoint, defeating the point of having one.
  // Bootstrap exception: while nobody holds it yet, any C2R member can grant the very first one
  // (same reasoning as is_admin's own first-login bootstrap in auth.js).
  if (b.isSuperAdmin !== undefined && !!b.isSuperAdmin !== !!existing.is_super_admin && !req.session.user.isSuperAdmin) {
    const anySuperAdmin = await db.prepare(`SELECT 1 AS x FROM members WHERE is_super_admin = 1 LIMIT 1`).get();
    if (anySuperAdmin || !b.isSuperAdmin) return res.status(403).json({ error: "Super admin only" });
  }
  let nextIsAdmin = b.isAdmin !== undefined ? (b.isAdmin ? 1 : 0) : existing.is_admin;
  let nextIsSuperAdmin = b.isSuperAdmin !== undefined ? (b.isSuperAdmin ? 1 : 0) : existing.is_super_admin;
  if (nextIsSuperAdmin) nextIsAdmin = 1; // super admin implique C2R
  if (!nextIsAdmin) nextIsSuperAdmin = 0; // pas de super admin sans C2R
  try {
    await db.prepare(
      `UPDATE members SET display_name = ?, discord_id = ?, credit_linkedin = ?, credit_instagram = ?, credit_bluesky = ?, collab_instagram = ?, is_admin = ?, is_super_admin = ?, roles = ?, archived = ? WHERE id = ?`
    ).run(
      b.displayName ?? existing.display_name,
      nextDiscordId,
      b.creditLinkedin ?? existing.credit_linkedin,
      b.creditInstagram ?? existing.credit_instagram,
      b.creditBluesky ?? existing.credit_bluesky,
      b.collabInstagram !== undefined ? (b.collabInstagram ? 1 : 0) : existing.collab_instagram,
      nextIsAdmin,
      nextIsSuperAdmin,
      nextRoles,
      b.archived !== undefined ? (b.archived ? 1 : 0) : existing.archived,
      req.params.id
    );
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: "This Discord ID is already linked to another member." });
    }
    throw err;
  }
  res.json(toMemberSummary(await memberById(req.params.id)));
});

// Reassigns every FK reference from one member to another, then deletes
// the source — how a legacy placeholder ("Hector", no discord_id) gets
// folded into the real Discord-linked member once they've logged in.
app.post("/api/members/:id/merge-into/:targetId", requireAdmin, async (req, res) => {
  const { id, targetId } = req.params;
  if (id === targetId) return res.status(400).json({ error: "Can't merge a member into itself" });
  const source = await memberById(id);
  const target = await memberById(targetId);
  if (!source || !target) return res.status(404).json({ error: "Member not found" });

  const merge = db.transaction(async () => {
    for (const col of ["author_id", "correction_id", "source_id", "enregistrement_id", "montage_id", "mise_en_page_id", "illustration_id", "communication_id"]) {
      await db.prepare(`UPDATE bohr_articles SET ${col} = ? WHERE ${col} = ?`).run(targetId, id);
    }
    await db.prepare(`UPDATE com_posts SET co_post_member_id = ? WHERE co_post_member_id = ?`).run(targetId, id);
    // Relecture is a PK(article_id, member_id) join table — reassigning
    // could collide with a row that already has the target on the same
    // article, so insert-or-ignore then drop the old rows.
    const relecture = await db.prepare(`SELECT article_id FROM bohr_article_relecture WHERE member_id = ?`).all(id);
    const insertRelecture = await db.prepare(
      `INSERT OR IGNORE INTO bohr_article_relecture (article_id, member_id) VALUES (?, ?)`
    );
    for (const r of relecture) await insertRelecture.run(r.article_id, targetId);
    await db.prepare(`DELETE FROM bohr_article_relecture WHERE member_id = ?`).run(id);

    // Delete the source row *before* copying its data onto the target —
    // discord_id is UNIQUE, so if both rows briefly held the same value
    // (source still has it, target about to receive it) the UPDATE below
    // would fail the constraint outright. Caught by actually running a
    // real merge with a discord_id set on the source, not just reasoning
    // through it: SqliteError: UNIQUE constraint failed: members.discord_id.
    await db.prepare(`DELETE FROM members WHERE id = ?`).run(id);

    // Fill in whatever the *surviving* member is missing from the one
    // just deleted, rather than silently discarding it — a real bug
    // caught after shipping: merging in the "wrong" direction (a
    // filled-in member absorbed into an empty placeholder, easy to do
    // since the UI's "merge THIS row into the selected one" phrasing
    // reads ambiguously either way) used to permanently lose the deleted
    // row's credit_* fields and Discord link, since only FK *references*
    // to it were reassigned — the member row's own data just vanished
    // with it. Never overwrites something the target already has.
    const fillIfBlank = {};
    if (!target.discord_id && source.discord_id) fillIfBlank.discord_id = source.discord_id;
    if (!target.credit_linkedin && source.credit_linkedin) fillIfBlank.credit_linkedin = source.credit_linkedin;
    if (!target.credit_instagram && source.credit_instagram) fillIfBlank.credit_instagram = source.credit_instagram;
    if (!target.credit_bluesky && source.credit_bluesky) fillIfBlank.credit_bluesky = source.credit_bluesky;
    if (!target.collab_instagram && source.collab_instagram) fillIfBlank.collab_instagram = source.collab_instagram;
    const fillCols = Object.keys(fillIfBlank);
    if (fillCols.length) {
      await db.prepare(`UPDATE members SET ${fillCols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).run(
        ...fillCols.map((c) => fillIfBlank[c]),
        targetId
      );
    }
  });
  await merge();
  res.json(toMemberSummary(await memberById(targetId)));
});

app.delete("/api/members/:id", requireAdmin, async (req, res) => {
  await db.prepare(`DELETE FROM members WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

// ---------------------------------------------------------------------
// "Se connecter en tant que" — super admin only. The session's real identity
// is kept under req.session.realUser while impersonating ; every /api check
// during that time reads the IMPERSONATED identity (req.session.user), never
// the real one — impersonating someone isn't a way to gain their rights, only
// to see what they see. See server/auth.js requireSuperAdmin.
// ---------------------------------------------------------------------

app.get("/api/admin/impersonatable", requireSuperAdmin, async (req, res) => {
  const rows = await db.prepare(`SELECT id, display_name FROM members WHERE id != ? ORDER BY lower(display_name)`).all(req.session.user.id);
  res.json(rows.map((m) => ({ id: m.id, displayName: m.display_name })));
});

app.post("/api/admin/impersonate/:id", requireSuperAdmin, async (req, res) => {
  if (req.session.realUser) return res.status(409).json({ error: "Already impersonating — stop first." });
  if (String(req.params.id) === String(req.session.user.id)) return res.status(400).json({ error: "Can't impersonate yourself." });
  const target = await memberById(req.params.id);
  if (!target) return res.status(404).json({ error: "Member not found" });
  const log = await db.prepare(`INSERT INTO impersonation_log (admin_id, target_id) VALUES (?, ?)`).run(req.session.user.id, target.id);
  req.session.realUser = req.session.user;
  req.session.impersonationLogId = log.lastInsertRowid;
  req.session.user = toSessionUser(target);
  res.json({ user: req.session.user });
});

app.post("/api/admin/stop-impersonating", async (req, res) => {
  if (!req.session.realUser) return res.status(400).json({ error: "Not impersonating." });
  if (req.session.impersonationLogId) {
    await db.prepare(`UPDATE impersonation_log SET ended_at = to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?`).run(req.session.impersonationLogId);
  }
  req.session.user = req.session.realUser;
  delete req.session.realUser;
  delete req.session.impersonationLogId;
  res.json({ user: req.session.user });
});

// Audit trail — super admin only, read-only.
app.get("/api/admin/impersonation-log", requireSuperAdmin, async (req, res) => {
  const rows = await db.prepare(
    `SELECT l.id, l.started_at, l.ended_at, a.display_name AS admin_name, t.display_name AS target_name
     FROM impersonation_log l
     JOIN members a ON a.id = l.admin_id
     JOIN members t ON t.id = l.target_id
     ORDER BY l.started_at DESC LIMIT 100`
  ).all();
  res.json(rows);
});

// ---------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------

app.get("/api/topics", async (req, res) => {
  res.json(await db.prepare(`SELECT * FROM topics ORDER BY lower(name)`).all());
});

app.post("/api/topics", requireAdmin, async (req, res) => {
  const { name, color } = req.body || {};
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  try {
    const info = await db
      .prepare(`INSERT INTO topics (name, color) VALUES (?, ?)`)
      .run(name.trim(), color || "#435c6e");
    res.status(201).json(await db.prepare(`SELECT * FROM topics WHERE id = ?`).get(info.lastInsertRowid));
  } catch {
    res.status(409).json({ error: "A topic with that name already exists" });
  }
});

app.put("/api/topics/:id", requireAdmin, async (req, res) => {
  const existing = await db.prepare(`SELECT * FROM topics WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Topic not found" });
  const { name, color } = req.body || {};
  await db.prepare(`UPDATE topics SET name = ?, color = ? WHERE id = ?`).run(
    name ?? existing.name,
    color ?? existing.color,
    req.params.id
  );
  res.json(await db.prepare(`SELECT * FROM topics WHERE id = ?`).get(req.params.id));
});

app.delete("/api/topics/:id", requireAdmin, async (req, res) => {
  await db.prepare(`DELETE FROM topics WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

// ---------------------------------------------------------------------
// Bohr status options
// ---------------------------------------------------------------------

app.get("/api/bohr/status-options", async (req, res) => {
  const { field } = req.query;
  const rows = field
    ? await db.prepare(`SELECT * FROM bohr_status_options WHERE field = ? ORDER BY sort_order`).all(field)
    : await db.prepare(`SELECT * FROM bohr_status_options ORDER BY field, sort_order`).all();
  res.json(rows);
});

app.post("/api/bohr/status-options", requireAdmin, async (req, res) => {
  const { field, value, color } = req.body || {};
  if (!field || !value) return res.status(400).json({ error: "field and value are required" });
  const maxOrder =
    (await db.prepare(`SELECT MAX(sort_order) AS m FROM bohr_status_options WHERE field = ?`).get(field))?.m ?? -1;
  try {
    const info = await db
      .prepare(`INSERT INTO bohr_status_options (field, value, color, sort_order) VALUES (?, ?, ?, ?)`)
      .run(field, value, color || "#9aa5b1", maxOrder + 1);
    res.status(201).json(await db.prepare(`SELECT * FROM bohr_status_options WHERE id = ?`).get(info.lastInsertRowid));
  } catch {
    res.status(409).json({ error: "That value already exists for this field" });
  }
});

app.put("/api/bohr/status-options/:id", requireAdmin, async (req, res) => {
  const existing = await db.prepare(`SELECT * FROM bohr_status_options WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  await db.prepare(`UPDATE bohr_status_options SET value = ?, color = ?, sort_order = ? WHERE id = ?`).run(
    b.value ?? existing.value,
    b.color ?? existing.color,
    b.sortOrder ?? existing.sort_order,
    req.params.id
  );
  res.json(await db.prepare(`SELECT * FROM bohr_status_options WHERE id = ?`).get(req.params.id));
});

app.delete("/api/bohr/status-options/:id", requireAdmin, async (req, res) => {
  await db.prepare(`DELETE FROM bohr_status_options WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

// ---------------------------------------------------------------------
// Tableau de Bohr articles
// ---------------------------------------------------------------------

// Fields only the C2R (admin) can set — mirrors the spreadsheet's grey,
// "modifiable only by C2R" cells. A non-admin PUT silently keeps whatever
// these already were, rather than 403ing the whole request — so a
// contributor can still update their own subject/topic/concept/état
// rédaction in the same call.
const C2R_ONLY_FIELDS = [
  "ligneEditoriale",
  "comiteSci",
  "etatMiseEnPage",
  "illustrations",
  "pages",
  "etatAudio",
  "isCover",
  // Which issue an article is "cut into" — the real spreadsheet's column A
  // (issue label) also carried the grey C2R-only fill, confirmed by
  // inspecting the source file's cell formatting directly before adding
  // these. Client-side this is BohrBoard's admin-mode-gated "Numéro"
  // assignment select.
  "issueLabel",
  "issueMonth",
  "issueOrder",
  // correctionId/sourceId/enregistrementId/montageId were here too until
  // this was changed to match how relecture already worked: any logged-in
  // user can claim (or drop) one of these roles for *themselves* — see
  // BohrBoard.jsx's SingleAssignQuickJoin. Only actually reassigning one
  // *away from* someone else, or onto someone else, still needs admin
  // mode — but that restriction lives entirely in the client UI, same as
  // relecture's self-toggle-only convention; nothing here stops a direct
  // API call from setting any of the four to anyone.
];

async function articleRowToApi(row, L) {
  L = L || (await loadLookups());
  const author = L.member(row.author_id);
  const correction = L.member(row.correction_id);
  const source = L.member(row.source_id);
  const enregistrement = L.member(row.enregistrement_id);
  const montage = L.member(row.montage_id);
  const miseEnPage = L.member(row.mise_en_page_id);
  const illustration = L.member(row.illustration_id);
  const communication = L.member(row.communication_id);
  const relecture = L.relecture(row.id);
  return {
    id: row.id,
    season: row.season,
    issueLabel: row.issue_label,
    issueMonth: row.issue_month,
    issueOrder: row.issue_order,
    rowOrder: row.row_order,
    subject: row.subject,
    subjectUrl: row.subject_url,
    discordThreadUrl: row.discord_thread_url,
    topic: row.topic,
    topicColor: L.topicColor.get(row.topic) || null,
    author: toMemberSummary(author),
    concept: row.concept,
    etatRedaction: row.etat_redaction,
    ligneEditoriale: !!row.ligne_editoriale,
    correction: toMemberSummary(correction),
    source: toMemberSummary(source),
    correctionValide: !!row.correction_valide,
    correctionValidePar: toMemberSummary(L.member(row.correction_valide_par)),
    sourceValide: !!row.source_valide,
    sourceValidePar: toMemberSummary(L.member(row.source_valide_par)),
    comiteSci: !!row.comite_sci,
    etatMiseEnPage: row.etat_mise_en_page,
    illustrations: row.illustrations,
    pages: row.pages,
    etatAudio: row.etat_audio,
    podcastUrl: row.podcast_url,
    enregistrement: toMemberSummary(enregistrement),
    montage: toMemberSummary(montage),
    miseEnPage: toMemberSummary(miseEnPage),
    illustration: toMemberSummary(illustration),
    communication: toMemberSummary(communication),
    communicationRs: row.communication_rs,
    isCover: !!row.is_cover,
    notes: row.notes,
    relecture: relecture.map(toMemberSummary),
    updatedBy: toMemberSummary(L.member(row.updated_by)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ARTICLE_COLUMN_MAP = {
  season: "season",
  issueLabel: "issue_label",
  issueMonth: "issue_month",
  issueOrder: "issue_order",
  rowOrder: "row_order",
  subject: "subject",
  subjectUrl: "subject_url",
  discordThreadUrl: "discord_thread_url",
  topic: "topic",
  authorId: "author_id",
  concept: "concept",
  etatRedaction: "etat_redaction",
  ligneEditoriale: "ligne_editoriale",
  correctionId: "correction_id",
  sourceId: "source_id",
  comiteSci: "comite_sci",
  etatMiseEnPage: "etat_mise_en_page",
  illustrations: "illustrations",
  pages: "pages",
  etatAudio: "etat_audio",
  podcastUrl: "podcast_url",
  enregistrementId: "enregistrement_id",
  montageId: "montage_id",
  miseEnPageId: "mise_en_page_id",
  illustrationId: "illustration_id",
  communicationId: "communication_id",
  communicationRs: "communication_rs",
  isCover: "is_cover",
  notes: "notes",
};
const BOOL_FIELDS = new Set(["ligneEditoriale", "comiteSci", "isCover"]);

app.get("/api/bohr/articles", async (req, res) => {
  const { season } = req.query;
  const rows = season
    ? await db
        .prepare(`SELECT * FROM bohr_articles WHERE season = ? ORDER BY issue_order, row_order`)
        .all(season)
    : await db.prepare(`SELECT * FROM bohr_articles ORDER BY season, issue_order, row_order`).all();
  const L = await loadLookups();
  res.json(await Promise.all(rows.map((r) => articleRowToApi(r, L))));
});

app.get("/api/bohr/articles/:id", async (req, res) => {
  const row = await db.prepare(`SELECT * FROM bohr_articles WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(await articleRowToApi(row));
});

// Une personne qui n'est plus inscrite au projet Sérotine garde son nom sur ses anciens articles (rien n'est effacé, rien ne casse),
// mais on ne peut plus la DÉSIGNER : ni auteur·ice, ni responsable, ni relecteur·ice, ni co-post. Seules les NOUVELLES désignations sont
// refusées : un article qui la portait déjà reste modifiable (son nom est conservé quand on renvoie la même valeur).
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
async function assertMembersActive(ids) {
  const wanted = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (wanted.length === 0) return;
  const activeSet = await activeDiscordIds(); // null = annuaire inconnu : seul l'archivage manuel compte alors
  const rows = await db.prepare(`SELECT id, display_name, discord_id, archived FROM members WHERE id IN (${wanted.map(() => "?").join(",")})`).all(...wanted);
  const gone = rows.filter((m) => !isActiveMember(m, activeSet));
  if (gone.length) {
    throw new HttpError(400, `${gone.map((m) => m.display_name).join(", ")} n'est plus au projet Sérotine (parti·e ou archivé·e) : on ne peut plus ${gone.length > 1 ? "les" : "le·la"} désigner (les anciens articles gardent ${gone.length > 1 ? "leurs noms" : "son nom"}).`);
  }
}
const ARTICLE_MEMBER_COLUMNS = {
  authorId: "author_id", correctionId: "correction_id", sourceId: "source_id", enregistrementId: "enregistrement_id",
  montageId: "montage_id", miseEnPageId: "mise_en_page_id", illustrationId: "illustration_id", communicationId: "communication_id",
};
async function assertArticleAssignmentsActive(body, existing = {}) {
  const added = [];
  for (const [key, col] of Object.entries(ARTICLE_MEMBER_COLUMNS)) {
    if (body[key] != null && Number(body[key]) !== existing[col]) added.push(body[key]);
  }
  await assertMembersActive(added);
}

app.post("/api/bohr/articles", async (req, res) => {
  await assertArticleAssignmentsActive(req.body || {});
  const info = await db.prepare(`INSERT INTO bohr_articles (subject) VALUES (?)`).run(req.body?.subject || "Nouveau sujet");
  await applyArticleUpdate(info.lastInsertRowid, req.body || {}, req.session.user.isAdmin, req.session.user.id);
  res.status(201).json(await articleRowToApi(await db.prepare(`SELECT * FROM bohr_articles WHERE id = ?`).get(info.lastInsertRowid)));
});

app.put("/api/bohr/articles/:id", async (req, res) => {
  const existing = await db.prepare(`SELECT * FROM bohr_articles WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  await assertArticleAssignmentsActive(req.body || {}, existing);
  await applyArticleUpdate(req.params.id, req.body || {}, req.session.user.isAdmin, req.session.user.id);
  res.json(await articleRowToApi(await db.prepare(`SELECT * FROM bohr_articles WHERE id = ?`).get(req.params.id)));
});

// `updatedBy` is lightweight "who touched this last" — not real-time
// presence (no websockets), just visibility so two people editing the
// same board have some idea someone else was just there.
async function applyArticleUpdate(id, body, isAdmin, updatedBy) {
  const existing = await db.prepare(`SELECT * FROM bohr_articles WHERE id = ?`).get(id);
  const sets = [];
  const values = [];
  for (const [apiKey, col] of Object.entries(ARTICLE_COLUMN_MAP)) {
    if (!(apiKey in body)) continue;
    if (!isAdmin && C2R_ONLY_FIELDS.includes(apiKey)) continue; // silently ignored, see C2R_ONLY_FIELDS
    let value = body[apiKey];
    if (BOOL_FIELDS.has(apiKey)) value = value ? 1 : 0;
    sets.push(`${col} = ?`);
    values.push(value);
  }
  // Validation Correction / Sources : ouverte à tout membre connecté ; on garde qui a (dé)coché.
  for (const [apiKey, col] of [["correctionValide", "correction_valide"], ["sourceValide", "source_valide"]]) {
    if (!(apiKey in body)) continue;
    const on = !!body[apiKey];
    sets.push(`${col} = ?`, `${col}_par = ?`);
    values.push(on ? 1 : 0, on ? updatedBy : null);
  }
  if (sets.length) {
    sets.push(`updated_at = datetime('now')`, `updated_by = ?`);
    values.push(updatedBy, id);
    await db.prepare(`UPDATE bohr_articles SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }
  return existing;
}

app.put("/api/bohr/articles/:id/relecture", async (req, res) => {
  const articleId = req.params.id;
  const existing = await db.prepare(`SELECT id FROM bohr_articles WHERE id = ?`).get(articleId);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const ids = Array.isArray(req.body?.memberIds) ? req.body.memberIds : [];
  const already = new Set((await db.prepare(`SELECT member_id FROM bohr_article_relecture WHERE article_id = ?`).all(articleId)).map((r) => r.member_id));
  await assertMembersActive(ids.filter((id) => !already.has(Number(id))));
  const replace = db.transaction(async () => {
    await db.prepare(`DELETE FROM bohr_article_relecture WHERE article_id = ?`).run(articleId);
    const insert = await db.prepare(`INSERT INTO bohr_article_relecture (article_id, member_id) VALUES (?, ?)`);
    for (const memberId of ids) await insert.run(articleId, memberId);
  });
  await replace();
  res.json(await articleRowToApi(await db.prepare(`SELECT * FROM bohr_articles WHERE id = ?`).get(articleId)));
});

app.delete("/api/bohr/articles/:id", async (req, res) => {
  await db.prepare(`DELETE FROM bohr_articles WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

// Resolves a legacy-sheet member name to a real members row, creating a
// placeholder (no discord_id) if it's never been seen before — same
// convention as import-legacy.js's own resolver, but with no cross-request
// cache (a single import request touches at most a few dozen names, and
// staleness across requests would be a real bug here, unlike the one-shot
// CLI script).
async function resolveMemberByNameLive(rawName) {
  if (rawName != null && typeof rawName !== "string") rawName = String(rawName);
  const name = (rawName || "").trim();
  if (!name || name === "/") return null;
  const existing = await db.prepare(`SELECT * FROM members WHERE display_name = ?`).get(name);
  if (existing) return existing;
  const info = await db
    .prepare(`INSERT INTO members (display_name, legacy_aliases) VALUES (?, ?)`)
    .run(name, JSON.stringify([name]));
  return await db.prepare(`SELECT * FROM members WHERE id = ?`).get(info.lastInsertRowid);
}

// Lets an admin re-import an updated Tableau de Bohr workbook (.xlsx or
// .xlsm — same OOXML format, read identically) at any time, not just the
// one-time migration `npm run import:legacy` covers — "for now", while
// some editing still happens in the spreadsheet in parallel with the app.
// Upserts by (season, subject) rather than blindly inserting: a matched
// article's Bohr-sourced fields (and its relecture set) are OVERWRITTEN
// from the sheet — the spreadsheet wins on a re-import, deliberately, so
// this only makes sense as an admin action (requireAdmin, not just
// admin-mode in the UI) and the client shows a clear warning before
// calling it.
app.post("/api/bohr/import-xlsm", requireAdmin, async (req, res) => {
  const { fileBase64 } = req.body || {};
  if (!fileBase64) return res.status(400).json({ error: "fileBase64 is required" });

  let rows;
  try {
    const buffer = Buffer.from(fileBase64, "base64");
    const wb = readWorkbookFromBuffer(buffer);
    rows = parseBohrWorkbook(wb);
  } catch (err) {
    return res.status(400).json({ error: `Could not read that file as a spreadsheet: ${err.message}` });
  }
  if (!rows.length) {
    return res.status(400).json({ error: "No 'Saison N' sheet with any real rows was found in that file." });
  }

  // Matching on (season, subject) alone was a real bug, caught by testing
  // against the actual file rather than trusting the design on paper: the
  // real workbook has legitimate duplicate generic titles across
  // different issues in the same season (Saison 2 has "Reportage photo"
  // in both #5 and #6) — that collapsed two distinct articles into one on
  // the very first import (27 created + 1 "update" instead of 28
  // created), silently discarding the earlier issue's row. Matching on
  // (season, issue_label, subject) instead keeps same-named articles in
  // different issues distinct while still correctly matching a re-import
  // of the same issue's same article.
  const findExisting = await db.prepare(
    `SELECT id FROM bohr_articles WHERE season = ? AND issue_label = ? AND lower(trim(subject)) = lower(trim(?))`
  );
  const insert = await db.prepare(`
    INSERT INTO bohr_articles (
      season, issue_label, issue_month, issue_order, row_order,
      subject, subject_url, topic, author_id, concept, etat_redaction,
      ligne_editoriale, correction_id, source_id, comite_sci,
      etat_mise_en_page, illustrations, pages, etat_audio,
      enregistrement_id, montage_id, communication_rs, notes
    ) VALUES (@season, @issue_label, @issue_month, @issue_order, @row_order,
      @subject, @subject_url, @topic, @author_id, @concept, @etat_redaction,
      @ligne_editoriale, @correction_id, @source_id, @comite_sci,
      @etat_mise_en_page, @illustrations, @pages, @etat_audio,
      @enregistrement_id, @montage_id, @communication_rs, '')
  `);
  const update = await db.prepare(`
    UPDATE bohr_articles SET
      issue_label = @issue_label, issue_month = @issue_month, issue_order = @issue_order,
      row_order = @row_order, subject_url = @subject_url, topic = @topic, author_id = @author_id,
      concept = @concept, etat_redaction = @etat_redaction, ligne_editoriale = @ligne_editoriale,
      correction_id = @correction_id, source_id = @source_id, comite_sci = @comite_sci,
      etat_mise_en_page = @etat_mise_en_page, illustrations = @illustrations, pages = @pages,
      etat_audio = @etat_audio, enregistrement_id = @enregistrement_id, montage_id = @montage_id,
      communication_rs = @communication_rs, updated_at = datetime('now')
    WHERE id = @id
  `);
  const clearRelecture = await db.prepare(`DELETE FROM bohr_article_relecture WHERE article_id = ?`);
  const insertRelecture = await db.prepare(
    `INSERT OR IGNORE INTO bohr_article_relecture (article_id, member_id) VALUES (?, ?)`
  );

  let created = 0;
  let updated = 0;
  const run = db.transaction(async () => {
    for (const r of rows) {
      const author = await resolveMemberByNameLive(r.authorName);
      const correction = await resolveMemberByNameLive(r.correctionName);
      const source = await resolveMemberByNameLive(r.sourceName);
      const enregistrement = await resolveMemberByNameLive(r.enregistrementName);
      const montage = await resolveMemberByNameLive(r.montageName);

      const params = {
        season: r.season,
        issue_label: r.issueLabel,
        issue_month: r.issueMonth,
        issue_order: r.issueOrder,
        row_order: r.rowOrder,
        subject: r.subject,
        subject_url: r.subjectUrl,
        topic: r.topic,
        author_id: author?.id ?? null,
        concept: r.concept,
        etat_redaction: r.etatRedaction,
        ligne_editoriale: r.ligneEditoriale ? 1 : 0,
        correction_id: correction?.id ?? null,
        source_id: source?.id ?? null,
        comite_sci: r.comiteSci ? 1 : 0,
        etat_mise_en_page: r.etatMiseEnPage,
        illustrations: r.illustrations,
        pages: r.pages,
        etat_audio: r.etatAudio,
        enregistrement_id: enregistrement?.id ?? null,
        montage_id: montage?.id ?? null,
        communication_rs: r.communicationRs,
      };

      const existing = await findExisting.get(r.season, r.issueLabel, r.subject);
      let articleId;
      if (existing) {
        await update.run({ ...params, id: existing.id });
        articleId = existing.id;
        updated++;
      } else {
        const info = await insert.run(params);
        articleId = info.lastInsertRowid;
        created++;
      }

      await clearRelecture.run(articleId);
      for (const name of r.relectureNames) {
        const m = await resolveMemberByNameLive(name);
        if (m) await insertRelecture.run(articleId, m.id);
      }
    }
  });
  await run();

  res.json({ created, updated, total: rows.length });
});

// ---------------------------------------------------------------------
// Plan de Communication posts
// ---------------------------------------------------------------------

async function postRowToApi(row, L) {
  L = L || (await loadLookups({ articles: true }));
  const coPost = L.member(row.co_post_member_id);
  const linked = row.linked_article_id ? L.article.get(row.linked_article_id) || null : null;
  return {
    id: row.id,
    season: row.season,
    postDate: row.post_date,
    monthLabel: row.month_label,
    day: row.day,
    kind: row.kind,
    itemTitle: row.item_title,
    linkedArticleId: row.linked_article_id,
    linkedArticleTitle: linked?.subject || null,
    reseaux: JSON.parse(row.reseaux || "[]"),
    reseauxPosted: JSON.parse(row.reseaux_posted || "{}"),
    coPost: toMemberSummary(coPost),
    coPostRaw: row.co_post_raw,
    texte: row.texte,
    lien: row.lien,
    posted: !!row.posted,
    updatedBy: toMemberSummary(L.member(row.updated_by)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const POST_COLUMN_MAP = {
  season: "season",
  postDate: "post_date",
  monthLabel: "month_label",
  day: "day",
  kind: "kind",
  itemTitle: "item_title",
  linkedArticleId: "linked_article_id",
  coPostMemberId: "co_post_member_id",
  coPostRaw: "co_post_raw",
  texte: "texte",
  lien: "lien",
  // `posted` isn't here — it's derived, never written directly from the
  // client. See applyPostUpdate.
};

app.get("/api/com/posts", async (req, res) => {
  const { season } = req.query;
  const rows = season
    ? await db.prepare(`SELECT * FROM com_posts WHERE season = ? ORDER BY post_date, day`).all(season)
    : await db.prepare(`SELECT * FROM com_posts ORDER BY season, post_date, day`).all();
  const L = await loadLookups({ articles: true });
  res.json(await Promise.all(rows.map((r) => postRowToApi(r, L))));
});

app.get("/api/com/posts/:id", async (req, res) => {
  const row = await db.prepare(`SELECT * FROM com_posts WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(await postRowToApi(row));
});

app.post("/api/com/posts", async (req, res) => {
  await assertMembersActive(req.body?.coPostMemberId != null ? [req.body.coPostMemberId] : []);
  const info = await db.prepare(`INSERT INTO com_posts (item_title) VALUES (?)`).run(req.body?.itemTitle || "Nouveau post");
  await applyPostUpdate(info.lastInsertRowid, req.body || {}, req.session.user.id);
  res.status(201).json(await postRowToApi(await db.prepare(`SELECT * FROM com_posts WHERE id = ?`).get(info.lastInsertRowid)));
});

app.put("/api/com/posts/:id", async (req, res) => {
  const existing = await db.prepare(`SELECT * FROM com_posts WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  if (req.body?.coPostMemberId != null && Number(req.body.coPostMemberId) !== existing.co_post_member_id) await assertMembersActive([req.body.coPostMemberId]);
  await applyPostUpdate(req.params.id, req.body || {}, req.session.user.id);
  res.json(await postRowToApi(await db.prepare(`SELECT * FROM com_posts WHERE id = ?`).get(req.params.id)));
});

// `posted` is derived, not stored-then-trusted: it's recomputed on every
// write from whichever réseaux the post currently has and their
// individual reseauxPosted state, true only once *every* réseau on the
// post has been checked off — requested explicitly so a post can't read
// as fully "posté" until each of its networks genuinely is. A post with
// zero réseaux is never "posted" (nothing to have posted).
async function applyPostUpdate(id, body, updatedBy) {
  const existing = await db.prepare(`SELECT * FROM com_posts WHERE id = ?`).get(id);
  const sets = [];
  const values = [];
  for (const [apiKey, col] of Object.entries(POST_COLUMN_MAP)) {
    if (!(apiKey in body)) continue;
    if (apiKey === "reseaux") continue; // handled separately below (needs JSON.stringify)
    sets.push(`${col} = ?`);
    values.push(body[apiKey]);
  }

  const nextReseaux = "reseaux" in body ? (Array.isArray(body.reseaux) ? body.reseaux : []) : JSON.parse(existing.reseaux || "[]");
  if ("reseaux" in body) {
    sets.push(`reseaux = ?`);
    values.push(JSON.stringify(nextReseaux));
  }

  const nextReseauxPosted =
    "reseauxPosted" in body && body.reseauxPosted && typeof body.reseauxPosted === "object"
      ? body.reseauxPosted
      : JSON.parse(existing.reseaux_posted || "{}");
  if ("reseauxPosted" in body) {
    sets.push(`reseaux_posted = ?`);
    values.push(JSON.stringify(nextReseauxPosted));
  }

  const derivedPosted = nextReseaux.length > 0 && nextReseaux.every((r) => nextReseauxPosted[r] === true);
  sets.push(`posted = ?`);
  values.push(derivedPosted ? 1 : 0);

  sets.push(`updated_at = datetime('now')`, `updated_by = ?`);
  values.push(updatedBy, id);
  await db.prepare(`UPDATE com_posts SET ${sets.join(", ")} WHERE id = ?`).run(...values);
}

app.delete("/api/com/posts/:id", async (req, res) => {
  await db.prepare(`DELETE FROM com_posts WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

// ---------------------------------------------------------------------
// Settings (ICS url, minutes link, fixed outbound links)
// ---------------------------------------------------------------------

const KNOWN_SETTINGS = [
  "ics_url",
  "minutes_url",
  "mise_en_page_canva_url",
  "mise_en_page_canva_embed_url",
  "heyzine_url",
  "comm_canva_url",
  "fedica_url",
  "podcast_rss_url",
  "serotine_site_url",
  "discord_role_id",
  // JSON-stringified { columnKey: widthPx } maps — see COLUMN_LABELS in
  // AdminPanel.jsx / BohrBoard.jsx's buildColumns() and ComPlan.jsx's
  // columns array, which fall back to their own hardcoded defaults for
  // any key missing here (so this never needs every column listed).
  "bohr_column_widths",
  "complan_column_widths",
  // "From" identity for newsletter sends — not sensitive (it's visible on
  // every sent email regardless), unlike brevo_api_key below.
  "brevo_sender_name",
  "brevo_sender_email",
];

// brevo_api_key deliberately isn't in KNOWN_SETTINGS (so the generic PUT
// below can't set it) and is filtered out of the generic GET's response —
// GET /api/settings has no requireAdmin gate (every logged-in member can
// read it, for e.g. mise_en_page_canva_url), so a real secret can't live
// in that same flat blob. It's set/read only via the dedicated
// /api/newsletter/brevo routes further down, same "never round-trips to
// the browser" contract as the GitHub PAT / Steam key in achievement-vault.
const SECRET_SETTINGS = new Set(["brevo_api_key", "instagram_access_token", "migration_audio_non_vers_pas_commence"]); // (le 2e est un marqueur interne, pas un réglage)

// Les liens/images en haut de chaque page (Mise en page, Communication, Podcast) — modifiables
// seulement par un super admin (LinkSettingsEditor.jsx), que ce soit par son crayon dédié ou par
// l'onglet "Liens & paramètres" de l'Administration, qui touche les mêmes clés.
const PAGE_LINK_SETTINGS = new Set(["mise_en_page_canva_url", "mise_en_page_canva_embed_url", "heyzine_url", "comm_canva_url", "fedica_url", "podcast_rss_url"]);

app.get("/api/settings", async (req, res) => {
  const rows = await db.prepare(`SELECT key, value FROM settings`).all();
  const out = {};
  for (const r of rows) {
    if (SECRET_SETTINGS.has(r.key)) continue;
    out[r.key] = r.value;
  }
  res.json(out);
});

app.put("/api/settings", requireAdmin, async (req, res) => {
  const body = req.body || {};
  if (!req.session.user.isSuperAdmin) {
    // Compares against the *current* value, not just whether the key is present — the
    // Administration settings form always submits every known key (SettingsTab.jsx), including
    // these disabled-but-still-rendered ones, so "key present" alone would reject every save a
    // non-super-admin makes to any OTHER field too.
    const linkKeys = [...PAGE_LINK_SETTINGS];
    const current = await db.prepare(`SELECT key, value FROM settings WHERE key IN (${linkKeys.map(() => "?").join(", ")})`).all(...linkKeys);
    const currentByKey = new Map(current.map((r) => [r.key, r.value]));
    for (const key of PAGE_LINK_SETTINGS) {
      if (key in body && String(body[key] ?? "") !== (currentByKey.get(key) ?? "")) {
        return res.status(403).json({ error: "Super admin only for the page links (Canva, Heyzine, Fedica, RSS)." });
      }
    }
  }
  const set = await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  const apply = db.transaction(async () => {
    for (const key of KNOWN_SETTINGS) {
      if (key in body) await set.run(key, String(body[key] ?? ""));
    }
  });
  await apply();
  const rows = await db.prepare(`SELECT key, value FROM settings`).all();
  const out = {};
  for (const r of rows) {
    if (SECRET_SETTINGS.has(r.key)) continue;
    out[r.key] = r.value;
  }
  res.json(out);
});

// ---------------------------------------------------------------------
// Newsletter sending (Brevo) — the API key is admin-only to read (as a
// connected/not boolean, never the key itself) or set, and sending is
// admin-only too, since it's a real-world action (email lands in
// external subscribers' inboxes) rather than app configuration.
// ---------------------------------------------------------------------

async function getSetting(key) {
  return (await db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key))?.value || "";
}

app.get("/api/newsletter/brevo", requireAdmin, async (req, res) => {
  res.json({
    connected: !!await getSetting("brevo_api_key"),
    senderName: await getSetting("brevo_sender_name"),
    senderEmail: await getSetting("brevo_sender_email"),
  });
});

app.put("/api/newsletter/brevo", requireAdmin, async (req, res) => {
  const { apiKey, senderName, senderEmail } = req.body || {};
  const set = await db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  const apply = db.transaction(async () => {
    // Blank apiKey keeps whatever's already saved — same "re-saving the
    // sender name shouldn't force re-entering the key" contract as every
    // other secret-credential form in this app's sibling project.
    if (apiKey) await set.run("brevo_api_key", apiKey);
    if (senderName !== undefined) await set.run("brevo_sender_name", senderName);
    if (senderEmail !== undefined) await set.run("brevo_sender_email", senderEmail);
  });
  await apply();
  res.json({ connected: !!await getSetting("brevo_api_key") });
});

app.delete("/api/newsletter/brevo", requireAdmin, async (req, res) => {
  await db.prepare(`DELETE FROM settings WHERE key = ?`).run("brevo_api_key");
  res.json({ connected: false });
});

async function sendViaBrevo({ to, subject, html }) {
  const apiKey = await getSetting("brevo_api_key");
  if (!apiKey) {
    const err = new Error("Brevo n'est pas configuré (clé API manquante).");
    err.status = 400;
    throw err;
  }
  const senderEmail = await getSetting("brevo_sender_email");
  const senderName = await getSetting("brevo_sender_name") || "Sérotine";
  if (!senderEmail) {
    const err = new Error("Adresse d'expédition Brevo manquante (Administration → Newsletter).");
    err.status = 400;
    throw err;
  }
  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const err = new Error(`Brevo a refusé l'envoi (${resp.status}) : ${body.slice(0, 300)}`);
    err.status = 502;
    throw err;
  }
}

app.post("/api/newsletter/send-test", requireAdmin, async (req, res) => {
  const { to, subject, html } = req.body || {};
  if (!to || !subject || !html) return res.status(400).json({ error: "to, subject et html sont requis" });
  try {
    await sendViaBrevo({ to, subject, html });
    res.json({ sent: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Sends individually to each address (not one call with multiple `to`
// recipients, which would let every recipient see everyone else's
// address) — sequential with a short pause between sends, same "don't
// hammer an external API in a tight loop" discipline as every other bulk
// external call in this codebase (Steam/PSN icon fetches, etc.), since
// there's no real Brevo list/campaign to delegate this to yet.
app.post("/api/newsletter/send", requireAdmin, async (req, res) => {
  const { recipients, subject, html } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0 || !subject || !html) {
    return res.status(400).json({ error: "recipients (tableau non vide), subject et html sont requis" });
  }
  const failed = [];
  let sentCount = 0;
  for (const to of recipients) {
    try {
      await sendViaBrevo({ to, subject, html });
      sentCount++;
    } catch (err) {
      failed.push({ to, error: err.message });
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  res.json({ sent: sentCount, failed });
});

// ---------------------------------------------------------------------
// Link lists (Documents Technique, Podcast)
// ---------------------------------------------------------------------

app.get("/api/links/:section", async (req, res) => {
  res.json(
    await db.prepare(`SELECT * FROM link_lists WHERE section = ? ORDER BY sort_order`).all(req.params.section)
  );
});

app.post("/api/links/:section", requireSuperAdmin, async (req, res) => {
  const { title, url } = req.body || {};
  const maxOrder =
    (await db.prepare(`SELECT MAX(sort_order) AS m FROM link_lists WHERE section = ?`).get(req.params.section))?.m ?? -1;
  const info = await db
    .prepare(`INSERT INTO link_lists (section, title, url, sort_order) VALUES (?, ?, ?, ?)`)
    .run(req.params.section, title || "", url || "", maxOrder + 1);
  res.status(201).json(await db.prepare(`SELECT * FROM link_lists WHERE id = ?`).get(info.lastInsertRowid));
});

app.put("/api/links/:id", requireSuperAdmin, async (req, res) => {
  const existing = await db.prepare(`SELECT * FROM link_lists WHERE id = ?`).get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });
  const b = req.body || {};
  await db.prepare(`UPDATE link_lists SET title = ?, url = ?, sort_order = ? WHERE id = ?`).run(
    b.title ?? existing.title,
    b.url ?? existing.url,
    b.sortOrder ?? existing.sort_order,
    req.params.id
  );
  res.json(await db.prepare(`SELECT * FROM link_lists WHERE id = ?`).get(req.params.id));
});

app.delete("/api/links/:id", requireSuperAdmin, async (req, res) => {
  await db.prepare(`DELETE FROM link_lists WHERE id = ?`).run(req.params.id);
  res.status(204).end();
});

// ---------------------------------------------------------------------
// Events (subscribed ICS calendar)
// ---------------------------------------------------------------------

let eventsCache = { at: 0, data: [] };
const EVENTS_CACHE_MS = 5 * 60 * 1000;

app.get("/api/events", async (req, res) => {
  const icsUrl = (await db.prepare(`SELECT value FROM settings WHERE key = 'ics_url'`).get())?.value;
  if (!icsUrl) return res.json([]);
  const now = Date.now();
  if (now - eventsCache.at < EVENTS_CACHE_MS) return res.json(eventsCache.data);
  try {
    const events = await fetchUpcomingEvents(icsUrl);
    eventsCache = { at: now, data: events };
    res.json(events);
  } catch (err) {
    console.error("ICS fetch failed:", err.message);
    res.status(502).json({ error: "Could not fetch the calendar", detail: err.message });
  }
});

// PROTOTYPE — statistiques des campagnes Brevo envoyées (pour export CSV depuis la page Statistiques). Admin seulement, lecture seule ;
// la clé API (déjà enregistrée pour l'envoi de la newsletter) ne quitte jamais le serveur.
app.get("/api/stats/brevo", requireAdmin, async (req, res) => {
  const apiKey = await getSetting("brevo_api_key");
  if (!apiKey) return res.status(400).json({ error: "Brevo n'est pas configuré (clé API manquante : Administration → Newsletter)." });
  try {
    res.json({ campaigns: await fetchBrevoCampaigns(apiKey) });
  } catch (err) {
    console.error("Brevo stats failed:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ---- Instagram (PROTOTYPE) : jeton d'accès enregistré côté serveur, jamais renvoyé ; voir server/instagram-stats.js ----
const igSet = (key, value) => db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
const igFail = (res, err) => {
  console.error("Instagram:", err.message);
  res.status(err.status === 401 ? 401 : 502).json({ error: err.message });
};

app.get("/api/instagram", requireAdmin, async (req, res) => {
  res.json({ connected: !!(await getSetting("instagram_access_token")), username: await getSetting("instagram_username"), expiresAt: (await getSetting("instagram_token_expires")) || null });
});

app.put("/api/instagram", requireAdmin, async (req, res) => {
  const token = String(req.body?.token || "").trim();
  if (token.length < 20 || token.length > 1000 || /\s/.test(token)) return res.status(400).json({ error: "Jeton invalide (collez le jeton d'accès Instagram, sans espace)." });
  try {
    const { username } = await checkInstagramToken(token); // on vérifie avant d'enregistrer
    await igSet("instagram_access_token", token);
    await igSet("instagram_username", username);
    await igSet("instagram_token_expires", "");
    res.json({ connected: true, username, expiresAt: null });
  } catch (err) {
    igFail(res, err);
  }
});

app.delete("/api/instagram", requireAdmin, async (req, res) => {
  await db.prepare(`DELETE FROM settings WHERE key IN ('instagram_access_token', 'instagram_username', 'instagram_token_expires')`).run();
  res.json({ connected: false });
});

app.post("/api/instagram/refresh", requireAdmin, async (req, res) => {
  const token = await getSetting("instagram_access_token");
  if (!token) return res.status(400).json({ error: "Instagram n'est pas connecté." });
  try {
    const next = await refreshInstagramToken(token);
    await igSet("instagram_access_token", next.token);
    await igSet("instagram_token_expires", next.expiresAt || "");
    res.json({ connected: true, username: await getSetting("instagram_username"), expiresAt: next.expiresAt });
  } catch (err) {
    igFail(res, err);
  }
});

app.get("/api/stats/instagram", requireAdmin, async (req, res) => {
  const token = await getSetting("instagram_access_token");
  if (!token) return res.status(400).json({ error: "Instagram n'est pas connecté (collez un jeton d'accès)." });
  try {
    res.json(await fetchInstagramStats(token));
  } catch (err) {
    igFail(res, err);
  }
});

// ---------------------------------------------------------------------
// Maintenance (database backups)
// ---------------------------------------------------------------------

app.get("/api/maintenance/backups", requireAdmin, async (req, res) => {
  res.json(listBackups());
});

app.post("/api/maintenance/backups", requireAdmin, async (req, res) => {
  try {
    const path = await createBackupNow("manual");
    res.status(201).json({ path: path.split("/").pop() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Restaure la base depuis un pg_dump (voir db.js restoreBackup) ; un instantané « pre-restore » est pris avant.
app.post("/api/maintenance/backups/:name/restore", requireAdmin, async (req, res) => {
  try {
    await restoreBackup(req.params.name);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Erreurs « attendues » des routes (HttpError) → JSON propre ; tout le reste garde le comportement d'Express (500).
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  next(err);
});

// ---------------------------------------------------------------------
// Static build (production)
// ---------------------------------------------------------------------

const dist = join(APP_ROOT, "dist");
if (existsSync(dist)) {
  // Fichiers à empreinte (/assets/*.js|css|woff2) : cache d'un an ; index.html jamais mis en cache (il pointe vers les bons fichiers).
  app.use(
    express.static(dist, {
      setHeaders(res, file) {
        if (/[\\/]assets[\\/]/.test(file)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        else if (file.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
      },
    })
  );
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/auth")) return next();
    res.sendFile(join(dist, "index.html"));
  });
}

const server = app.listen(PORT, async () => {
  console.log(`Sérotine App listening on http://localhost:${PORT}`);
  const status = await authStatus();
  if (!status.configured) console.warn(`⚠ ${status.warning}`);
});

// Fire-and-forget — a slow first backup shouldn't delay the server coming
// up to serve requests.
runStartupBackupIfNeeded().catch((err) => console.error("Startup backup failed:", err.message));

export { app, server };

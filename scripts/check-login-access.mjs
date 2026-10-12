/**
 * check-login-access.mjs — vérifie le contrôle d'accès à la connexion SANS Discord ni core_db réels (leurs réponses sont simulées) :
 * Discord = identité seule ; accès = inscrit au projet Sérotine dans core_db ; comité de rédaction = base privée ; échec fermé ; amorçage.
 *
 *   DATABASE_URL=postgres://…/base_de_TEST DISCORD_CLIENT_ID=x DISCORD_CLIENT_SECRET=x DISCORD_REDIRECT_URI=http://x \
 *   COREDB_URL=http://127.0.0.1:1 COREDB_JWT_SECRET=x node scripts/check-login-access.mjs
 *
 * ⚠️ À lancer sur une base de TEST : il crée puis supprime quelques lignes `members` (identifiants 9999…). Sortie 0 = tout passe.
 */
const real = globalThis.fetch;
const COMITE = "999999999999999901", SIMPLE = "999999999999999902", NOUVELLE = "999999999999999903", HORS_PROJET = "999999999999999904";
const directory = { [COMITE]: 9901, [SIMPLE]: 9902, [NOUVELLE]: 9903 }; // inscrits au projet Sérotine (HORS_PROJET n'y est pas)
let who = COMITE, dirDown = false, guildCalls = 0;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes("/oauth2/token")) return new Response(JSON.stringify({ access_token: "t" }));
  if (u.endsWith("/users/@me")) return new Response(JSON.stringify({ id: who, username: "u" + who.slice(-2), global_name: "G", avatar: null }));
  if (u.includes("/guilds/")) { guildCalls++; return new Response("{}", { status: 404 }); }
  if (u.includes("/serotine_members_view")) {
    if (dirDown) throw new Error("annuaire coupé");
    const id = new URL(u).searchParams.get("discord_id").replace("eq.", "");
    return new Response(JSON.stringify(directory[id] ? [{ id: directory[id], prenom: `Prénom${id.slice(-2)}`, discord_id: id }] : []));
  }
  return real(url, opts);
};
const { default: db } = await import("../server/db.js");
const { completeLogin, authStatus, buildAuthorizeUrl } = await import("../server/auth.js");

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!cond) failed++; };
const cleanup = () => db.prepare(`DELETE FROM members WHERE discord_id IN (?, ?, ?, ?)`).run(COMITE, SIMPLE, NOUVELLE, HORS_PROJET);
await cleanup();
await db.prepare(`INSERT INTO members (discord_id, display_name, is_admin) VALUES (?, 'Comité test', 1)`).run(COMITE);
await db.prepare(`INSERT INTO members (discord_id, display_name, is_admin) VALUES (?, 'Simple test', 0)`).run(SIMPLE);
await db.prepare(`INSERT INTO members (discord_id, display_name, is_admin) VALUES (?, 'Hors projet test', 0)`).run(HORS_PROJET);

ok("mode « annuaire » actif", (await authStatus()).accessMode === "directory");
ok("scope Discord = identify seulement", new URL(buildAuthorizeUrl("s")).searchParams.get("scope") === "identify");
let r = await completeLogin("c");
ok("inscrit au projet + membre du comité → accès et accès du comité", r.authorized && !!r.member.is_admin);
who = SIMPLE; r = await completeLogin("c");
ok("inscrit au projet, hors comité → accès sans les accès du comité", r.authorized && !r.member.is_admin);
who = NOUVELLE; r = await completeLogin("c");
ok("personne nouvelle inscrite au projet → profil créé, hors comité, prénom de l'annuaire", r.authorized && !r.member.is_admin && r.member.display_name === "Prénom03" && r.member.core_member_id === 9903);
who = HORS_PROJET; r = await completeLogin("c");
ok("connue de l'outil mais PAS inscrite au projet → refusée", !r.authorized);
who = COMITE; dirDown = true; r = await completeLogin("c");
ok("annuaire injoignable → refusée (échec fermé), même pour le comité", !r.authorized);
ok("aucun appel à l'API des serveurs Discord (rôles non lus)", guildCalls === 0);

await cleanup();
console.log(failed ? `\n${failed} vérification(s) en échec` : "\nTout passe.");
process.exit(failed ? 1 : 0);

/**
 * smoke-test.mjs — vérifie qu'une instance de Serotine App qui tourne répond correctement, en admin, sans rien laisser derrière elle.
 *
 *   BASE_URL=http://localhost:3101 COOKIE='connect.sid=s%3A…' node scripts/smoke-test.mjs
 *
 * COOKIE : cookie de session d'un compte admin (en local, une ligne dans la table `session` signée avec SESSION_SECRET ; voir CLAUDE.md).
 * À lancer sur une base de TEST (il crée puis supprime un article et un post, mais modifie brièvement des réglages et des rôles).
 * Code de sortie 0 si tout passe, 1 sinon.
 */
const BASE = process.env.BASE_URL || "http://localhost:3101";
const COOKIE = process.env.COOKIE;
if (!COOKIE) { console.error("COOKIE requis (voir l'en-tête du script)."); process.exit(2); }

let failed = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!cond) failed++; };
async function call(method, path, body) {
  const res = await fetch(BASE + path, { method, headers: { Cookie: COOKIE, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* pas du JSON (204, page…) */ }
  return { status: res.status, json };
}

// Lectures
for (const path of ["/auth/me", "/api/members", "/api/topics", "/api/bohr/status-options", "/api/bohr/articles", "/api/com/posts", "/api/settings", "/api/links/podcast", "/api/maintenance/backups", "/api/members/core-sync", "/api/instagram"]) {
  const r = await call("GET", path);
  ok(`GET ${path}`, r.status === 200, `HTTP ${r.status}`);
}
const me = (await call("GET", "/auth/me")).json;
ok("session admin", me.user?.isAdmin === true);

// Vocabulaires attendus
const opts = (await call("GET", "/api/bohr/status-options")).json;
const vocab = (f) => opts.filter((o) => o.field === f).sort((a, b) => a.sort_order - b.sort_order).map((o) => o.value).join(">");
ok("états audio", vocab("etat_audio") === "Non>Pas commencé>Enregistré>Traité>Posté", vocab("etat_audio"));
ok("états illustration", vocab("illustrations").startsWith("Non>Pas commencé>"), vocab("illustrations"));

// Articles : création, valeurs par défaut, rôles, relecture, suppression
const a = (await call("POST", "/api/bohr/articles", { subject: "SMOKE TEST", season: "Saison 99" })).json;
ok("création d'un article", a?.id > 0);
ok("audio par défaut « Pas commencé »", a.etatAudio === "Pas commencé", a.etatAudio);
const members = (await call("GET", "/api/members")).json;
const m1 = members[0].id, m2 = members[1].id;
for (const key of ["correctionId", "sourceId", "miseEnPageId", "illustrationId", "enregistrementId", "montageId", "communicationId"]) {
  const r = await call("PUT", `/api/bohr/articles/${a.id}`, { [key]: m1 });
  const field = { correctionId: "correction", sourceId: "source", miseEnPageId: "miseEnPage", illustrationId: "illustration", enregistrementId: "enregistrement", montageId: "montage", communicationId: "communication" }[key];
  ok(`rôle ${key}`, r.status === 200 && r.json[field]?.id === m1);
}
const rel = await call("PUT", `/api/bohr/articles/${a.id}/relecture`, { memberIds: [m1, m2] });
ok("relecture (2 personnes)", rel.json?.relecture?.length === 2);
const upd = await call("PUT", `/api/bohr/articles/${a.id}`, { etatAudio: "Traité", illustrations: "Non" });
ok("états audio / illustration modifiables (admin)", upd.json?.etatAudio === "Traité" && upd.json?.illustrations === "Non");

// Posts : création, lien vers l'article, état « posté » dérivé, texte
const p = (await call("POST", "/api/com/posts", { itemTitle: "SMOKE POST", season: "Saison 99", linkedArticleId: a.id, reseaux: ["Linkedin", "Bluesky (thread)"], texte: "Bonjour" })).json;
ok("création d'un post lié", p?.id > 0 && p.linkedArticleTitle === "SMOKE TEST");
const half = (await call("PUT", `/api/com/posts/${p.id}`, { reseauxPosted: { Linkedin: true } })).json;
ok("posté = faux tant qu'un réseau manque", half.posted === false);
const full = (await call("PUT", `/api/com/posts/${p.id}`, { reseauxPosted: { Linkedin: true, "Bluesky (thread)": true } })).json;
ok("posté = vrai quand tous les réseaux le sont", full.posted === true);

// Réglages : écriture/lecture, et pas de fuite du marqueur interne
const st = (await call("GET", "/api/settings")).json;
ok("marqueur interne non exposé", !("migration_audio_non_vers_pas_commence" in st));

// Nettoyage
ok("suppression du post", (await call("DELETE", `/api/com/posts/${p.id}`)).status === 204);
ok("suppression de l'article", (await call("DELETE", `/api/bohr/articles/${a.id}`)).status === 204);
ok("article bien supprimé", (await call("GET", `/api/bohr/articles/${a.id}`)).status === 404);

// Sécurité de base
const anon = await fetch(BASE + "/api/members");
ok("API fermée sans session", anon.status === 401, `HTTP ${anon.status}`);

console.log(failed ? `\n${failed} vérification(s) en échec` : "\nTout passe.");
process.exit(failed ? 1 : 0);

import test from "node:test";
import assert from "node:assert/strict";
import { mapInstagramPost, insightsToMap, fetchInstagramStats, checkInstagramToken } from "../server/instagram-stats.js";

// Formes documentées par Meta (à remplacer par de vraies réponses du compte dès qu'on en a).
const media = { id: "1789", caption: "Le numéro 7\nest là !  ", media_type: "IMAGE", media_product_type: "FEED", permalink: "https://www.instagram.com/p/abc/", timestamp: "2026-09-21T09:00:00+0000", like_count: 120, comments_count: 8 };
const insightsBody = { data: [{ name: "reach", values: [{ value: 900 }] }, { name: "views", values: [{ value: 1500 }] }, { name: "saved", values: [{ value: 12 }] }, { name: "shares", values: [{ value: 5 }] }, { name: "total_interactions", values: [{ value: 150 }] }] };

test("une publication + insights → ligne à plat avec taux d'engagement", () => {
  const r = mapInstagramPost(media, insightsToMap(insightsBody));
  assert.equal(r.date, "2026-09-21");
  assert.equal(r.type, "Image");
  assert.equal(r.caption, "Le numéro 7 est là !");
  assert.equal(r.reach, 900);
  assert.equal(r.likes, 120); // vient de la liste des publications (insights sans « likes »)
  assert.equal(r.interactions, 150);
  assert.equal(r.engagementRate, 16.7);
});

test("sans insights : j'aime/commentaires de la liste, interactions = leur somme, jamais de 0 inventé pour la portée", () => {
  const r = mapInstagramPost(media, {});
  assert.equal(r.reach, null);
  assert.equal(r.views, null);
  assert.equal(r.interactions, 128);
  assert.equal(r.engagementRate, null);
});

test("données mal formées : pas d'exception", () => {
  for (const bad of [null, undefined, {}, { timestamp: "hier", like_count: "abc" }]) {
    const r = mapInstagramPost(bad, insightsToMap(null));
    assert.equal(r.date, "");
    assert.equal(r.reach, null);
  }
  assert.deepEqual(insightsToMap({ data: [{ name: "reach", values: [] }, { values: [{ value: 3 }] }, null] }), {});
});

test("un reel est reconnu", () => {
  assert.equal(mapInstagramPost({ ...media, media_type: "VIDEO", media_product_type: "REELS" }, {}).type, "Reel");
});

function stubFetch(handler) {
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => { calls.push(String(url)); return handler(new URL(url), opts); };
  return calls;
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

test("fetchInstagramStats : repli sur les mesures minimales quand Meta refuse l'ensemble complet ; le jeton va à Meta (access_token) mais jamais dans un journal ni un message", async () => {
  const logs = [];
  const calls = stubFetch((u) => {
    if (u.pathname.endsWith("/me")) return json({ username: "serotine", followers_count: 420, media_count: 55 });
    if (u.pathname.endsWith("/me/media")) return json({ data: [media, { ...media, id: "1790" }] });
    if (u.pathname.endsWith("/insights")) {
      return u.searchParams.get("metric").includes("reach") ? json({ error: { code: 100, message: "metric not supported" } }, 400) : json({ data: [{ name: "views", values: [{ value: 700 }] }, { name: "total_interactions", values: [{ value: 60 }] }] });
    }
    return json({}, 404);
  });
  const r = await fetchInstagramStats("TOPSECRET", { log: (m) => logs.push(m) });
  assert.equal(r.account.followers, 420);
  assert.equal(r.posts.length, 2);
  assert.equal(r.posts[0].views, 700);
  assert.equal(r.posts[0].reach, null);
  assert.ok(calls.every((c) => new URL(c).searchParams.get("access_token") === "TOPSECRET"), "jeton transmis à Meta en paramètre access_token");
  assert.ok(logs.every((m) => !m.includes("TOPSECRET")), "jeton dans un journal");
  assert.equal(logs.length, 2); // un repli par publication
});

test("jeton refusé (code 190) : message clair, sans le jeton ; jeton valide : nom du compte", async () => {
  stubFetch(() => json({ error: { code: 190, message: "Invalid OAuth access token TOPSECRET" } }, 400));
  await assert.rejects(() => checkInstagramToken("TOPSECRET"), (e) => /refusé le jeton/.test(e.message) && !e.message.includes("TOPSECRET"));
  stubFetch(() => json({ username: "serotine" }));
  assert.deepEqual(await checkInstagramToken("ok"), { username: "serotine" });
});

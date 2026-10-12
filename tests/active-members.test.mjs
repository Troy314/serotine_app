import test from "node:test";
import assert from "node:assert/strict";

// coredb.js lit son environnement à l'import : on le règle avant de l'importer.
process.env.COREDB_URL = "http://core.invalid";
process.env.COREDB_JWT_SECRET = "x";
const { activeDiscordIds, isActiveMember, resetActiveCache } = await import("../server/coredb.js");

const rows = (...ids) => ids.map((id) => ({ id: 1, prenom: "x", discord_id: id }));
let t = 0;
const now = () => t;

test("liste = Discord ID du projet ; mise en cache 60 s puis relue", async () => {
  resetActiveCache(); t = 0;
  let calls = 0;
  const list = async () => { calls++; return rows("1", "2"); };
  const a = await activeDiscordIds({ now, list });
  assert.deepEqual([...a].sort(), ["1", "2"]);
  t = 30_000; await activeDiscordIds({ now, list });
  assert.equal(calls, 1);
  t = 61_000; await activeDiscordIds({ now, list: async () => { calls++; return rows("2"); } });
  assert.equal(calls, 2);
  assert.deepEqual([...(await activeDiscordIds({ now, list }))], ["2"]);
});

test("annuaire injoignable : on garde le dernier résultat connu ; sinon « inconnu » (null = tout le monde actif)", async () => {
  resetActiveCache(); t = 0;
  const down = async () => { throw new Error("coupé"); };
  assert.equal(await activeDiscordIds({ now, list: down }), null);
  await activeDiscordIds({ now, list: async () => rows("7") });
  t = 120_000;
  const set = await activeDiscordIds({ now, list: down });
  assert.deepEqual([...set], ["7"]); // dernier résultat connu
});

test("projet vide (probable erreur de configuration) : ignoré, personne n'est écarté à tort", async () => {
  resetActiveCache(); t = 0;
  assert.equal(await activeDiscordIds({ now, list: async () => [] }), null);
});

test("isActiveMember : inconnu → actif ; sans Discord ID (profil importé) → actif ; Discord ID absent du projet → inactif", () => {
  const set = new Set(["1"]);
  assert.equal(isActiveMember({ discord_id: "1" }, null), true);
  assert.equal(isActiveMember({ discord_id: null }, set), true);
  assert.equal(isActiveMember({ discord_id: "1" }, set), true);
  assert.equal(isActiveMember({ discord_id: "2" }, set), false);
  assert.equal(isActiveMember({ discord_id: 2 }, set), false); // nombre ou texte : même résultat
  assert.equal(isActiveMember({ discord_id: "1", archived: 1 }, set), false); // archivé à la main : jamais actif
  assert.equal(isActiveMember({ discord_id: null, archived: 1 }, null), false); // même sans annuaire
  assert.equal(isActiveMember({ discord_id: "1", archived: 0 }, set), true);
});

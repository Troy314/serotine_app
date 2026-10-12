/**
 * migrate-sqlite-to-pg.js — copie UNE FOIS les données de l'ancienne base SQLite vers la base Postgres privée.
 *
 *   1. python3 scripts/export-sqlite-to-json.py /chemin/serotine-app.db > serotine-export.json   (SQLite ouvert en lecture seule)
 *   2. EXPORT_JSON=serotine-export.json DATABASE_URL=postgres://… node scripts/migrate-sqlite-to-pg.js [--dry-run]
 *
 * Garde-fous (skill safe-data-migration) :
 *  - refuse de tourner si members / bohr_articles / com_posts / link_lists / bohr_article_relecture ne sont pas vides côté Postgres ;
 *  - tout se passe dans UNE transaction : un compte de lignes différent, une erreur → ROLLBACK, rien n'est écrit ;
 *  - les `id` sont conservés tels quels (toutes les clés étrangères restent valides), puis les séquences sont recalées ;
 *  - topics / bohr_status_options / settings sont remplacés par le contenu exporté (ils portent les modifications faites par les admins ;
 *    les valeurs par défaut semées au démarrage de l'app ne doivent pas s'y mélanger) — l'app renomme ensuite toute seule les anciens
 *    états du podcast / de l'audio au prochain démarrage (voir server/db.js) ;
 *  - --dry-run : fait tout, vérifie, puis annule.
 * (Ancienne version : lisait le .db avec better-sqlite3, module natif qui ne s'installe pas dans une image Node légère ; remplacée par l'export JSON.)
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { pool } from "../server/db.js";

const exportPath = process.env.EXPORT_JSON;
if (!exportPath) {
  console.error("EXPORT_JSON est requis (voir l'en-tête du script).");
  process.exit(2);
}
const dryRun = process.argv.includes("--dry-run");
const src = JSON.parse(readFileSync(exportPath, "utf8"));

// Ordre = dépendances de clés étrangères.
const TABLES = [
  { name: "members", replace: false },
  { name: "topics", replace: true },
  { name: "bohr_status_options", replace: true },
  { name: "bohr_articles", replace: false },
  { name: "bohr_article_relecture", replace: false, noId: true },
  { name: "com_posts", replace: false },
  { name: "settings", replace: true, noId: true },
  { name: "link_lists", replace: false },
];

const client = await pool.connect();
let ok = false;
try {
  for (const t of ["members", "bohr_articles", "com_posts", "link_lists", "bohr_article_relecture"]) {
    const n = (await client.query(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n;
    if (n > 0) throw new Error(`Postgres : la table ${t} contient déjà ${n} ligne(s) — migration refusée.`);
  }
  await client.query("BEGIN");
  await client.query("DELETE FROM topics; DELETE FROM bohr_status_options; DELETE FROM settings;");

  const report = [];
  for (const t of TABLES) {
    const rows = src[t.name];
    if (!Array.isArray(rows)) throw new Error(`Table ${t.name} absente de l'export`);
    for (const r of rows) {
      const cols = Object.keys(r);
      const sql = `INSERT INTO ${t.name} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})`;
      await client.query(sql, cols.map((c) => r[c]));
    }
    if (!t.noId) {
      await client.query(`SELECT setval(pg_get_serial_sequence('${t.name}', 'id'), COALESCE((SELECT MAX(id) FROM ${t.name}), 1), (SELECT COUNT(*) > 0 FROM ${t.name}))`);
    }
    const after = Number((await client.query(`SELECT COUNT(*) AS n FROM ${t.name}`)).rows[0].n);
    report.push({ table: t.name, export: rows.length, postgres: after });
    if (after !== rows.length) throw new Error(`Compte différent pour ${t.name} : export ${rows.length}, Postgres ${after}`);
  }
  console.table(report);

  // Contrôle d'intégrité en plus des comptes : aucune clé étrangère orpheline (Postgres les impose déjà), et les
  // articles liés à des posts existent toujours.
  const linked = (await client.query(`SELECT COUNT(*) AS n FROM com_posts WHERE linked_article_id IS NOT NULL`)).rows[0].n;
  const linkedSrc = src.com_posts.filter((r) => r.linked_article_id != null).length;
  if (Number(linked) !== linkedSrc) throw new Error(`Liens post → article : export ${linkedSrc}, Postgres ${linked}`);

  await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  ok = true;
  console.log(dryRun ? "Essai à blanc réussi — rien n'a été écrit." : "Migration terminée et validée.");
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("MIGRATION ANNULÉE :", err.message);
} finally {
  client.release();
  await pool.end();
  process.exit(ok ? 0 : 1);
}

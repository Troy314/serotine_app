/**
 * db.js — connexion à la base PRIVÉE de Serotine App (PostgreSQL, service `db` du compose.yaml).
 *
 * Migré de SQLite (better-sqlite3) à PostgreSQL le 2026-10-09 (voir _architecture/serotine_app.md).
 * Pour limiter la réécriture, ce module expose une petite couche qui ressemble à better-sqlite3
 * mais ASYNCHRONE : `db.prepare(sql).get/all/run(...)` et `db.transaction(fn)` renvoient des
 * promesses (toujours les `await`er). Traductions faites ici, pour que le SQL du reste du code
 * reste lisible :
 *   - `?` / `@nom` → `$1…` ;
 *   - `INSERT OR IGNORE INTO` → `INSERT INTO … ON CONFLICT DO NOTHING` ;
 *   - `datetime('now')` → date UTC au même format texte qu'avant (« 2026-10-09 14:03:12 ») ;
 *   - `.run()` d'un INSERT renvoie `{ lastInsertRowid, changes }` (via `RETURNING id`).
 * Les colonnes gardent leurs types d'origine (dates en texte, booléens 0/1, listes en JSON texte)
 * pour que l'API et le front ne changent pas.
 *
 * Les tables : voir le bloc CREATE TABLE ci-dessous. `members` est un profil PRIVÉ (crédits, droits,
 * alias) ; l'identité des adhérents vit dans `core_db.members` (étape B, pas encore branchée).
 * `bohr_articles` et `com_posts` sont liées par `com_posts.linked_article_id`.
 */
import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, unlinkSync, statSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(here, "..");
const BACKUPS_DIR = process.env.BACKUPS_DIR || join(APP_ROOT, "data", "backups");
const MAX_AUTO_BACKUPS = 14;

// COUNT()/SUM() reviennent en bigint/numeric (texte par défaut) : on les veut en nombres, comme avant.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgres://serotine:serotine@localhost:5432/serotine",
  max: 10,
});

const txStore = new AsyncLocalStorage();
const runner = () => txStore.getStore() ?? pool;

const NOW_TXT = "to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')";
const TABLES_WITH_ID = new Set(["members", "topics", "bohr_status_options", "bohr_articles", "com_posts", "link_lists", "impersonation_log"]);

/** SQL « façon SQLite » → { text, values } pour pg. */
function translate(sql, args) {
  let text = sql.replace(/datetime\('now'\)/g, NOW_TXT);
  let ignore = false;
  text = text.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, () => {
    ignore = true;
    return "INSERT INTO";
  });
  if (ignore) text = text.replace(/;?\s*$/, " ON CONFLICT DO NOTHING");
  const values = [];
  const named = args.length === 1 && args[0] && typeof args[0] === "object" && !Array.isArray(args[0]);
  if (named) {
    text = text.replace(/@(\w+)/g, (_, k) => {
      values.push(args[0][k]);
      return `$${values.length}`;
    });
  } else {
    const flat = args.flat();
    let i = 0;
    text = text.replace(/\?/g, () => {
      values.push(flat[i++]);
      return `$${values.length}`;
    });
  }
  return { text, values };
}

async function query(sql, args) {
  const { text, values } = translate(sql, args);
  return runner().query(text, values);
}

const db = {
  prepare(sql) {
    return {
      async get(...args) {
        return (await query(sql, args)).rows[0];
      },
      async all(...args) {
        return (await query(sql, args)).rows;
      },
      async run(...args) {
        const m = /^\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(\w+)/i.exec(sql);
        const wantsId = m && TABLES_WITH_ID.has(m[1]) && !/RETURNING/i.test(sql);
        const res = await query(wantsId ? `${sql.replace(/;?\s*$/, "")} RETURNING id` : sql, args);
        return { lastInsertRowid: res.rows[0]?.id, changes: res.rowCount };
      },
    };
  },
  async exec(sql) {
    return runner().query(sql);
  },
  /** Comme better-sqlite3 : renvoie une fonction qui exécute `fn` dans une transaction (async). */
  transaction(fn) {
    return async (...args) => {
      if (txStore.getStore()) return fn(...args); // déjà dans une transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await txStore.run(client, () => fn(...args));
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    };
  },
};

await db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id                 SERIAL PRIMARY KEY,
    discord_id         TEXT UNIQUE,
    discord_username   TEXT NOT NULL DEFAULT '',
    discord_avatar     TEXT NOT NULL DEFAULT '',
    display_name       TEXT NOT NULL,
    legacy_aliases     TEXT NOT NULL DEFAULT '[]',
    credit_linkedin    TEXT NOT NULL DEFAULT '',
    credit_instagram   TEXT NOT NULL DEFAULT '',
    credit_bluesky     TEXT NOT NULL DEFAULT '',
    collab_instagram   INTEGER NOT NULL DEFAULT 0,
    -- Not a second Discord role — see server/auth.js. Gates editing the
    -- sheet's "C2R only" Bohr fields plus the admin screens (statuses,
    -- topics, settings, link lists, other members' credit info). The
    -- very first real Discord login ever is auto-granted this, to
    -- bootstrap; every admin after that is promoted by an existing one.
    is_admin           INTEGER NOT NULL DEFAULT 0,
    -- members.members.id dans core_db (annuaire de l'asso), posé à la connexion — voir server/coredb.js.
    -- NULL = pas (encore) rapproché·e : placeholder d'import, ou outil lancé sans annuaire.
    core_member_id     INTEGER,
    created_at         TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
  );

  ALTER TABLE members ADD COLUMN IF NOT EXISTS core_member_id INTEGER;
  -- Pôles (2026-10-09, une seule colonne "tags" plutôt qu'une par pôle — remplace une première
  -- version à 3 colonnes booléennes séparées, jamais utilisée en pratique) : accès à une section en
  -- plus de la base commune (Tableau de Bohr, À faire, Documents Technique) — un membre peut porter
  -- plusieurs tags. Valeurs possibles : "mise_en_page", "podcast", "communication". Le comité de
  -- rédaction (is_admin, colonne séparée — c'est la frontière de sécurité réelle, voir requireAdmin)
  -- a de toute façon accès à tout ; "C2R" apparaît comme un 4e tag dans le sélecteur de
  -- l'Administration pour que ce soit un seul contrôle à l'écran, mais bascule is_admin en dessous.
  ALTER TABLE members ADD COLUMN IF NOT EXISTS roles TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE members DROP COLUMN IF EXISTS pole_mise_en_page;
  ALTER TABLE members DROP COLUMN IF EXISTS pole_podcast;
  ALTER TABLE members DROP COLUMN IF EXISTS pole_communication;
  -- Super admin (2026-10-09) : un cran au-dessus du C2R, pour les quelques actions trop sensibles
  -- pour que tout le comité les porte par défaut — modifier les liens/images en haut de chaque
  -- page, « se connecter en tant que ». Implique is_admin (appliqué aussi côté serveur, voir PUT
  -- /api/members/:id) : pas de super admin qui ne serait pas déjà du C2R.
  ALTER TABLE members ADD COLUMN IF NOT EXISTS is_super_admin INTEGER NOT NULL DEFAULT 0;

  -- "Se connecter en tant que" (2026-10-09, super admin only) : trace de qui a vu l'appli comme
  -- qui et quand — même esprit que le journal équivalent d'AurAgenda. ended_at NULL = en cours
  -- (ne devrait normalement pas arriver : POST /api/admin/stop-impersonating le referme toujours,
  -- sauf session coupée sans déconnexion propre).
  CREATE TABLE IF NOT EXISTS impersonation_log (
    id         SERIAL PRIMARY KEY,
    admin_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    target_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')),
    ended_at   TEXT
  );

  CREATE TABLE IF NOT EXISTS topics (
    id    SERIAL PRIMARY KEY,
    name  TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#435c6e'
  );

  -- Editable vocab + color for every status-like select field, so "modify
  -- items and colors" (per the spec) is a real admin screen, not a code
  -- change. field values: etat_redaction | etat_mise_en_page | etat_audio |
  -- communication_rs | concept.
  CREATE TABLE IF NOT EXISTS bohr_status_options (
    id         SERIAL PRIMARY KEY,
    field      TEXT NOT NULL,
    value      TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#9aa5b1',
    sort_order INTEGER NOT NULL DEFAULT 0,
    UNIQUE(field, value)
  );

  CREATE TABLE IF NOT EXISTS bohr_articles (
    id                 SERIAL PRIMARY KEY,
    season             TEXT NOT NULL DEFAULT '',
    issue_label        TEXT NOT NULL DEFAULT '',
    issue_month        TEXT NOT NULL DEFAULT '',
    issue_order        INTEGER NOT NULL DEFAULT 0,
    row_order          INTEGER NOT NULL DEFAULT 0,
    subject            TEXT NOT NULL DEFAULT '',
    subject_url        TEXT NOT NULL DEFAULT '',
    discord_thread_url TEXT NOT NULL DEFAULT '',
    topic              TEXT NOT NULL DEFAULT '',
    author_id          INTEGER REFERENCES members(id) ON DELETE SET NULL,
    concept            TEXT NOT NULL DEFAULT '',
    etat_redaction     TEXT NOT NULL DEFAULT 'Pas commencé',
    ligne_editoriale   INTEGER NOT NULL DEFAULT 0,
    correction_id      INTEGER REFERENCES members(id) ON DELETE SET NULL,
    source_id          INTEGER REFERENCES members(id) ON DELETE SET NULL,
    comite_sci         INTEGER NOT NULL DEFAULT 0,
    etat_mise_en_page  TEXT NOT NULL DEFAULT 'Pas commencé',
    illustrations      TEXT NOT NULL DEFAULT 'Pas commencé',
    pages              DOUBLE PRECISION NOT NULL DEFAULT 0,
    etat_audio         TEXT NOT NULL DEFAULT 'Pas commencé',
    enregistrement_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
    montage_id         INTEGER REFERENCES members(id) ON DELETE SET NULL,
    -- Responsables ajoutés le 2026-10-09 (comme correction/source/enregistrement : un·e membre par rôle).
    mise_en_page_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
    illustration_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
    communication_id   INTEGER REFERENCES members(id) ON DELETE SET NULL,
    communication_rs   TEXT NOT NULL DEFAULT 'Non',
    is_cover           INTEGER NOT NULL DEFAULT 0,
    notes              TEXT NOT NULL DEFAULT '',
    -- Lightweight "who touched this last" — not real-time presence (no
    -- websockets), just visibility into recent edits so two people
    -- editing the same board have some idea someone else was just there.
    -- See the migration below (this table predates the column).
    updated_by         INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at         TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at         TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE INDEX IF NOT EXISTS idx_bohr_season ON bohr_articles(season);

  -- "Par les membres" proofreader list — many-to-many.
  CREATE TABLE IF NOT EXISTS bohr_article_relecture (
    article_id INTEGER NOT NULL REFERENCES bohr_articles(id) ON DELETE CASCADE,
    member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, member_id)
  );

  CREATE TABLE IF NOT EXISTS com_posts (
    id                 SERIAL PRIMARY KEY,
    season             TEXT NOT NULL DEFAULT '',
    post_date          TEXT NOT NULL DEFAULT '',
    month_label        TEXT NOT NULL DEFAULT '',
    day                INTEGER,
    kind               TEXT NOT NULL DEFAULT 'post',
    item_title         TEXT NOT NULL DEFAULT '',
    linked_article_id  INTEGER REFERENCES bohr_articles(id) ON DELETE SET NULL,
    reseaux            TEXT NOT NULL DEFAULT '[]',
    -- Per-réseau posted state, {"Insta (Post)": true, ...} — the base
    -- 'posted' column below is derived from this (true only once every
    -- réseau on the post is checked), not set directly any more; see the
    -- migration below (this table predates the column) and
    -- server/index.js's applyPostUpdate, which recomputes 'posted' on
    -- every write rather than trusting a client-supplied value.
    reseaux_posted     TEXT NOT NULL DEFAULT '{}',
    co_post_member_id  INTEGER REFERENCES members(id) ON DELETE SET NULL,
    -- Raw text as typed in the legacy sheet (an @handle, a plain name, or
    -- blank) — kept alongside co_post_member_id so nothing is lost when
    -- the import script can't confidently resolve it to a real member;
    -- the UI falls back to showing this when co_post_member_id is NULL.
    co_post_raw        TEXT NOT NULL DEFAULT '',
    texte              TEXT NOT NULL DEFAULT '',
    lien               TEXT NOT NULL DEFAULT '',
    posted             INTEGER NOT NULL DEFAULT 0,
    updated_by         INTEGER REFERENCES members(id) ON DELETE SET NULL,
    created_at         TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS')),
    updated_at         TEXT NOT NULL DEFAULT (to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD HH24:MI:SS'))
  );

  CREATE INDEX IF NOT EXISTS idx_com_season ON com_posts(season);
  CREATE INDEX IF NOT EXISTS idx_com_date   ON com_posts(post_date);

  -- Generic key/value store: ICS url, Nextcloud minutes link, and every
  -- fixed outbound link (Canva folders, Heyzine, Fedica, podcast RSS,
  -- serotine.fr) the spec asks for. Same shape as achievement-vault's
  -- 'settings' table.
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  -- Editable link lists for the two "page with multiple links" sections
  -- (Documents Technique, Podcast).
  CREATE TABLE IF NOT EXISTS link_lists (
    id         SERIAL PRIMARY KEY,
    section    TEXT NOT NULL,
    title      TEXT NOT NULL DEFAULT '',
    url        TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_links_section ON link_lists(section);

  -- Mises à niveau d'une base existante (sans effet sur une base neuve : les colonnes sont déjà dans le CREATE TABLE).
  -- Défaut de l'état audio d'un nouvel article : « Pas commencé » (avant : « Non »). N'affecte que les nouveaux articles.
  ALTER TABLE bohr_articles ALTER COLUMN etat_audio SET DEFAULT 'Pas commencé';
  ALTER TABLE bohr_articles ADD COLUMN IF NOT EXISTS mise_en_page_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
  ALTER TABLE bohr_articles ADD COLUMN IF NOT EXISTS illustration_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
  ALTER TABLE bohr_articles ADD COLUMN IF NOT EXISTS communication_id INTEGER REFERENCES members(id) ON DELETE SET NULL;
  -- Membre archivé (2026-10-12) : plus proposé dans les listes de choix ni désignable, mais garde son nom partout où il figure déjà.
  ALTER TABLE members ADD COLUMN IF NOT EXISTS archived INTEGER NOT NULL DEFAULT 0;
  -- Lien du podcast (2026-10-12), ouvert à tout membre.
  ALTER TABLE bohr_articles ADD COLUMN IF NOT EXISTS podcast_url TEXT NOT NULL DEFAULT '';
  -- Validations Correction / Sources (2026-10-12) : une étape faite / pas faite + qui l'a validée (distinct du/de la responsable correction_id / source_id).
  ALTER TABLE bohr_articles ADD COLUMN IF NOT EXISTS correction_valide INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bohr_articles ADD COLUMN IF NOT EXISTS correction_valide_par INTEGER REFERENCES members(id) ON DELETE SET NULL;
  ALTER TABLE bohr_articles ADD COLUMN IF NOT EXISTS source_valide INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE bohr_articles ADD COLUMN IF NOT EXISTS source_valide_par INTEGER REFERENCES members(id) ON DELETE SET NULL;
`);


// Vocabulaire « État audio » (podcast) du 2026-10-09 : « En cours » → « Enregistré », « Finito » → « Posté », + « Traité » entre les deux.
// Migration idempotente, une seule transaction, AVANT le semis des valeurs par défaut (sinon le semis recréerait des doublons) :
// elle renomme sur place (les couleurs et l'ordre choisis par les admins sont gardés) et réécrit les articles qui portaient
// l'ancienne valeur. Sans effet sur une base neuve ou déjà migrée. Réversible à la main (mêmes UPDATE dans l'autre sens).
await db.transaction(async () => {
  for (const [from, to] of [["En cours", "Enregistré"], ["Finito", "Posté"]]) {
    const hasOld = await db.prepare(`SELECT 1 AS x FROM bohr_status_options WHERE field = 'etat_audio' AND value = ?`).get(from);
    const hasNew = await db.prepare(`SELECT 1 AS x FROM bohr_status_options WHERE field = 'etat_audio' AND value = ?`).get(to);
    if (hasOld && !hasNew) {
      await db.prepare(`UPDATE bohr_status_options SET value = ? WHERE field = 'etat_audio' AND value = ?`).run(to, from);
    }
    const n = (await db.prepare(`UPDATE bohr_articles SET etat_audio = ? WHERE etat_audio = ?`).run(to, from)).changes;
    if (n) console.log(`Podcast : ${n} article(s) « ${from} » → « ${to} »`);
  }
  const posted = await db.prepare(`SELECT sort_order, color FROM bohr_status_options WHERE field = 'etat_audio' AND value = 'Posté'`).get();
  const traite = await db.prepare(`SELECT 1 AS x FROM bohr_status_options WHERE field = 'etat_audio' AND value = 'Traité'`).get();
  if (posted && !traite) {
    // « Traité » prend la place de « Posté » dans l'ordre des colonnes, « Posté » passe après.
    await db.prepare(`UPDATE bohr_status_options SET sort_order = sort_order + 1 WHERE field = 'etat_audio' AND value = 'Posté'`).run();
    await db.prepare(`INSERT INTO bohr_status_options (field, value, color, sort_order) VALUES ('etat_audio', 'Traité', '#6a8fa5', ?)`).run(posted.sort_order);
  }
})();

// Demande du 2026-10-09 : l'audio est « Pas commencé » par défaut. Les articles qui portaient encore l'ancien défaut « Non » sont
// remis à « Pas commencé » UNE SEULE FOIS (marqueur dans `settings`) : après ça, un « Non » posé volontairement (pas de version audio)
// n'est plus jamais réécrit au redémarrage.
await db.transaction(async () => {
  const done = await db.prepare(`SELECT 1 AS x FROM settings WHERE key = 'migration_audio_non_vers_pas_commence'`).get();
  if (done) return;
  const n = (await db.prepare(`UPDATE bohr_articles SET etat_audio = 'Pas commencé' WHERE etat_audio = 'Non'`).run()).changes;
  await db.prepare(`INSERT INTO settings (key, value) VALUES ('migration_audio_non_vers_pas_commence', ?)`).run(new Date().toISOString());
  if (n) console.log(`Audio : ${n} article(s) « Non » → « Pas commencé »`);
})();

// État « Illustrations » : ajout de « Non » (pas d'illustration prévue) en première colonne. Idempotent ; sur une base existante,
// décale les autres options d'un cran pour que « Non » passe avant « Pas commencé » sans toucher aux couleurs choisies par les admins.
await db.transaction(async () => {
  const has = await db.prepare(`SELECT 1 AS x FROM bohr_status_options WHERE field = 'illustrations' AND value = 'Non'`).get();
  const any = await db.prepare(`SELECT MIN(sort_order) AS m FROM bohr_status_options WHERE field = 'illustrations'`).get();
  if (!has && any?.m != null) {
    await db.prepare(`UPDATE bohr_status_options SET sort_order = sort_order + 1 WHERE field = 'illustrations'`).run();
    await db.prepare(`INSERT INTO bohr_status_options (field, value, color, sort_order) VALUES ('illustrations', 'Non', '#c9c9c9', ?)`).run(any.m);
  }
})();

// Seed default status vocab + colors on first run only (ON CONFLICT DO NOTHING —
// once an admin edits these via the app, re-running the server must never
// stomp their changes back to the defaults).
const seedStatus = db.prepare(
  `INSERT INTO bohr_status_options (field, value, color, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`
);
const seedStatuses = db.transaction(async (rows) => {
  for (const [i, r] of rows.entries()) await seedStatus.run(r.field, r.value, r.color, i);
});
await seedStatuses([
  // Rédaction — matches the sheet's real dropdown list (data validation),
  // colors chosen to read clearly against the Sérotine palette (see
  // shared/theme.js): grey = not started, amber = in progress, blue =
  // awaiting a pass, green = done, red = trouble.
  { field: "etat_redaction", value: "Pas commencé", color: "#9aa5b1" },
  { field: "etat_redaction", value: "En cours", color: "#edaf55" },
  { field: "etat_redaction", value: "Relisez moi", color: "#6a8fa5" },
  { field: "etat_redaction", value: "Finito", color: "#4caf6b" },
  { field: "etat_redaction", value: "Annulé", color: "#b0413e" },
  { field: "etat_redaction", value: "Retard", color: "#c0392b" },
  // Mise en page / illustrations share the same 4-value vocab in the sheet.
  { field: "etat_mise_en_page", value: "Pas commencé", color: "#9aa5b1" },
  { field: "etat_mise_en_page", value: "En cours", color: "#edaf55" },
  { field: "etat_mise_en_page", value: "A valider", color: "#6a8fa5" },
  { field: "etat_mise_en_page", value: "Finito", color: "#4caf6b" },
  { field: "illustrations", value: "Non", color: "#c9c9c9" }, // pas d'illustration prévue (ajouté le 2026-10-09)
  { field: "illustrations", value: "Pas commencé", color: "#9aa5b1" },
  { field: "illustrations", value: "En cours", color: "#edaf55" },
  { field: "illustrations", value: "A valider", color: "#6a8fa5" },
  { field: "illustrations", value: "Finito", color: "#4caf6b" },
  // Audio
  // Podcast (vocabulaire du 2026-10-09) : Non → Pas commencé → Enregistré (ex « En cours ») → Traité → Posté (ex « Finito »).
  { field: "etat_audio", value: "Non", color: "#c9c9c9" },
  { field: "etat_audio", value: "Pas commencé", color: "#9aa5b1" },
  { field: "etat_audio", value: "Enregistré", color: "#edaf55" },
  { field: "etat_audio", value: "Traité", color: "#6a8fa5" },
  { field: "etat_audio", value: "Posté", color: "#4caf6b" },
  // Communication RS
  { field: "communication_rs", value: "Non", color: "#c9c9c9" },
  { field: "communication_rs", value: "Thread Pas commencé", color: "#9aa5b1" },
  { field: "communication_rs", value: "Carrousel Pas commencé", color: "#9aa5b1" },
  { field: "communication_rs", value: "Thread En cours", color: "#edaf55" },
  { field: "communication_rs", value: "Carrousel En cours", color: "#edaf55" },
  { field: "communication_rs", value: "Thread Finito", color: "#6a8fa5" },
  { field: "communication_rs", value: "Carrousel Finito", color: "#6a8fa5" },
  { field: "communication_rs", value: "Thread Posté", color: "#4caf6b" },
  { field: "communication_rs", value: "Carrousel Posté", color: "#4caf6b" },
  // Concept (article type) — no real "progress" meaning, colors just
  // differentiate the tag visually.
  { field: "concept", value: "Article actu", color: "#435c6e" },
  { field: "concept", value: "Article court", color: "#6a8fa5" },
  { field: "concept", value: "Article long", color: "#2d4255" },
  { field: "concept", value: "Jeux", color: "#edaf55" },
  { field: "concept", value: "Poème", color: "#d181aa" },
  { field: "concept", value: "Série d'Article", color: "#5274ea" },
  { field: "concept", value: "Photo", color: "#69c27d" },
]);

const seedTopic = db.prepare(`INSERT INTO topics (name, color) VALUES (?, ?) ON CONFLICT DO NOTHING`);
const seedTopics = db.transaction(async (rows) => {
  for (const r of rows) await seedTopic.run(r.name, r.color);
});
// From the real "Membres" sheet's Thématiques/color columns.
await seedTopics([
  { name: "Thermodynamique", color: "#bc3113" },
  { name: "Jeux", color: "#69c27d" },
  { name: "Astronomie", color: "#5274ea" },
  { name: "Neuroscience", color: "#dbb648" },
  { name: "Biologie", color: "#d181aa" },
  { name: "Esprit critique", color: "#9f8383" },
  { name: "Sociologie", color: "#d25353" },
  { name: "Psychologie", color: "#c5d89d" },
]);

const seedSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT DO NOTHING`);
const seedSettings = db.transaction(async (rows) => {
  for (const [key, value] of rows) await seedSetting.run(key, value);
});
await seedSettings([
  ["ics_url", ""],
  ["minutes_url", ""],
  ["mise_en_page_canva_url", ""],
  ["mise_en_page_canva_embed_url", ""],
  ["heyzine_url", ""],
  ["comm_canva_url", ""],
  ["fedica_url", ""],
  ["podcast_rss_url", ""],
  ["serotine_site_url", "https://serotine.fr"],
  // Seeded once from .env (if set) so a fresh install still works with
  // nothing but .env.example filled in; from then on these live here and
  // are editable from Administration without a restart — see auth.js's
  // header comment for the full story of why these two specifically moved
  // from env-only to DB-backed.
  ["discord_role_id", process.env.DISCORD_ROLE_ID || ""],
]);


// ---------------------------------------------------------------------
// Sauvegardes — pg_dump (format custom) dans data/backups/, restauration par pg_restore.
// Le conteneur embarque postgresql-client (voir Dockerfile). Une sauvegarde automatique par jour
// au démarrage (14 conservées) ; les manuelles et « pre-restore » ne sont jamais élaguées.
// Garde-fou en plus : le compose.yaml de la stack ne remplace pas ~/backup_stacks.sh.
// ---------------------------------------------------------------------

function pgEnv() {
  const u = new URL(process.env.DATABASE_URL || "postgres://serotine:serotine@localhost:5432/serotine");
  return {
    ...process.env,
    PGHOST: u.hostname,
    PGPORT: u.port || "5432",
    PGUSER: decodeURIComponent(u.username),
    PGPASSWORD: decodeURIComponent(u.password),
    PGDATABASE: u.pathname.slice(1),
  };
}

function runTool(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env: pgEnv() });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} a échoué (${code}) : ${err.trim()}`))));
  });
}

function backupFileName(reason, when = new Date()) {
  const stamp = when.toISOString().slice(0, 10); // YYYY-MM-DD
  const time = when.toISOString().slice(11, 19).replace(/:/g, ""); // HHMMSS
  return `serotine-app-${reason}-${stamp}-${time}.dump`;
}

async function createBackup(reason) {
  mkdirSync(BACKUPS_DIR, { recursive: true });
  const dest = join(BACKUPS_DIR, backupFileName(reason));
  await runTool("pg_dump", ["-Fc", "-f", dest]);
  return dest;
}

function pruneAutoBackups() {
  const files = readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith("serotine-app-auto-") && f.endsWith(".dump"))
    .map((f) => ({ path: join(BACKUPS_DIR, f), mtime: statSync(join(BACKUPS_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const f of files.slice(MAX_AUTO_BACKUPS)) unlinkSync(f.path);
}

/** Appelé une fois au démarrage ; une seule sauvegarde auto par jour (un redémarrage n'en recrée pas). */
export async function runStartupBackupIfNeeded() {
  mkdirSync(BACKUPS_DIR, { recursive: true });
  const todayStamp = new Date().toISOString().slice(0, 10);
  if (readdirSync(BACKUPS_DIR).some((f) => f.startsWith(`serotine-app-auto-${todayStamp}`))) return;
  await createBackup("auto");
  pruneAutoBackups();
}

export async function createBackupNow(reason = "manual") {
  return createBackup(reason);
}

export function listBackups() {
  mkdirSync(BACKUPS_DIR, { recursive: true });
  return readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith(".dump"))
    .map((f) => {
      const s = statSync(join(BACKUPS_DIR, f));
      return { name: f, size: s.size, mtime: s.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Restaure une sauvegarde par-dessus la base courante (tout-ou-rien : --single-transaction).
 * Prend d'abord un instantané « pre-restore » : une restauration n'a pas d'annulation autrement.
 */
export async function restoreBackup(name) {
  if (!/^[\w.-]+\.dump$/.test(name)) throw new Error("Nom de sauvegarde invalide");
  const src = join(BACKUPS_DIR, name);
  if (!existsSync(src)) throw new Error("Backup not found");
  await createBackup("pre-restore");
  await runTool("pg_restore", ["--clean", "--if-exists", "--single-transaction", "--no-owner", "-d", pgEnv().PGDATABASE, src]);
}

export default db;
export { BACKUPS_DIR };

# Serotine App — Project Hub

Private, Discord-role-gated project hub for the Sérotine webzine team
(association AurorAlpes — see the public site, a separate, unrelated
codebase at [Serotine_fork](../Serotine_fork) / serotine.fr). Express +
PostgreSQL (`pg`, private `db` service of `compose.yaml`) API, React + Vite frontend.
**Migrated from SQLite to Postgres on 2026-10-09** and moved into the `topinambours`
repo — read `_architecture/serotine_app.md` first; wherever the sections below say
"SQLite", `better-sqlite3`, `db.backup()` or "in-memory session store", the current
reality is `server/db.js` (async compat layer over `pg`), `pg_dump` backups and
`connect-pg-simple` sessions. All `db.prepare(...)` calls must be `await`ed.

Status: built 2026-09-15 from the original spec + the two real legacy
spreadsheets, then substantially reworked the same day in a live
post-launch pass (icon rail, Font Awesome icons throughout, corrected
brand colors, Notion-style database views, a Bohr kanban board,
column-group toggles, self-service relecture/correction/source/
enregistrement/montage, a Discord-role-driven admin flag, admin-linkable
Discord IDs, a Plan de Communication calendar view, and two real bugs
caught while the user was live-testing — see the dated sections below).

## CURRENT STATE (2026-10-09) — read this first, it supersedes older sections below

Everything below this section was written in the SQLite era (2026-09-15) and is kept as history of *why* things are the way they are. Where it says SQLite / `better-sqlite3` /
`db.backup()` / in-memory sessions / « + Moi » self-claim columns / « Communication RS » it is out of date; this section wins. Architecture context: `_architecture/serotine_app.md` (topinambours repo).

### Running it
- **Server:** `compose.yaml` = `serotine_app` (Node, bound to `192.168.1.26:8093` → `3101`, the Cloudflare tunnel target for `serotine.auroralpes.com`) + `serotine_db` (private Postgres 16, only on `serotine_app_net`) on networks `proxy_net` and `core_db_net`.
  The DB service is **not** called `db`: on `core_db_net` the name `db` also resolves to core_db's own database (found by testing: « password authentication failed »). Secrets in `.env` (never committed): see `.env.example`.
- **On your computer:** `docker compose -f compose.dev.yaml up -d` (Postgres on 127.0.0.1:55433), put `DATABASE_URL=postgres://serotine:dev-local-only@127.0.0.1:55433/serotine` in `.env`, `npm install`, `npm run dev` (http://localhost:5174).
  Without `COREDB_URL`/`COREDB_JWT_SECRET` the member directory is off and a Discord-role fallback (settings `discord_role_id`, env `DISCORD_GUILD_ID`) gates access instead — development only.
- **Real data move (once):** `python3 scripts/export-sqlite-to-json.py old.db > export.json`, then `EXPORT_JSON=export.json node scripts/migrate-sqlite-to-pg.js --dry-run` and again without `--dry-run`
  (one transaction, refuses a non-empty target, ids kept, counts compared). In Docker: run it from the `serotine_app` image on `serotine_app_net` (scripts are in the image).
- **Checking a running instance:** `BASE_URL=… COOKIE='connect.sid=…' node scripts/smoke-test.mjs` (33 checks: reads, article/post lifecycle, the 7 roles, vocabularies, derived « posté », 401 without session). Use a **test** database.
  A session for tests = a row in the `session` table signed with `SESSION_SECRET` (`cookie-signature`); hit `/auth/login` once first so the table exists.

### Local test setup (what was used on 2026-10-09) and how to stop it
- Database: `docker compose -f compose.dev.yaml up -d` / `down` (the data volume `serotine_app_serotine_dev_pgdata` survives `down`; `docker volume rm` it to wipe — it holds a COPY of the real team data, keep it private). App: `npm run dev` (kill the whole tree: `concurrently`, `nodemon`, `vite`).
- `.env` (gitignored) held a copy of the old app's Discord credentials + `DATABASE_URL`; delete it when not testing. Fake sessions for tests = a row in `session` signed with `SESSION_SECRET`.
- Never leave test containers/networks behind: the full Docker rehearsal (compose + a throwaway core_db) is described in `_architecture/serotine_app.md` « Vérifications faites ».
- `npm test` = pure-function unit tests (`tests/`); `scripts/smoke-test.mjs` = API check of a running instance.

### Data layer rules
- `server/db.js` exposes an **async** layer that looks like better-sqlite3 (`db.prepare(sql).get/all/run`, `db.transaction(fn)`): **always `await`**. It translates `?`/`@name`, `INSERT OR IGNORE`, `datetime('now')`;
  `.run()` of an INSERT returns `{ lastInsertRowid }`. Columns keep their old types (text dates `YYYY-MM-DD HH:MM:SS`, 0/1 booleans, JSON in text) so the API/front did not change.
- **Upgrade statements for an existing database live at the END of the schema block** (after every `CREATE TABLE`) — putting an `ALTER TABLE bohr_articles` before it once made a brand-new database refuse to start.
  After touching `db.js`, test a fresh database too: `createdb x; DATABASE_URL=…/x node -e "import('./server/db.js')"`.
- **Startup migrations (idempotent, one transaction each):** podcast/audio vocabulary rename (En cours→Enregistré, Finito→Posté, + Traité); « Non » added to the illustration vocabulary; audio default « Pas commencé »
  (column default altered; existing « Non » articles converted **once**, guarded by the `settings` key `migration_audio_non_vers_pas_commence`, hidden from the API); responsibility columns `mise_en_page_id`, `illustration_id`, `communication_id`; `members.core_member_id`.
- Article/post lists use `loadLookups()` (members, topic colours, relecteurs, article titles loaded once per request) — no per-row queries. Relecteurs are listed by member id.

### Access (decided 2026-10-09 — supersedes the Discord-role gate and the Discord-role-driven C2R sync described in the old sections)
- **Identification = a connection method; Discord is the only one for now** (provisional, before the association's OIDC; same Discord app as the other tools). Discord only says WHO the person is: scope `identify`, **no guild/role is read**, `DISCORD_GUILD_ID` is not needed.
- **Access = registered in the Sérotine project in `core_db`** (`server/coredb.js`, view `members.serotine_members_view`, JWT role `role_serotine_app`): yes → in; no, or directory unreachable / secret wrong → refused (fail closed). `members.core_member_id` links the private profile to core_db. `GET /api/members/core-sync` (admin) lists who would be refused.
- **Access tags, updated 2026-10-09 — a single selector, read at login from the private profile:** **C2R** (`members.is_admin`, column name historical) unlocks C2R-only Bohr fields (now always on — no more "admin mode" toggle), Administration, the team view of « À faire », Statistiques — but **not** Mise en page/Podcast/Communication on its own. Three **pôle tags** (`members.roles`, JSON array: `mise_en_page`/`podcast`/`communication`) each unlock the matching section, independent of C2R. **Super admin** (`members.is_super_admin`, implies C2R, invariant enforced server-side too) is a tier above C2R for 3 narrowed actions: editing the links/images at the top of each page (`LinkSettingsEditor`, `EditableLinkList`, and the same settings keys in Administration), "Se connecter en tant que" (impersonation, logged in `impersonation_log`), and granting/revoking the Super Admin tag itself.
  All of this is managed **only** in Administration → Membres & Crédits, `MemberTags` component — a single row of toggle chips (C2R / Mise en page / Podcast / Communication / Super Admin), not separate checkboxes. No Discord role drives any of it any more (`discord_c2r_role_id` / `DISCORD_C2R_ROLE_ID` removed, the leftover `discord_c2r_role_id` setting deleted 2026-10-09). Bootstrap: if nobody is in the committee yet, the first person to log in joins it; same principle for the very first super admin (any C2R member can designate them while the tag is held by nobody).
- **Fallback (development only, no `core_db`)**: the old check — Discord role `discord_role_id` on server `DISCORD_GUILD_ID` (scope `guilds.members.read` requested only in that mode). `/auth/me` returns `accessMode`: `"directory"` or `"discord-role"` (Administration shows the role field only in the second).
- Checked by `scripts/check-login-access.mjs` (Discord and core_db simulated, base de TEST): committee member, simple member, new person, person known to the tool but not in the project, directory down, zero guild calls.
- **Someone who leaves the Sérotine project (decided 2026-10-09): the app never breaks, and they are no longer *used*.** Nothing is deleted or rewritten: their profile, credits and every old article/post/relecture that carries their name stay as they are (and keep displaying).
  What changes (`activeDiscordIds()` / `isActiveMember()` in `server/coredb.js`, cached 60 s): every member summary carries `active` (false = Discord ID no longer in the project directory). **Effects:** they can no longer log in (access check, unchanged);
  they are no longer **offered** in `MemberPicker` / `MemberSelect` (kept visible, in italics, where they are already the value: « Alexandre G. (ancien·ne) »); the server refuses a **new** designation of them (author, the 7 roles, a new relecteur, co-post → HTTP 400
  « n'est plus inscrit·e au projet Sérotine… », `assertMembersActive`) while **keeping what exists** (re-sending an article or a relecture list that already contains them is accepted; clearing them is always allowed); « À faire → Toute l'équipe » tags their remaining tasks « n'est plus au projet » (so an admin can reassign) ; Administration → Membres shows « plus au projet ».
  Imported profiles **without a Discord ID** (spreadsheet placeholders) stay selectable (we can't tell). **Fail-open on purpose for this read** (unlike login): directory unreachable → last known list, or everybody active if never read; an **empty** project is treated as unknown (probably a misconfiguration) rather than deactivating the whole team.
- Sessions are stored in Postgres (`connect-pg-simple`) and last **4 h, absolute** (bounds access after someone leaves the project). `BEHIND_HTTPS_PROXY=1` trusts the tunnel's proxy header.

### Screens and behaviour added since the original build
- **Phone (≤ 900 px):** the two side panes are drawers (closed by default, 44 px buttons, backdrop, nav with labels, selecting closes it); 16 px inputs, ≥ 36–44 px touch targets, `100dvh`, safe-area insets, no page-level horizontal scroll (checked at 390 px).
- **« À faire »** (`Todo.jsx`, rules in `src/lib/todo.js`): (1) articles still in rédaction with fewer than `MIN_RELECTEURS` = 3 relecteurs, urgent first, « Je relis » / « Me retirer »; (2) a member's pending tasks (default me, selector for others);
  (3) admins only: « Toute l'équipe — tâches en attente » **grouped by article** (Bohr order). Pending = rédaction/relecture/correction/sources while état rédaction ∉ {Finito, Annulé}; mise en page while ≠ Finito; illustration while ∉ {Finito, Non};
  enregistrement while audio = Pas commencé; montage while audio ∈ {Pas commencé, Enregistré}; communication while no linked post or a linked post not posted.
- **Responsibilities:** seven single-person roles per article — Correction, Sources, Mise en page, Illustration, Enregistrement, Montage, Communication (columns `correction_id`, `source_id`, `mise_en_page_id`, `illustration_id`, `enregistrement_id`, `montage_id`, `communication_id`).
  **Not shown in the list view.** Each **Kanban card** shows the roles of its current step (`ROLES[].phase` in `src/lib/roles.js`: Rédaction → Correction + Sources; Mise en page → Mise en page; Audio → Enregistrement + Montage; Illustration → Illustration)
  as `Role : <MemberPicker>` — `+ ajouter` becomes a text search with suggestions, one person per role (click the name to change, ✕ to clear). Any logged-in member can assign anyone (the server never restricted these fields).
  **The Communication role has no Kanban step, so it cannot currently be set from the UI** (existing values are kept and counted in « À faire »). `MemberPicker.jsx` is also used by `RelectureEditor` (admin-mode relecteurs, multiple).
- **Kanban steps:** Rédaction, Mise en page, Audio (Non → Pas commencé → Enregistré → Traité → Posté; recording and editing are one step), Illustration (Non → Pas commencé → En cours → A valider → Finito). Pages Mise en page and Podcast embed their step's board (Podcast: audio; Mise en page: mise en page + « Sujets en illustration »).
- **Plan de com « Texte »:** a 3-line preview button opening a modal with a local draft (saved only on « Enregistrer »; Esc/Annuler/✕ discard, with a confirmation if edited).
- **Tableau de Bohr « Communication » column:** each linked post shows its **date** (`dd/mm/yyyy`, « Sans date »), sorted; title + réseaux in the tooltip. Tried and dropped at the user's request: grouping rows by thématique, extra column gaps, a « Responsables » window, separate recording/montage steps.
- **Right pane:** only the next **4** events are shown (`MAX_EVENTS` in `RightPane.jsx`). Below them, « Compte-rendu de réunion » is a single plain link to `minutes_url` (Admin setting) — no WebDAV connection to Nextcloud, no page listing.
  **Decided 2026-10-09:** the app never talks to Nextcloud itself; whether the link opens for a given person is entirely Nextcloud's own access control (a public Collective share link, or the person's own Nextcloud login), not something Sérotine App checks or mediates.
  (An earlier version read the Collective's page list over WebDAV with a dedicated Nextcloud account — dropped in favour of the plain link, before this ever ran against a real Nextcloud.)
- **Statistics export PROTOTYPE (admins, Statistiques page → « Exporter des statistiques », `StatsExport.jsx`):** read-only, official APIs, nothing stored except the Instagram token.
  **Brevo:** API v3 `GET /emailCampaigns?type=classic&status=sent&statistics=globalStats` (`server/brevo-stats.js`, `GET /api/stats/brevo`); key = the one saved for newsletter sending (server-side; never in responses/errors);
  one flat row per campaign (+ open/click rates) → 5 headline tiles, `LineChart.jsx` (open + click rate per campaign, one % axis, dataviz palette slots 1-2 via `--viz-1/--viz-2` in light and dark, 2 px lines, ≥ 8 px markers,
  legend + direct end label, crosshair tooltip, « Voir le tableau »; a missing rate breaks the line instead of drawing 0), a `BarChart` of delivered e-mails, preview table, CSV (`BrevoCharts.jsx`).
  **Instagram** (replaces the earlier Fedica CSV prototype — Fedica has no public API that could be found, see registry): official **Instagram API with Instagram Login** (`graph.instagram.com`, `server/instagram-stats.js`), a professional account and a long-lived
  **user access token** (permissions `instagram_business_basic` + `instagram_business_manage_insights`) generated in the association's Meta app. Admin flow in `InstagramStats.jsx`: paste token → verified with `GET /me` before saving
  (`PUT /api/instagram`; stored in `settings` as `instagram_access_token`, hidden from `/api/settings`, never returned) → « Charger » (`GET /api/stats/instagram`: `/me` + latest 30 posts + per-post `/insights`, **sequential**) → tiles, engagement-rate line chart, reach bar chart, table, CSV;
  « Renouveler le jeton » (`POST /api/instagram/refresh`, +60 days, shows the expiry date), « Déconnecter ». Insights are requested with the full metric list first, then a minimal list if Meta refuses (the exact metric names allowed vary by media type and over time — **unverified on the real account**);
  likes/comments always come from the media list, every other measure is `null` (never an invented 0) when Meta doesn't give it. Token goes to Meta as `access_token`; it never appears in logs or errors (unit-tested). `INSTAGRAM_API_HOST` only exists to point tests at a stub.
  **All three formats (Brevo response, Instagram insights) come from documentation, not from real answers of your accounts** — compare with the real services (`tests/brevo-stats.test.mjs`, `tests/instagram-stats.test.mjs` hold the assumed shapes). Unit tests: `npm test` (node:test, 8 tests).
- **Perf:** sections other than Tableau de Bohr are `React.lazy` chunks (main JS 229 → 187 kB); hashed `/assets/*` cached for a year, `index.html` `no-cache`.

### Known gaps / not verified
- Real Discord login (OAuth against Discord) has only been exercised with Discord replaced by a stub; the directory check and session logic around it were tested against a real core_db, and the new access rules (project registration, committee) with simulated Discord/core_db.
- Browser testing was Chromium (desktop + 390 px emulation), not a real phone or Safari/Firefox; native date picker and drag-and-drop between Kanban columns were not exercised on touch.
- A session already open when someone leaves the project lasts up to 4 h.

## Access control

- **Discord OAuth2, gated on one specific role in one specific guild** —
  not just "logged in with Discord." `server/auth.js` does a plain OAuth2
  Authorization Code flow (`identify guilds.members.read` scopes, no bot),
  fetches `/users/@me/guilds/{guild}/member`, and checks
  `DISCORD_ROLE_ID` is in the returned `roles` array. Nothing is stored
  from the token beyond the resulting `members` row — no bot, no stored
  access/refresh token.
- **"C2R" (the editorial committee) isn't a second Discord role — it's a
  member flag, `is_admin`.** The spreadsheet's grey "modifiable only by
  C2R" cells map to `C2R_ONLY_FIELDS` in `server/index.js`: a non-admin's
  `PUT`/`POST` on `/api/bohr/articles` silently drops those keys from what
  gets written (merge-then-validate style, not a 403) so a contributor can
  still update their article's subject/topic/concept/état-rédaction in the
  same request that also happens to include (and thus no-ops) a
  C2R-only field. `is_admin` also gates Administration (statuses, topics,
  settings, link lists, other members' credit fields) and Bohr's
  production-tracking fields — one flag, two related meanings, both
  "trusted to touch the stuff regular contributors shouldn't." As of the
  post-launch pass below, `C2R_ONLY_FIELDS` also covers `issueLabel`/
  `issueMonth`/`issueOrder` (which magazine an article is "cut into") —
  confirmed by re-checking the source spreadsheet's actual cell fill on
  column A, which does carry the same grey C2R-only formatting the other
  restricted columns do.
- **`is_admin` is necessary but not sufficient to edit C2R-only fields —
  the admin also has to have flipped on "admin mode" in the topbar.**
  `App.jsx`'s `adminMode` state is a pure **display** toggle (`useState`,
  not persisted), shown only when `user.isAdmin`, off by default even for
  an admin — the point is that browsing the board day-to-day reads the
  same simplified way for an admin as for everyone else, and the C2R
  editing surface only appears when deliberately asked for. `BohrBoard`
  computes `editAsAdmin = isAdmin && adminMode` and uses that (not bare
  `isAdmin`) for every C2R-only control's disabled/grey state. **This is a
  UI convenience, not a second security boundary** — the server still only
  ever checks real `is_admin` (via `req.session.user.isAdmin`, set at
  login); an admin with admin-mode off could still write a C2R field by
  calling the API directly, same as always. If another section grows an
  analogous "admin can, but shouldn't by default" surface, thread
  `adminMode` down to it the same way rather than inventing a second
  toggle.
- **`is_admin` can optionally be driven by a second Discord role,
  `DISCORD_C2R_ROLE_ID`** — distinct from `DISCORD_ROLE_ID` (which only
  gates entry to the app at all). When set, every login re-syncs
  `is_admin` from whether that role is currently present — Discord's role
  membership becomes the real source of truth, re-checked and overwritten
  on every login, not a one-time grant. When `DISCORD_C2R_ROLE_ID` is
  unset (the default — no second Discord role required to get started),
  admin status falls back to the original bootstrap scheme below.
  `authStatus()` exposes `c2rRoleManaged` to the client; when true,
  Administration → Membres shows the Admin (C2R) checkbox as disabled
  (`c2rRoleManaged` prop threaded App.jsx → AdminPanel → MembersTab) with
  a note that it's Discord-managed, rather than letting an admin toggle
  something a future login will just silently overwrite anyway.
- **The first real Discord login ever becomes an admin, to bootstrap —
  only relevant when `DISCORD_C2R_ROLE_ID` isn't set.** `auth.js`'s
  `upsertMemberFromDiscord` checks `SELECT 1 FROM members WHERE
  discord_id IS NOT NULL` before inserting — if that's empty (no real
  login has ever happened; legacy-import placeholders don't count, their
  `discord_id` is NULL), the new member is admin. Every admin after that
  is promoted by an existing one via Administration → Membres.
- **An admin can link a member straight to a Discord ID by hand, without
  waiting for that person to log in first** — Administration → Membres'
  "ID Discord" column is a real editable text input (`PUT
  /api/members/:id { discordId }`), not just a read-only display of
  whatever a login happened to cache. A blank string means "unlink", not
  "store an empty string" — `discord_id` is nullable *and* `UNIQUE`, so
  the server explicitly maps `""` to `null` rather than letting two
  members both hold `""` collide on that constraint; a genuine duplicate
  ID attempt gets a real 409 with a message, not an unhandled 500 (a
  first version let the raw `SqliteError` reach the client as a blank
  failure).
- Session store is the default in-memory `express-session` store —
  intentional for a small internal team: a server restart just means
  everyone logs in again, and it avoids a session-DB dependency for what's
  a handful of concurrent users. Revisit if this ever needs to survive
  restarts without re-login.

## Layout

Three-pane shell (`src/App.jsx`), each side pane collapsible via the
floating `‹›` toggle buttons:

- **Left** — section nav (Tableau de Bohr, Mise en page, Plan de
  Communication, Podcast, Documents Technique, + Administration when
  admin), Sérotine.fr pinned at the bottom as a plain external link.
- **Middle** — whichever section is open.
- **Right** — upcoming events (parsed from a subscribed ICS URL, set in
  Administration) and a link to the latest meeting minutes (a fixed
  Nextcloud Collective URL, also set in Administration — Collective is a
  live collaborative doc, so this is just a link, nothing is fetched or
  mirrored).

## People: one table does double duty

`members` (`server/db.js`) is **both** the "replace person tags with
Discord IDs" identity table **and** the Credit database the spec asked
for as if it were separate — `credit_linkedin`/`credit_instagram`/
`credit_bluesky`/`collab_instagram` are just columns on the same row as
`display_name`/`discord_id`, not a joined second table. They're
fundamentally the same entity (one person), and a real join would always
be 1:1 anyway, so this was a deliberate simplification over what the spec
described as two databases.

- `discord_id` is **nullable**. A legacy spreadsheet row imports against a
  placeholder member (`discord_id NULL`, `legacy_aliases` recording what
  the sheet called them); a real login later creates or matches a member
  by `discord_id`. `POST /api/members/:id/merge-into/:targetId` (admin
  only) reassigns every FK reference (`bohr_articles.author_id` /
  `correction_id` / `source_id` / `enregistrement_id` / `montage_id`,
  `bohr_article_relecture.member_id`, `com_posts.co_post_member_id`) from
  one member to another and deletes the source — how a placeholder
  "Hector" gets folded into the real Discord-linked Hector once he's
  logged in once. This is the actual mechanism behind "replace person tags
  by Discord ID": it's not a one-time migration, it's an ongoing admin
  action as real people log in.
- `com_posts.co_post_raw` keeps the original text (an `@handle`, a plain
  name, or blank) alongside the resolved `co_post_member_id` — the import
  script only resolves a co-post credit to a real member when it exactly
  matches an existing member's name, and Instagram-handle-style values
  (`@troy_3.14`) essentially never do (they were never in the canonical
  12-name Bohr member list to begin with). The UI falls back to showing
  `co_post_raw` when there's no resolved member, so nothing typed in the
  original sheet is lost even when it can't be auto-linked.

## Tableau de Bohr ↔ Plan de Communication link

`com_posts.linked_article_id` is a real FK to `bohr_articles`, not just
matching text. `server/import-legacy.js`'s `findLinkedArticleId` resolves
it at import time by splitting a post's `item_title` on its first `:`
(e.g. `"Sérotine#5.1 : 7 Merveilles du ciel nocturne - 2"` → guess `"7
Merveilles du ciel nocturne - 2"`) and matching that against
`bohr_articles.subject`, case/whitespace-insensitively — only linking when
that matches **exactly one** article. A handful of real posts don't
resolve this way (a renamed article, ambiguous duplicates like Saison 2's
two "Vieille tortue" entries — one prose, one poem) and are left
unlinked; `ComPlan.jsx` always shows a plain `<select>` so any post can be
linked (or relinked) by hand regardless of whether the import guessed
right.

## Tableau de Bohr: ordering, issues, column groups, kanban, self-service

Added in a post-launch pass, after using the first build:

- **Seasons (and issues within a season) sort most-recent-first, not
  alphabetically.** `seasonSortKey()` in `BohrBoard.jsx` extracts the
  trailing number from a season name ("Saison 3" → 3) and sorts
  descending; the season chip row and the default-selected season both
  follow this. Issues within a season sort the same way (by
  `issueOrder` descending) — **except** the unassigned bucket (see next
  point), which always floats to the very top regardless of its numeric
  order, since it's the most immediately actionable pile, not "the
  oldest thing."
- **"À découper" is a real, reused bucket, not a placeholder string I
  invented** — it's the exact label the real Saison 3 sheet used for a
  subject not yet slotted into an issue (literally "to be cut [into a
  magazine]", i.e. not yet laid out). A freshly-created article defaults
  to it; an admin can move any article back to it via the issue-assign
  select (see below). Matched on the literal string `UNASSIGNED_LABEL` in
  `BohrBoard.jsx` — an article with a blank `issueLabel` (the DB
  default) also displays under this bucket via a `||` fallback, so a
  non-admin-created article (which can't set `issueLabel` at all — see
  next point) still lands somewhere sensible.
- **Which issue an article is "cut into" is a C2R-only, admin-mode-only
  action** — `issueLabel`/`issueMonth`/`issueOrder` were added to
  `C2R_ONLY_FIELDS` (server-enforced, not just hidden in the UI — see
  "Access control" above) after confirming the source spreadsheet's
  column A actually carried the same grey C2R-only fill as the other
  restricted columns. `BohrBoard.jsx` only renders the "Numéro" assignment
  `<select>` when `editAsAdmin` — picking an existing issue re-uses its
  `issueOrder`/`issueMonth`; "+ Nouveau numéro…" prompts for a label and
  month and assigns the next `issueOrder`; "À découper" clears it back to
  unassigned.
- **"+ Nouvelle saison" is admin-mode-only and purely additive** — it
  adds a name to local `extraSeasons` state (so the chip exists and is
  selectable immediately) without creating any article; the season only
  becomes "real" (shows up from `articles` data itself) once the first
  article is actually created under it via "+ Nouveau sujet".
- **Relecture (proofreader list) has two entirely different controls
  depending on admin mode**, not one control with disabled inputs like
  every other C2R field: `editAsAdmin` gets the full multi-member
  `RelectureEditor` picker (assign/unassign anyone); everyone else gets
  `RelectureQuickJoin` — the existing names as plain read-only tags, plus
  a single self-toggle button that adds/removes **only the current
  logged-in user** (`currentUserId`, threaded down from `App.jsx`'s
  session). This is deliberately not server-enforced the way C2R fields
  are — `PUT .../relecture` still accepts any member ID list from any
  logged-in user — the restriction to "just yourself" is a UI affordance
  (a contributor volunteering to proofread something), not a permissions
  boundary; nothing currently stops a determined non-admin from calling
  the API directly to add someone else, same "admin mode is UI, not
  security" caveat as the section above.
- **Correction/Source/Enregistrement/Montage now work "like Relecture"**
  (a later, explicit ask) — these four single-assignee fields were moved
  *out* of `C2R_ONLY_FIELDS` entirely (both client and server), and get
  the same admin-mode split as relecture: `editAsAdmin` shows the full
  `MemberSelect` (assign anyone); everyone else gets
  `SingleAssignQuickJoin.jsx` — "+ Moi" to claim the role when it's empty,
  a read-only tag when someone already holds it, and a "remove" (✕) only
  when the assignee *is* the current user. Unlike relecture there's no
  "steal it from someone else" path even at the UI layer (relecture's
  quick-join can't remove someone else either, but a list can always grow;
  a single-assignee field would otherwise let a second self-claim silently
  overwrite the first). Ligne éditoriale, Comité sci, État mise en page,
  Illustrations, Pages, État audio, and the issue-assignment fields stay
  genuinely C2R-only, admin-mode-gated, and server-enforced — this change
  was scoped to exactly the four fields asked about, not "make everything
  self-service."
- **The five column groups (Rédaction/Relecture/Mise en page/Version
  audio/Communication) are the real spreadsheet's own row-2 group
  headers**, now independently toggleable — `GROUPS` in `BohrBoard.jsx`,
  a toolbar row of chips, all on by default. "Couv" (the sheet's sixth
  group, just the issue-label column) isn't in this list since its one
  field is already the admin-mode-only "Numéro" control, not a
  show/hide-able content column. **Sujet is always shown even though the
  real sheet's own "Rédaction" group includes it** — hiding the one
  column that identifies which article a row even *is* would make every
  other group meaningless to look at on its own; a deliberate deviation
  from a byte-for-byte replica of the sheet's grouping. `colCount` (for
  the issue-heading row's `colSpan`) is computed from which groups are
  currently visible, not a fixed constant.
- **A Trello-style kanban view, one board per "step"** — `BohrKanban.jsx`,
  toggled alongside the existing table ("Liste") via a view switch in the
  toolbar. "Steps" map to the board's own status fields
  (`etat_redaction`/`etat_mise_en_page`/`etat_audio`/`communication_rs`),
  selected one at a time rather than showing all four boards stacked at
  once — tried mentally against the real column counts and four
  simultaneous boards read as too busy to actually use. Columns come from
  that field's live `bohr_status_options` vocab (whatever an admin has
  configured in "Statuts & couleurs" — nothing hardcoded). Plain HTML5
  drag-and-drop (`draggable`, `dataTransfer`, `onDrop`) — no library —
  matching this codebase's own established preference for hand-rolled
  interaction code over a new dependency (see `RegionMap.jsx`'s pan/zoom
  in the sibling achievement-vault project for the same philosophy).
  Dropping a card onto a column just calls the same `patch()` the table
  view uses, with that field set to the column's value. **A C2R step
  (Mise en page, Audio) still respects admin mode** — `canDrag = phase.c2r
  ? editAsAdmin : true` — a card in a restricted step's board just isn't
  draggable (and reads slightly dimmed) until admin mode is on, same
  boundary as the table view's disabled inputs, not a separate one.

## Editable vocab + colors

Both `bohr_status_options` (per select-field vocab: `etat_redaction`,
`etat_mise_en_page`, `illustrations`, `etat_audio`, `communication_rs`,
`concept`) and `topics` (thématique scientifique → color) are real,
admin-editable tables seeded once from the real spreadsheet's data
validation lists / `Membres` sheet color columns — not hardcoded enums.
`StatusSelect.jsx` renders a field's current options as a colored
`<select>`; Administration → "Statuts & couleurs" is where an admin adds/
renames/recolors/removes options. This directly answers the spec's "I
should be able to modify each part of the database (color, items etc.)"
— it's a real admin screen, not a code change, same spirit as
achievement-vault's per-category chart colors being generated/configurable
rather than hand-picked constants.

## Settings & link lists

`settings` is a generic key/value table (ICS url, minutes url, and every
fixed outbound link — Canva ×2, Heyzine, Fedica, podcast RSS, serotine.fr)
— same shape as achievement-vault's own `settings` table for its GitHub
PAT / Steam key. `link_lists` is a small editable `{section, title, url,
sort_order}` table backing the two "page of multiple links" sections
(Documents Technique, Podcast's platform links) — `EditableLinkList.jsx`
is the one component both sections reuse.

Every section that owns just one or two of these settings (Mise en page,
Plan de Communication, Podcast) gets a small inline "✎" editor
(`LinkSettingsEditor.jsx`) rather than sending an admin to Administration
for a two-field change — Administration's "Liens & paramètres" tab still
has the full list, for everything at once.

## Newsletter builder

`public/tools/newsletter-builder.html` is a pre-built, fully self-contained
single-file tool (its own dark theme, drag-and-drop block editor, export-
to-downloadable-.html) — not something this app generates or talks to.
It's served as a static file (Vite's `public/` → `dist/` root convention,
same as achievement-vault's PWA icons) and surfaced in Plan de
Communication two ways: an inline toggleable `<iframe>` (same pattern as
achievement-vault's `Character.jsx` embedding the LPC sprite generator —
mounted only when opened, not on every page load) and a plain "open in a
new tab" link for anyone who'd rather not use the iframe. No backend
involvement at all; it reaches into no API of this app.

## Plan de Communication: ordering, hide-posted, calendar view

Same post-launch pass:

- **Seasons sort most-recent-first here too**, reusing `BohrBoard.jsx`'s
  own sort key rather than a second copy — pulled out into
  `src/lib/seasons.js` (`seasonSortKey`/`sortSeasonsDesc`) specifically so
  the two components can't drift out of sync on what "most recent" means.
- **"Masquer les postés" defaults to ON, not off** — a toolbar toggle
  (`hidePosted` state) filtering `posted` rows out of the list. Chosen as
  the default because this view is a *working* planning list first; once
  something's posted it's done, and a todo-shaped tool reads better
  showing what's left over showing everything ever posted. Toggle it off
  to see history.
- **`ComCalendar.jsx` is a second, independent view of the exact same
  `rows`** (season + hide-posted already applied) — a month grid,
  Monday-start, 42 cells padded with adjacent months' days, same shape as
  achievement-vault's `Agenda.jsx` (the only prior art for a calendar view
  in this codebase's sibling project). Each day shows up to 3 posts as
  small colored pills (color by `kind`: post/issue_release/reminder) with
  a "+N" overflow; clicking a pill or the overflow opens a modal with the
  full day's posts. Every day cell has its own small "+" that calls
  `addPost(iso)` pre-filled with that date — same "seed the date, stay in
  create mode" pattern as achievement-vault's Agenda "+" per day. Posts
  with no `postDate` at all can't place on the grid, so they're listed
  separately below it ("Non datés") rather than silently dropped, same
  fallback achievement-vault's own Agenda already established for this
  exact situation.

## Legacy import (`server/import-legacy.js`)

One-time, re-run-guarded (refuses if `bohr_articles`/`com_posts` already
have rows) migration of the two real spreadsheets, copied into
`data/legacy/` (gitignored — real internal data, not something to commit).
Both files were reverse-engineered by dumping real cells/data-validation/
conditional-formatting directly (no fixed export schema from either tool)
before writing the parser — worth knowing if this ever needs re-running
against a changed sheet:

- **Tableau de Bohr's "Saison 1" sheet uses a completely different, older
  14-column layout than "Saison 2"/"Saison 3"'s 18-column one** — no
  separate topic/ligne-éditoriale/correction/source columns (just one
  "Conseil scientifique" bool), different column letters for everything
  else, and data starts one row earlier (row 3, not row 4). `import-
  legacy.js`'s `COLUMN_PROFILES` map holds one explicit profile per
  layout rather than assuming a single shared one — a first pass that
  assumed Saison 2/3's layout everywhere silently invented junk "members"
  out of Saison 1's Concept/Illustrations/Pages columns (e.g. "Jeux",
  "Finito", "12" all became fake member names) before this was caught by
  actually inspecting the imported `members` table, not just the article
  count.
- **Plan de Communication's `Planning saison N` sheets have no fixed row
  grammar** — month-name rows, weekday-letter header rows, real day-number
  post rows, and a handful of legend/reminder rows (`Retard`, `Reunion`,
  `Sortie de numero`) all share the same columns. The import loop tracks
  "current month" as state, skips weekday-letter rows outright, and
  starts scanning at row 3 specifically to skip the sheet's own column-
  header row (row 1) — an earlier pass started at row 1 and imported the
  header text itself (`"Réseaux"`, `"Item"`, `"Co-post"`) as a fake post.
- **Two documented, evidence-based assumptions**, not guesses made up
  front: (1) both communication-planning seasons are treated as calendar
  year 2026 (`SEASON_YEAR` in `import-legacy.js`) — inferred from Tableau
  de Bohr's own "#5 / Mai 2026" issue label lining up with Saison 2's
  first post, plus this project's own site-design memory recording
  "Sérotine #5 · Saison 2 · Mai 2026"; (2) "Planning copie", a third sheet
  in the com-planning workbook, is skipped entirely — it's a redundant
  full-calendar-grid rendering of the exact same rows already in
  "Planning saison 1/2", confirmed by inspecting its cells before deciding
  to skip it, not assumed from the name alone.
- **A member name that isn't in the canonical 12-name `Membres` list still
  creates a member row** rather than being dropped or erroring — e.g.
  Saison 1 used bare first names ("Léo", "Isaora", "Romain") distinct from
  the canonical full names ("Léo B.", "Léo D."), and there's no way to
  tell from the sheet alone which "Léo" is meant. Best-effort, same as
  every "paste an export" import in achievement-vault: capture the data,
  let an admin merge/fix it by hand afterward (see the merge mechanism
  above) rather than silently losing it or guessing wrong.
- **A settings-seeding bug caught during route testing, not code review**:
  `db.js`'s default-settings seed data was written as `[key, value]`
  arrays but the seeding transaction destructured them as `r.key`/
  `r.value` (an object-shaped access, copy-pasted from the topics/status-
  options seeders which *are* array-of-objects) — silently seeded nothing
  (`undefined`/`undefined` bound and ignored), so `GET /api/settings`
  returned `{}` on a fresh database instead of the 8 expected empty-string
  keys. Caught by actually exercising the routes end-to-end against a
  throwaway DB (a temporary fake-admin-session copy of `index.js`) rather
  than trusting that "the code looks right" — fixed by destructuring the
  tuple (`([key, value]) => ...`) instead of property access.

## Design system: colors, icons, Notion-style tables

Also reworked in the post-launch pass, after the first build shipped with
a wrong palette that was never actually checked against the live site:

- **The color tokens were wrong for most of this app's life — pulled from
  a months-old, already-stale memory note instead of the real
  stylesheet.** `serotine.fr` was rebranded (violet/green) since that note
  was written; `shared/theme.js` and `src/styles.css`'s `:root` block
  were re-pulled directly from `Serotine_fork/css/serotine.css` and the
  CSS variables **renamed** (`--bleu`/`--bleu-clair`/`--bleu-fonce`/
  `--ambre` → `--violet`/`--violet-clair`/`--violet-fonce`/`--vert`), not
  just re-valued — leaving them named "bleu"/"ambre" while pointing at
  violet/green hexes would have been exactly the kind of stale, misleading
  reference that caused this in the first place. `--violet-fonce` has no
  real equivalent on the actual site (its palette has no dark shade —
  everything sits on white paper); it's a darkened `--violet`, computed
  here specifically so this app's dark sidebar rail has enough contrast
  for white text. Body font switched to the site's own `Verdana, Geneva,
  Tahoma, sans-serif`. **Lesson for next time: when a CLAUDE.md or memory
  note claims to be "pulled from the real site," re-verify against the
  actual current file before use — don't propagate an old note's claim
  without checking, especially for anything that can silently drift
  (a rebrand, a renamed variable) between when the note was written and
  when it's read.**
- **Every emoji in the UI was replaced with Font Awesome** (`@fortawesome/
  fontawesome-free`, imported once in `main.jsx`), requested explicitly.
  Plain `<i className="fa-solid fa-…">` tags throughout, not the
  `<FontAwesomeIcon>` React wrapper package — avoids an extra dependency
  for what's otherwise a static icon reference. Discord's own login button
  uses `fa-brands fa-discord` (Discord's real brand color/mark stays
  Discord's, unrelated to this app's own palette — a third-party product,
  not something to reskin).
- **The left nav is an icon-only rail with a *custom* CSS hover
  tooltip**, not the native `title` attribute — `title` is slow to
  appear, unstyled, and would double up with a custom one. `data-tooltip`
  + a `::after` pseudo-element in `styles.css` renders a small styled
  label to the right of each icon on `:hover`. This needed
  `.pane-left`'s `overflow` to become conditional: `visible` normally (so
  the tooltip can escape the 64px rail to the right) but `hidden` again
  in the `.collapsed` state (where the rail is `width: 0` and needs the
  clip to actually hide its contents) — a blanket `overflow: hidden`
  would have clipped every tooltip invisible.
- **The brand mark above the nav icons was removed; the Sérotine.fr link
  at the bottom uses the real site favicon, not a generic globe icon** —
  `Serotine_fork/media/favicon.svg` (the exact file the real site's own
  `<link rel="icon">` points at) copied into `public/media/serotine-mark.svg`
  and rendered as an `<img>`, tinted white via a CSS `filter` (an `<img>`
  can't use `color` the way an inline SVG or icon font glyph can) with a
  green-ish hover filter approximating `--vert`. Not a pixel-exact color
  match — filter-based recoloring of a raster/`<img>`-rendered SVG is
  inherently approximate — but close enough for a small nav-rail hover
  state.
- **The "database" table views read like a Notion database now, not a
  generic admin grid** — flat white surface (no card drop-shadow, no
  zebra striping), thin grid lines on *both* axes (`border-right` per
  cell, not just `border-bottom` — Notion's table view draws column
  dividers too), a light grey header/group-row band instead of a colored
  one, and a quiet neutral row-hover instead of an accent tint. Status/
  select values render as `.chip` — a light, tinted "property chip"
  (`background: color-mix(in srgb, var(--chip-color) 16%, var(--surface))`)
  with solid-color text and a small (not fully pill-shaped) 6px radius,
  replacing the earlier solid-color/white-text pill design. `StatusSelect.jsx`
  and `ComCalendar.jsx`'s day pills both consume the same `.chip` class.

## Bugs caught while the user was live-testing (2026-09-15)

Both found and fixed the same session they were introduced, by actually
exercising the feature end-to-end (a throwaway-DB route test, in both
cases) rather than trusting the code looked right on inspection:

- **Merging two members could crash with a UNIQUE constraint error** when
  the member being deleted (the "source") had a `discord_id` set and the
  survivor (the "target") didn't — the merge transaction tried to copy
  `source.discord_id` onto the target *before* deleting the source row,
  so both rows briefly held the same value simultaneously, which SQLite's
  `UNIQUE` constraint rejects immediately (not deferred to end-of-
  transaction). Fixed by reordering: `DELETE FROM members WHERE id = ?`
  (the source) now runs *before* the fill-in-blanks `UPDATE` on the
  target, not after.
- **A merge used to silently discard the deleted member's own data** —
  credit fields (LinkedIn/Instagram/Bluesky/collab flag) and their
  Discord ID. The original merge only ever reassigned *FK references to*
  the source member (which article they authored, etc.); nothing copied
  the source row's *own* columns onto the target before deleting it. This
  surfaced as real reported data loss: merging in what a user reasonably
  expected to be "the placeholder disappears into the real member"
  direction, but picking the wrong row to start from (the merge button
  lives on the row that *gets deleted*, and "Fusionner dans…" read
  ambiguously about which direction that was) silently erased a real
  member's LinkedIn/Discord link. Fixed two ways at once: (1) the merge
  route now fills in any blank target field from the source before
  deleting it (never overwrites something the target already has), so no
  merge in *either* direction loses data any more; (2) the confirm dialog
  now names both members explicitly ("« X » sera SUPPRIMÉ et fusionné
  dans « Y », qui sera conservé") instead of "le membre choisi", and the
  column header changed from "Fusionner dans…" to "Cette ligne disparaît,
  fusionnée dans…" so the direction isn't just inferred from a vague verb.

## Ongoing xlsm re-import, Bohr-phase embeds, Discord roles, Stats

A third post-launch batch, same day:

- **`server/bohr-parser.js` is the column-layout knowledge extracted out
  of `import-legacy.js`, shared with a new ongoing route.** Requested as
  "for now" — an interim workflow, since some editing still happens in
  the spreadsheet in parallel with the app. `parseBohrSheet`/
  `parseBohrWorkbook` return plain rows (member fields as raw name
  strings, not resolved ids) with zero DB/member-resolution coupling;
  `import-legacy.js` was refactored to call it rather than keep its own
  copy, and re-verified against the real files afterward (still exactly
  28 articles / 92 posts — a regression check, not just "it still runs").
  `POST /api/bohr/import-xlsm` (`server/index.js`, `requireAdmin`) reads
  an uploaded `.xlsx`/`.xlsm` (same OOXML format, read identically) and
  **upserts** rather than blindly inserting — a re-import's fields win on
  a match, which only makes sense as an admin action, with a client-side
  confirm spelling that out before it runs. `express.json`'s body limit
  was bumped to 20mb (default 100kb) since the file travels as base64 in
  the JSON body — no `multer`/file-upload dependency added for this.
  - **The upsert's match key was a real bug, caught by testing against
    the actual file instead of trusting the design**: matching on
    `(season, subject)` alone collapses two *genuinely different*
    articles that happen to share a generic title in different issues of
    the same season — the real workbook has "Reportage photo" in both
    Saison 2 #5 and #6. A first test import into an empty DB produced 27
    created + 1 "update" instead of 28 created, silently merging the
    earlier issue's row into the later one. Fixed by matching on
    `(season, issue_label, subject)` instead; re-verified: 28 created / 0
    updated on a fresh import, 0 created / 28 updated on re-importing the
    same file.
- **Mise en page and Podcast each embed a live slice of Tableau de
  Bohr, not just outbound links** — `BohrPhasePanel.jsx` (self-contained:
  fetches its own Bohr data, own season selector) wraps `BohrKanban.jsx`
  locked to one phase via a new `fixedPhase` prop (hides the phase-switcher
  chips when set). Mise en page shows the `etatMiseEnPage` step, Podcast
  the `etatAudio` step — "display the mise en page / audio part of
  Tableau de Bohr" taken literally: these sections are now a working list
  of what needs doing in that step, not just a page of links. Needed
  `adminMode` threaded down to both (`App.jsx` → `MiseEnPage`/`Podcast` →
  `BohrPhasePanel` → `BohrKanban`), which they didn't receive before.
- **Mise en page can embed one public Canva design directly** (distinct
  setting, `mise_en_page_canva_embed_url`, from the existing Canva
  *folder* link) — a 16:9 `<iframe>` using Canva's own convention that a
  public design's share URL with `?embed` (or `&embed` if it already has
  a query string) appended works directly as an embed src, no special
  Canva-side embed-code generation needed for a public design.
- **Plan de Communication's Réseaux column explodes into one table row
  per network choice**, not one crowded cell of checkboxes — every other
  field (date/type/item/co-post/texte/lien/posted/delete) uses `rowSpan`
  across that post's network rows so it's only shown (and only editable)
  once per post, not duplicated per row. A post with zero networks still
  gets exactly one row (so it's never dropped from the table), and the
  last row of each post's group carries a small "+ réseau" `<select>` of
  whichever networks aren't picked yet.
- **Which Discord role gates entry, and which grants "C2R" admin status,
  moved from env-only to DB-backed settings** (`discord_role_id`/
  `discord_c2r_role_id`), editable from Administration → Liens &
  paramètres with no server restart — requested explicitly ("choose from
  inside the app", not by editing `.env` on the server). `.env`'s
  `DISCORD_ROLE_ID`/`DISCORD_C2R_ROLE_ID` now only *seed* the `settings`
  table once on first run (`db.js`'s existing `INSERT OR IGNORE` seed
  pattern); `auth.js` reads both from the DB on every login from then on,
  never from `process.env` again. `DISCORD_CLIENT_ID`/`_SECRET`/
  `DISCORD_REDIRECT_URI`/`DISCORD_GUILD_ID` stayed env-only on purpose —
  those describe the Discord *application* registration itself, not
  something that benefits from live in-app editing the way a role
  selection does. `authStatus()`'s "configured" check now looks at the DB
  value for the access role too, not just env vars, so it stays accurate
  after a change made purely through Administration.
- **A new Statistiques page (visible to everyone, not admin-only)** sits
  in the nav right before Administration's gear icon — per-season summary
  cards (subject/page/post counts), status breakdowns per Bohr field
  (reusing the same `bohr_status_options` colors as everywhere else), top
  contributors by subject count, and two CSV downloads per season
  (`src/lib/csv.js`, pure client-side, no server route — same "build from
  what's already fetched" approach achievement-vault's own CSV export
  uses): the season's Tableau de Bohr rows, and its Plan de Communication
  posts.
- **Every "+ Moi" self-claim button (Relecture, Correction, Source,
  Enregistrement, Montage) shares one plain, borderless style** (`.btn-plain`
  in `styles.css`) instead of each having grown its own inline
  `link-btn secondary` styling — a bordered pill repeated down a whole
  table column read as too heavy; `white-space: nowrap` keeps "+ Moi" on
  one line regardless of how narrow its cell gets, which a bare
  `<button>` with icon + text wasn't guaranteed to do.

## Color chips, the subject link, Stats, and a hardening pass

A fourth post-launch batch, same day:

- **Every status/network "chip" color was silently missing — a real bug,
  not a design choice.** They were built on `background: color-mix(in
  srgb, var(--chip-color) 16%, var(--surface))`, and `color-mix()` is
  recent enough (Chrome 111+/Firefox 113+/Safari 16.4+) that on anything
  older the whole `background`/`border` declaration is invalid CSS —
  silently dropped, no error, just a colorless chip. Fixed by computing
  the tint in JS instead (`src/lib/color.js`'s `hexToRgb`/`tint`/
  `chipStyle`, plain `rgba()` strings, supported everywhere `rgba()` is)
  — `.chip`/`.cal-pill` in `styles.css` now only hold layout, no color;
  every caller (`StatusSelect.jsx`, `ComPlan.jsx`'s réseau chips,
  `ComCalendar.jsx`'s day pills and modal chip) sets color via
  `chipStyle()` inline instead of a `--chip-color` custom property.
  **Same pass, a second real gap**: the table ("database") view's
  Thématique cell never actually showed the topic's configured color at
  all (only the Kanban card view did) — a plain `input list="topic-list"`
  with nothing else. Fixed with a small `.color-swatch` next to the input,
  same swatch style used elsewhere in this app.
- **`subjectUrl` (the Sujet column's optional link) could only ever be
  set by the legacy import** — reading a real cell hyperlink from the
  original spreadsheet — even though it's a normal, already-editable
  (non-C2R) column server-side. There was simply no UI for it. Fixed with
  a small pen/link icon button next to Sujet (`editSubjectUrl` in
  `BohrBoard.jsx`) that prompts for a URL and `patch()`es it — same
  `window.prompt()` convention already used for the issue-assignment
  "+ Nouveau numéro…" flow.
- **Statistiques dropped the per-field "état" breakdown bars (État
  rédaction/Mise en page/Audio/Communication RS)** — those reflect
  workflow *state*, which wasn't what was wanted from a stats page — and
  gained real content-shaped numbers instead: pages per article type
  (`concept`) **per magazine** (a real matrix table — rows are the
  season's issues, columns are whichever concepts actually appear,
  reusing the same "À découper isn't a real issue" exclusion `BohrBoard`
  already established), articles **and** pages per thématique (one
  combined list, using each topic's real configured color), a contributor
  count folded into the overview card, posts-per-réseau (now including
  "Newsletter" — see below), and a genuine **all-time** card (every
  season summed: total magazines/articles/pages) alongside the existing
  per-season one.
- **"Newsletter" is a real réseau option now**, added to `ComPlan.jsx`'s
  `RESEAUX_OPTIONS` — the "split one row per réseau" table and the new
  Stats posts-per-réseau breakdown both pick it up automatically, no
  separate wiring needed for either.
- **A real, unfixed npm vulnerability got closed, prompted by adding a
  live file-upload route that actually exercises it.** `xlsx` (SheetJS)'s
  npm-registry build (`0.18.5`, the newest npm has) carries a known,
  currently-"no fix available" prototype-pollution + ReDoS advisory
  (GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9). That was a latent risk
  before (only ever read two fixed, trusted local files); it became a
  real one once `POST /api/bohr/import-xlsm` started feeding arbitrary
  admin-uploaded file bytes into the same parser. SheetJS's actual fix
  ships from their own CDN, not npm (`package.json`'s `xlsx` dependency
  now points at `https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz` —
  `npm audit` goes from 1 high to 0). **That build changed a real
  behavior**: it no longer auto-detects Node's `fs` — `XLSX.readFile()`
  throws "Cannot access file" until `XLSX.set_fs(fs)` is called first,
  caught by re-running `import-legacy.js` after the swap and watching it
  fail (`server/import-legacy.js` now calls `set_fs` at the top; the
  HTTP route never needed it — `bohr-parser.js`'s `readWorkbookFromBuffer`
  reads an in-memory buffer via `XLSX.read()`, which never touches `fs`).
- **A general hardening pass, prompted by an explicit ask for security/
  optimization suggestions**: `helmet` (security headers — CSP left
  explicitly *off* for now, since a correct one needs real tuning against
  Font Awesome's webfonts + the Canva/newsletter-builder iframes + React's
  inline styles, worth its own pass rather than guessing), `compression`
  (gzip), and `express-rate-limit` on `/auth/login`+`/auth/callback`
  (30/15min — deters automated abuse, generous enough to never bother a
  real login) and on `/api` as a whole (300/min — this app's own UI can
  legitimately fire many quick PATCH calls, sized to never get in the way
  of real use). The session cookie gained `sameSite: "lax"` (real CSRF
  mitigation — a cross-site POST no longer carries it) and `secure:
  "auto"` (only requires HTTPS when the request actually arrived over
  HTTPS, so this still works unchanged on plain-HTTP LAN access today).
  `express.json`'s global body limit dropped from a blanket 20mb back
  down to 1mb — the 20mb ceiling now applies *only* to
  `/api/bohr/import-xlsm` (registered as its own path-scoped parser
  *before* the global one; `express.json()` checks `req._body` and skips
  re-parsing a request the route-specific parser already handled — the
  standard Express pattern for "one route needs a bigger limit than
  everything else," not a hand-rolled workaround). The Canva embed
  `<iframe>` gained an explicit `sandbox` attribute (`allow-scripts
  allow-same-origin allow-popups allow-forms allow-presentation` — exactly
  what Canva's viewer needs, nothing more) as defense-in-depth on an
  admin-supplied URL, even though Administration is already a trusted
  role.

## Fifth pass: charts, backups, a tuned CSP, and réseau-level "posted"

The two follow-ups flagged at the end of the last pass — a tuned CSP and
porting achievement-vault's backup system — plus a round of feature asks,
all the same day:

- **A real Content-Security-Policy, worked out by auditing what this app
  actually loads, not guessed at** — `server/index.js`'s `helmet()` call.
  `script-src 'self'` (one bundled JS file, no inline `<script>`, nothing
  from a CDN — Font Awesome is the npm package, bundled locally).
  `style-src` needs `'unsafe-inline'`: React's `style={{...}}` prop, used
  throughout this codebase, compiles to real inline `style="..."`
  attributes, and there's no practical nonce/hash story for that without a
  much larger refactor — a real, deliberate gap (inline-style injection is
  a smaller attack surface than script injection, but not zero),
  documented rather than silently shipped. `img-src` allows Discord's CDN
  (`ProfileMenu.jsx`'s avatars) and `data:`. `frame-src` allows Canva's
  real domains (not a blanket `https:`) alongside `'self'` (the newsletter
  builder). Verified against a real production build afterward — started
  the server, checked the CSP header, and confirmed the served page's own
  `<script>`/`<link>` tags and static assets actually load clean under it
  — not just "the directives look right on paper."
- **Automatic daily DB backups, ported from achievement-vault** —
  `db.backup()` (the real SQLite Online Backup API, WAL-safe, not a naive
  file copy), once/day on startup (throttled by checking for a file
  already stamped with today's date, so a `node --watch` restart during
  development doesn't spam snapshots), 14 most recent auto-backups kept
  (manual and pre-restore snapshots are never auto-pruned). Administration
  → **Sauvegardes** (a new 4th tab) exposes "Sauvegarder maintenant" and a
  restore button per snapshot, gated behind a genuine two-step `confirm()`
  (not the instant+undo pattern this app uses everywhere else — a restore
  needs a server restart to even take effect, so an undo toast makes no
  sense here, same reasoning achievement-vault documented for its own
  restore). Restoring closes the shared `db` handle, copies the chosen
  backup over `DB_PATH`, clears stale `-wal`/`-shm` sidecars, and exits
  the process after a 200ms delay (long enough for the HTTP response to
  flush first) — there's no safe way to reopen the same exported `db`
  binding every other module in this app already imported by reference,
  so the restored file only takes effect on the next start. Always takes
  a fresh "pre-restore" safety snapshot of whatever's about to be
  overwritten first. **Verified end-to-end against a real throwaway
  server**, not just read for correctness: created a marker row, backed
  up, created a second marker row, restored, confirmed the process
  actually exited, restarted it, and confirmed the second row was gone
  while the first survived — plus a pre-restore snapshot existed on disk.
  **The migration itself needed a backfill, caught before it shipped**:
  `com_posts` predates the new `reseaux_posted` column (see next point),
  so `ALTER TABLE ... ADD COLUMN` defaults every existing row to `'{}'` —
  naively, every row already marked `posted = 1` from real history would
  have silently flipped back to "not posted" the instant anyone edited it
  for an unrelated reason (since `posted` is now derived from
  `reseaux_posted`, which would read as empty). The migration backfills
  `reseaux_posted` for every already-posted row from its existing
  `reseaux` list before anything else touches it — verified against a
  real copy of the production database, not just reasoned through.
- **`posted` on a Plan de Com post is now derived, not a flag anyone sets
  directly** — each réseau line in the exploded table (see the réseau
  row-split from an earlier pass) got its **own** posted checkbox
  (`com_posts.reseaux_posted`, a `{"Insta (Post)": true, ...}` JSON map);
  the old shared "Posté" column is now a disabled/read-only checkbox that
  reflects `posted = every réseau on this post is individually checked`
  (`server/index.js`'s `applyPostUpdate` recomputes it from
  `reseaux`+`reseauxPosted` on **every** write, never trusting a
  client-supplied value — requested explicitly: a post can't read as
  fully "posté" until each of its networks genuinely is). Verified with a
  real request sequence: checking one of two réseaux left `posted: false`;
  checking the second flipped it to `true`.
- **A post's Type is now linked to a standard réseau set** — `post` →
  Insta (Post) + Insta (Story); `issue_release` ("Sortie de numéro") →
  Linkedin + Echoscience + Bluesky (thread) + Newsletter
  (`DEFAULT_RESEAUX_BY_KIND` in `ComPlan.jsx`). This is a **convenience
  default, not a hard restriction** — it only fills in when a post has no
  réseau picked yet (never overwrites a real, already-made choice), and
  the "+ réseau" picker still offers every option, so a genuine exception
  stays one click away. A freshly-created post (which starts as kind
  `post` server-side, so its Type `<select>` never actually fires a
  `change` event on creation) gets the default seeded directly by
  `addPost()` instead of waiting for a change that will never come.
- **Tableau de Bohr's "Communication RS" column is gone, replaced by a
  real cross-reference to Plan de Com's own posts** — it was a second,
  separately-maintained freeform status duplicating (and free to drift
  from) what Plan de Com's posts + their derived `posted` state already
  track properly. `BohrBoard.jsx` now fetches `com_posts` too and builds
  `postsByArticle` (keyed by `linkedArticleId`); the "Communication"
  column shows each linked post as a tag with a ✓/○ icon for its derived
  `posted` state — read-only, since the real editable data lives in Plan
  de Com now, not here. The underlying `communication_rs` DB column and
  its `bohr_status_options` vocab are untouched (no drop/rename path, per
  this app's own additive-columns convention) — just no longer displayed
  or written from the table view; `BohrKanban.jsx`'s "Communication" step
  board was removed for the same reason (nothing left to drag between
  columns).
- **Statistiques gained real pie/donut charts** (`DonutChart.jsx`) for
  every part-to-whole breakdown (articles/pages per thématique,
  contributors, posts per réseau), replacing plain bar lists — and a
  **"Toutes saisons"** toggle in the season-chip toolbar that switches
  every card, table, and chart to every season combined rather than one
  at a time. Built via the dataviz skill's actual procedure, not "add a
  pie chart": a pie/donut is an **all-pairs** categorical form (every
  slice sits beside every other slice, same class as scatter/small-
  multiples) — the skill's validated default palette only clears its
  CVD/contrast gates *pairwise* for its **first three slots** under that
  stricter test, so `DonutChart` always shows at most the top 3
  categories in real color plus a neutral grey "Autres" bucket for the
  rest (sorted so the biggest categories keep their color and the long
  tail folds away) — never a wheel with as many hues as there are rows.
  The 3-slot subset was run through the skill's own
  `validate_palette.js --pairs all` before shipping (PASS on lightness/
  chroma/CVD/normal-vision; a contrast WARN on the green slot, which the
  skill treats as legal *only* with a relief channel — satisfied here
  since the chart's legend always shows real text labels + values, never
  color-alone identity). The `perMagazine` pages-by-concept table stayed
  a table on purpose — it's genuinely two-dimensional (magazine ×
  concept), which a single pie can't represent, and the overview counts
  stayed plain stat tiles per the skill's own "a single headline number
  isn't a one-bar bar chart" rule.
- **Tableau de Bohr's column groups now default to just Rédaction +
  Relecture** (was: all five groups on) — Mise en page/Audio/Communication
  stay one click away via the same toggle chips, just not shown until
  asked for.
- **`AdminPanel.jsx` had a real, already-shipped prop-threading bug,
  caught while adding the Sauvegardes tab**: `c2rRoleManaged` was passed
  in from `App.jsx` but the component's own function signature had
  silently stopped accepting it (and `<MembersTab />` was called with no
  props at all) — likely dropped during an earlier edit to this same
  file. The effect: the "Admin (C2R) est géré par le rôle Discord" notice
  and the disabled-checkbox state in Membres & Crédits never actually
  applied at runtime even when `discord_c2r_role_id` was configured,
  despite every other layer of that feature (server, the setting itself)
  working correctly. Fixed by restoring the prop through both the
  function signature and the `<MembersTab>` call.

## Layout (files)

```
shared/theme.js        ← color tokens pulled from serotine.fr's real, current stylesheet
server/db.js            ← PostgreSQL pool + async « better-sqlite3-like » layer, schema, startup migrations, seed data, pg_dump backups
server/coredb.js        ← reads the Sérotine project members from core_db via PostgREST (role_serotine_app)
server/auth.js          ← Discord OAuth2 flow, role check(s), member upsert, requireAuth/requireAdmin
server/ics.js           ← fetch + parse a subscribed ICS calendar (recurring events expanded, capped window)
server/index.js         ← REST API (see its header comment for the full route list)
server/bohr-parser.js   ← shared Tableau de Bohr sheet-parsing (column layouts, no DB/member coupling)
server/import-legacy.js ← one-time migration from data/legacy/*.xlsx — see "Legacy import" above
scripts/export-sqlite-to-json.py + migrate-sqlite-to-pg.js ← one-time SQLite → Postgres data move; scripts/smoke-test.mjs ← API check of a running instance
data/legacy/             ← gitignored copies of the two source spreadsheets (real internal data)
data/backups/             ← pg_dump snapshots, daily automatic + manual (gitignored)
src/lib/api.js           ← fetch wrapper, one method per route
src/lib/seasons.js       ← shared "most recent season first" sort key (Bohr + Plan de Com)
src/lib/csv.js           ← client-side CSV export (Statistiques page)
src/lib/color.js         ← chip color computation (rgba, not CSS color-mix() — see its section above)
src/App.jsx              ← 3-pane shell, auth gate, admin-mode toggle, section switch
src/lib/todo.js, roles.js, useMediaQuery.js ← « À faire » rules, responsibility roles, phone breakpoint hook
src/components/          ← LeftNav, RightPane, ProfileMenu, BohrBoard, BohrKanban, BohrPhasePanel, ComPlan,
                            ComCalendar, MiseEnPage, Podcast, DocumentsTechniques, Todo, Stats, DonutChart,
                            AdminPanel, StatusSelect, MemberSelect, MemberPicker, RelectureEditor,
                            RelectureQuickJoin, LinkSettingsEditor, EditableLinkList
public/tools/newsletter-builder.html ← pre-built standalone tool, see "Newsletter builder" above
public/media/serotine-mark.svg       ← the real site's own favicon, reused for the nav rail's Sérotine.fr link
```

## Before editing

The database holds the team's real editorial and communication-planning data. Automatic `pg_dump` backups run daily at startup (`data/backups/`) and
Administration → Sauvegardes has « Sauvegarder maintenant » + restore — still take one by hand (or `docker compose exec serotine_db pg_dump -U serotine -Fc serotine > backup.dump`)
right before a schema change or a bulk edit. **Never run `docker compose down -v` on the real stack** (it deletes the data volume).
- **Plan de com: the « Item » column was removed (2026-10-09)** from the table and the column-width settings; `itemTitle` still exists in the data (new posts are « Nouveau post », it titles the Texte window, the calendar pills, the delete confirmation and the Bohr tooltip) but is no longer editable from the table — say so if a title field is wanted elsewhere (e.g. in the Texte window).
- **Bohr columns (2026-10-12):** widths auto-fit to the widest content (measured in `BohrBoard`; admin width settings no longer apply to the Bohr table); one column per group absorbs the remaining space (`flexKey`: Numéro / Podcast / Post lié); Numéro only in the Mise en page group; Version audio has a `podcastUrl` link field (open to everyone).
- **Archive a member (2026-10-12):** Administration → Membres & Crédits has an archive/unarchive button per member (`members.archived`). An archived member counts as inactive (`isActiveMember`): not offered in pickers, server refuses new assignments (`assertMembersActive`, now also when the directory is unknown), but keeps their name where already set and can still log in.
& (2026-10-12):** the Relecture group shows two checkboxes (`correctionValide` / `sourceValide`, any logged-in member can tick) + the name of who ticked (`*_valide_par`). Distinct from the responsable columns `correction_id`/`source_id`.
- **Tableau de Bohr column groups are exclusive (2026-10-09):** exactly one of Rédaction / Relecture / Mise en page / Version audio / Communication is shown at a time (radio behaviour, default Rédaction) — replaces the earlier multi-toggle.
- **Relecteurs: 3 is a minimum, never a maximum (2026-10-09):** nothing in the API or the pickers caps the list. The only thing that got in the way was « À faire » hiding an article once it reached 3 — it now has a checkbox « Afficher aussi les articles qui ont déjà 3 relecteurs ou plus » (`articlesToProofread(articles, { includeComplete })`), with « Je relis » / « Me retirer » still working and a green « ✓ n » counter.

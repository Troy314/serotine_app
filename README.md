# Sérotine — Hub

Private project hub for the Sérotine webzine team. People identify themselves with
Discord (the only connection method for now) and get in only if they are registered in the
*Sérotine* project of the association's member directory; the editorial committee unlocks the reserved parts. Three-pane layout — a collapsible left nav for the project's
sections, a collapsible right pane for upcoming events + the latest
meeting minutes, and the open section in the middle.

See `CLAUDE.md` for the full write-up of how this is built and why.

## 1. Set up the Discord application (only to identify people)

Discord is the only connection method for now. It only tells the app **who** someone is — no server or role is read.

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → your application → **OAuth2**.
   - Copy the **Client ID** and **Client Secret**.
   - Under **Redirects**, add `http://localhost:3101/auth/callback` (or your real address — must match `DISCORD_REDIRECT_URI` exactly).
2. No bot is needed: it's a plain OAuth2 login.

**Who gets in:** someone who has logged in with Discord **and** is registered in the *Sérotine* project of the association's member directory
(`core_db`, set `COREDB_URL` / `COREDB_JWT_SECRET`). **The editorial committee** (comité de rédaction) — who unlock the reserved fields, admin mode and
Administration — is a list kept inside the app (Administration → Membres & Crédits). If nobody is in it yet, the first person to log in joins it.

*Development without `core_db` only:* the old fallback needs `DISCORD_GUILD_ID` (right-click the server → Copy Server ID) and a role ID
(`DISCORD_ROLE_ID`, right-click the role → Copy Role ID); the app then asks Discord for the person's roles.

## 2. Configure

```
cp .env.example .env
```

Fill in `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `DISCORD_REDIRECT_URI` from step 1
(plus `DISCORD_GUILD_ID` / `DISCORD_ROLE_ID` only for the development fallback).
`SESSION_SECRET` is already a real random value; regenerate it if you want
a fresh one.

## 3. Install & run

On your computer (the database is a Postgres in Docker; the app runs with Node 20):

```
docker compose -f compose.dev.yaml up -d      # Postgres on 127.0.0.1:55433
# in .env add:  DATABASE_URL=postgres://serotine:dev-local-only@127.0.0.1:55433/serotine
npm install
npm run dev       # http://localhost:5174 (Vite dev server, proxies API calls to :3101)
```

On the association's server: `docker compose up -d --build` (see `compose.yaml`, the secrets in `.env.example`, and
`_architecture/runbook-mise-en-service-serotine-app.md` in the topinambours repo). Members must also belong to the
« Sérotine » project in the association's member directory (`core_db`) — set `COREDB_URL` / `COREDB_JWT_SECRET`;
without them (development only) the Discord role alone decides.

Unit tests: `npm test`. Check a running instance: `BASE_URL=http://localhost:3101 COOKIE='connect.sid=…' node scripts/smoke-test.mjs` (see its header).

The very first person to log in automatically joins the editorial committee (able to edit the C2R-restricted Tableau de Bohr fields
and reach the Administration screen — see CLAUDE.md's "Access" section). Everyone after that is added by a committee member, from
Administration → Membres & Crédits.

## 4. Import the legacy spreadsheets (optional, one-time)

Two spreadsheets already back this data: `tableau-de-bohr.xlsx` and
`planing-com.xlsx`, copied into `data/legacy/` on 2026-09-15. If you're
starting fresh (or the copies aren't there), drop your own copies in
`data/legacy/` under those exact names and run:

```
npm run import:legacy
```

This only ever inserts — it refuses to run again once `bohr_articles` or
`com_posts` already have rows, to avoid creating duplicates. See
`server/import-legacy.js`'s header comment and CLAUDE.md's "Legacy
import" section for exactly what it does and the two assumptions it
makes (both about which calendar year each communication-planning season
falls in).

## Data

Everything lives in the private PostgreSQL database (`serotine_db` service). Daily `pg_dump` backups land in `data/backups/`
(Administration → Sauvegardes to back up / restore by hand). Moving the old SQLite file over (once):
`python3 scripts/export-sqlite-to-json.py old.db > export.json` then `EXPORT_JSON=export.json node scripts/migrate-sqlite-to-pg.js --dry-run`
(see the script headers; the old file is only read).

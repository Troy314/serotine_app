#!/usr/bin/env python3
"""Exporte la base SQLite d'origine (serotine-app.db) en JSON, pour scripts/migrate-sqlite-to-pg.js.

    python3 scripts/export-sqlite-to-json.py /chemin/serotine-app.db > serotine-export.json

Python 3 et son module `sqlite3` sont présents sur quasiment toute machine Linux : rien à installer. Le fichier est ouvert en LECTURE SEULE
(jamais modifié). L'export contient les vraies données de l'équipe (membres, articles…) : à garder hors de git, à supprimer après la migration.
"""
import json, sqlite3, sys

TABLES = ["members", "topics", "bohr_status_options", "bohr_articles", "bohr_article_relecture", "com_posts", "settings", "link_lists"]

if len(sys.argv) != 2:
    sys.exit(__doc__)
con = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
out = {t: [dict(r) for r in con.execute(f"SELECT * FROM {t}")] for t in TABLES}
json.dump(out, sys.stdout, ensure_ascii=False)
print("Export :", {t: len(rows) for t, rows in out.items()}, file=sys.stderr)

/**
 * import-legacy.js — one-time migration of the two legacy spreadsheets
 * (`data/legacy/tableau-de-bohr.xlsx`, `data/legacy/planing-com.xlsx`)
 * into the app's own PostgreSQL tables. Run with `npm run import:legacy`.
 *
 * This is a best-effort migration, same spirit as every "paste an export"
 * import documented in the sibling achievement-vault project: it's safe
 * to re-run (INSERT OR IGNORE on members/topics; articles/posts are
 * always freshly re-inserted though — see the DELETE-then-reimport note
 * at the bottom), but it isn't byte-for-byte perfect for every historical
 * edge case. Review the result in the app afterward.
 *
 * Column layout for Tableau de Bohr's "Saison N" sheets and Plan de
 * Communication's "Planning saison N" sheets was reverse-engineered from
 * the real files (no fixed schema/export from either tool) — see
 * CLAUDE.md's "Legacy import" section for the reasoning behind each
 * heuristic below, especially the two documented assumptions:
 *   1. Both "Saison 1" and "Saison 2" communication-planning sheets are
 *      assumed to fall in calendar year 2026 (Saison 1 = Sérotine #1-4,
 *      Jan-Apr; Saison 2 = #5-7+, May-Sep), inferred from Tableau de
 *      Bohr's own "#5 / Mai 2026" issue label and Serotine's own site
 *      memory recording "Sérotine #5 - Saison 2 - Mai 2026". If this is
 *      wrong, fix SEASON_YEAR below and re-run.
 *   2. "Planning copie" (a third sheet in the com-planning workbook) is
 *      skipped entirely — it's a redundant full-calendar-grid rendering
 *      of the exact same rows already in "Planning saison 1/2", not a
 *      separate source of data.
 */
import XLSX from "xlsx";
import * as fs from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import db from "./db.js";
import { parseBohrSheet } from "./bohr-parser.js";

// The SheetJS build published to npm auto-detected Node's `fs`; the
// current build (installed straight from SheetJS's own CDN — see
// package.json's xlsx dependency and CLAUDE.md's security notes for why)
// makes that opt-in instead, so `XLSX.readFile` throws "Cannot access
// file" without this. Only needed here (reads real files off disk) — the
// HTTP import route in server/index.js reads an in-memory buffer via
// `XLSX.read()`, which never touches `fs` at all.
XLSX.set_fs(fs);

const here = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = join(here, "..");
const BOHR_PATH = join(APP_ROOT, "data", "legacy", "tableau-de-bohr.xlsx");
const COM_PATH = join(APP_ROOT, "data", "legacy", "planing-com.xlsx");

const SEASON_YEAR = { "Saison 1": 2026, "Saison 2": 2026, "Saison 3": 2026 };
const MONTH_NUMBER = {
  janvier: 1, fevrier: 2, février: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, août: 8, septembre: 9, octobre: 10, novembre: 11,
  decembre: 12, décembre: 12,
};
const MAX_EMPTY_STREAK = 30;

// ------------------------------------------------------------- utilities

function colLetterToIndex(letter) {
  return XLSX.utils.decode_col(letter);
}

function cellAt(ws, colLetter, row1based) {
  const addr = `${colLetter}${row1based}`;
  const cell = ws[addr];
  if (!cell) return { value: null, hyperlink: null };
  return { value: cell.v ?? null, hyperlink: cell.l?.Target || null };
}

function isBlankRow(ws, row1based, cols) {
  return cols.every((c) => cellAt(ws, c, row1based).value == null);
}

function normalizeMonthName(raw) {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  return key in MONTH_NUMBER ? raw.trim() : null;
}

function isWeekdayLetterRow(value) {
  return typeof value === "string" && value.trim().length <= 2 && /^[a-zA-Zéû]{1,2}$/.test(value.trim());
}

// ----------------------------------------------------------- member cache

const memberCache = new Map(); // key: lowercased name -> member row

async function loadExistingMembersIntoCache() {
  for (const row of await db.prepare(`SELECT * FROM members`).all()) {
    const aliases = JSON.parse(row.legacy_aliases || "[]");
    for (const a of [row.display_name, ...aliases]) {
      if (a) memberCache.set(a.trim().toLowerCase(), row);
    }
  }
}

async function resolveMemberByName(rawName) {
  if (rawName != null && typeof rawName !== "string") rawName = String(rawName);
  const name = (rawName || "").trim();
  if (!name || name === "/") return null;
  const key = name.toLowerCase();
  if (memberCache.has(key)) return memberCache.get(key);

  const existing = await db.prepare(`SELECT * FROM members WHERE display_name = ?`).get(name);
  if (existing) {
    memberCache.set(key, existing);
    return existing;
  }
  const info = await await db
    .prepare(`INSERT INTO members (display_name, legacy_aliases) VALUES (?, ?)`)
    .run(name, JSON.stringify([name]));
  const row = await db.prepare(`SELECT * FROM members WHERE id = ?`).get(info.lastInsertRowid);
  memberCache.set(key, row);
  return row;
}

async function seedCanonicalMembers(wb) {
  const ws = wb.Sheets["Membres"];
  if (!ws) return;
  const names = new Set();
  for (let r = 1; r <= 20; r++) {
    for (const col of ["A", "B"]) {
      const v = cellAt(ws, col, r).value;
      if (typeof v === "string" && v.trim() && v.trim() !== "Thématiques") names.add(v.trim());
    }
  }
  for (const name of names) await resolveMemberByName(name);
}

// ------------------------------------------------------- Tableau de Bohr
// Column-layout knowledge (including Saison 1's older 14-column layout)
// now lives in server/bohr-parser.js, shared with the ongoing
// POST /api/bohr/import-xlsm route — parseBohrSheet returns plain rows
// with member fields as raw name strings; resolving those to real member
// rows and inserting stays here, since that part *is* specific to "fresh
// one-time import" (an UPSERT, for the ongoing route, resolves/writes
// differently).

async function importBohrSheet(ws, season) {
  const rows = parseBohrSheet(ws, season);
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
      @enregistrement_id, @montage_id, @communication_rs, @notes)
  `);
  const insertRelecture = await db.prepare(
    `INSERT OR IGNORE INTO bohr_article_relecture (article_id, member_id) VALUES (?, ?)`
  );

  let created = 0;
  for (const r of rows) {
    const author = await resolveMemberByName(r.authorName);
    const correction = await resolveMemberByName(r.correctionName);
    const source = await resolveMemberByName(r.sourceName);
    const enregistrement = await resolveMemberByName(r.enregistrementName);
    const montage = await resolveMemberByName(r.montageName);

    const info = await insert.run({
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
      notes: "",
    });
    created++;

    for (const name of r.relectureNames) {
      const m = await resolveMemberByName(name);
      if (m) await insertRelecture.run(info.lastInsertRowid, m.id);
    }
  }
  return created;
}

async function importBohr() {
  if (!existsSync(BOHR_PATH)) {
    console.log(`(skip) ${BOHR_PATH} not found`);
    return;
  }
  const wb = XLSX.readFile(BOHR_PATH);
  await seedCanonicalMembers(wb);
  let total = 0;
  for (const season of ["Saison 1", "Saison 2", "Saison 3"]) {
    const ws = wb.Sheets[season];
    if (!ws) continue;
    const n = await importBohrSheet(ws, season);
    console.log(`Tableau de Bohr — ${season}: ${n} article(s) imported`);
    total += n;
  }
  return total;
}

// ------------------------------------------------------- Plan de Comm

async function findLinkedArticleId(itemTitle) {
  const idx = itemTitle.search(/\s*:\s*/);
  if (idx === -1) return null;
  const guess = itemTitle.slice(itemTitle.indexOf(":") + 1).trim();
  if (!guess) return null;
  const matches = await await db
    .prepare(`SELECT id FROM bohr_articles WHERE lower(trim(subject)) = lower(?)`)
    .all(guess);
  return matches.length === 1 ? matches[0].id : null;
}

function classifyKind(itemTitle, bMarker) {
  if (/^s[ée]rotine\s*#?\s*\d+\s*$/i.test(itemTitle || "")) return "issue_release";
  if (!itemTitle && ["Retard", "Reunion", "Réunion"].includes(bMarker)) return "reminder";
  return "post";
}

async function importComSheet(ws, season) {
  let currentMonth = "";
  let emptyStreak = 0;
  let created = 0;

  const insert = await db.prepare(`
    INSERT INTO com_posts (
      season, post_date, month_label, day, kind, item_title,
      linked_article_id, reseaux, co_post_member_id, co_post_raw,
      texte, lien, posted
    ) VALUES (@season, @post_date, @month_label, @day, @kind, @item_title,
      @linked_article_id, @reseaux, @co_post_member_id, @co_post_raw,
      @texte, @lien, @posted)
  `);

  const COLS = ["B", "E", "F", "G", "H", "I", "J", "K"];

  // Row 1 is the sheet's own column-header row (G1="Réseaux", H1="Item",
  // I1="Co-post", J1="Texte", K1="Lien") — starting at row 3 (the first
  // month-header cell) skips it; scanning from row 1 once produced a
  // bogus post with item_title "Item" and co_post_raw "Co-post" (the
  // header text itself read as if it were a real row).
  for (let row = 3; row < 1100; row++) {
    const E = cellAt(ws, "E", row).value;
    const B = cellAt(ws, "B", row);

    if (isBlankRow(ws, row, COLS)) {
      emptyStreak++;
      if (emptyStreak >= MAX_EMPTY_STREAK) break;
      continue;
    }
    emptyStreak = 0;

    const monthName = normalizeMonthName(E);
    if (monthName) {
      currentMonth = monthName;
      continue;
    }
    if (isWeekdayLetterRow(E)) continue; // weekday-letter header row, not data

    const day = typeof E === "number" ? Math.round(E) : null;
    const H = cellAt(ws, "H", row).value;
    const G = cellAt(ws, "G", row).value;
    const I = cellAt(ws, "I", row).value;
    const J = cellAt(ws, "J", row).value;
    const K = cellAt(ws, "K", row).value;
    const F = cellAt(ws, "F", row).value;

    const bMarker = typeof B.value === "string" ? B.value.trim() : "";
    const itemTitle = (H || (bMarker && !bMarker.startsWith("http") ? bMarker : "") || "").toString().trim();
    if (!itemTitle && day == null && !K && !bMarker) continue; // nothing usable on this row

    const lien = (K || (bMarker.startsWith("http") ? bMarker : "") || "").toString().trim();
    const reseaux = typeof G === "string" && G.trim() ? G.split(",").map((s) => s.trim()).filter(Boolean) : [];
    const coPostRaw = (I || "").toString().trim();
    const coPostMember = await resolveMemberByName(coPostRaw);

    let postDate = "";
    const monthNum = MONTH_NUMBER[currentMonth.toLowerCase()];
    const year = SEASON_YEAR[season];
    if (day && monthNum && year) {
      postDate = `${year}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }

    const kind = classifyKind(itemTitle, bMarker);
    const linkedArticleId = kind === "post" ? await findLinkedArticleId(itemTitle) : null;

    await insert.run({
      season,
      post_date: postDate,
      month_label: currentMonth,
      day,
      kind,
      item_title: itemTitle,
      linked_article_id: linkedArticleId,
      reseaux: JSON.stringify(reseaux),
      co_post_member_id: coPostMember?.id ?? null,
      co_post_raw: coPostRaw,
      texte: (J || "").toString(),
      lien,
      posted: F === true ? 1 : 0,
    });
    created++;
  }
  return created;
}

async function importCom() {
  if (!existsSync(COM_PATH)) {
    console.log(`(skip) ${COM_PATH} not found`);
    return;
  }
  const wb = XLSX.readFile(COM_PATH);
  const sheetToSeason = { "Planning saison 1": "Saison 1", "Planning saison 2": "Saison 2" };
  let total = 0;
  for (const [sheetName, season] of Object.entries(sheetToSeason)) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const n = await importComSheet(ws, season);
    console.log(`Plan de Communication — ${season}: ${n} post(s) imported`);
    total += n;
  }
  return total;
}

// --------------------------------------------------------------- main

async function run() {
  await loadExistingMembersIntoCache();

  const existingArticles = (await db.prepare(`SELECT COUNT(*) AS n FROM bohr_articles`).get()).n;
  const existingPosts = (await db.prepare(`SELECT COUNT(*) AS n FROM com_posts`).get()).n;
  if (existingArticles > 0 || existingPosts > 0) {
    console.log(
      `Refusing to re-run: bohr_articles has ${existingArticles} row(s), com_posts has ${existingPosts}. ` +
        `This script only ever INSERTs (no de-dup against existing rows) — clear both tables first if you really want to re-import from scratch.`
    );
    process.exit(1);
  }

  console.log("Importing Tableau de Bohr...");
  const bohrCount = await importBohr();
  console.log("Importing Plan de Communication...");
  const comCount = await importCom();
  console.log(`Done. ${bohrCount || 0} article(s), ${comCount || 0} post(s).`);
}

run().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });

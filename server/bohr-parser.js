/**
 * bohr-parser.js — reads a Tableau de Bohr workbook (.xlsx/.xlsm — both
 * are the same underlying OOXML format, `xlsx` reads either identically)
 * into plain parsed rows: no DB writes, no member resolution, just the
 * cell-layout knowledge. Shared by two callers with different needs:
 *   - server/import-legacy.js — the one-time, always-INSERT migration
 *     from the original two legacy spreadsheets.
 *   - the ongoing `POST /api/bohr/import-xlsm` route (server/index.js) —
 *     lets an admin re-import an updated workbook at any time, UPSERTing
 *     by (season, subject) instead of blindly inserting.
 * Column-layout knowledge (including Saison 1's older 14-column layout —
 * see COLUMN_PROFILES) lives in exactly one place so the two callers can
 * never quietly drift apart on how a cell maps to a field.
 */
import XLSX from "xlsx";

// Anciennes valeurs du tableur → vocabulaire podcast du 2026-10-09 (« En cours » = enregistré, « Finito » = posté).
const AUDIO_LEGACY = { "en cours": "Enregistré", finito: "Posté" };
function audioStatus(raw) {
  const v = (raw || "Pas commencé").toString().trim();
  return AUDIO_LEGACY[v.toLowerCase()] || v;
}

export const BOHR_COLS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P", "Q", "R"];
const MAX_EMPTY_STREAK = 30;

// Saison 1's sheet predates the richer 18-column layout Saison 2/3 use —
// see CLAUDE.md's "Legacy import" notes for the full story of how this
// was reverse-engineered from the real file (no fixed export schema from
// either tool).
export const COLUMN_PROFILES = {
  "Saison 1": {
    startRow: 3,
    subject: "B", topic: null, author: "C", concept: "D", etatRedaction: "E",
    relecture: "F", ligneEditoriale: null, correction: null, source: null, comiteSci: "G",
    etatMiseEnPage: "H", illustrations: "I", pages: "J", etatAudio: "K",
    enregistrement: "L", montage: "M", communicationRs: "N",
  },
  DEFAULT: {
    startRow: 4,
    subject: "B", topic: "C", author: "D", concept: "E", etatRedaction: "F",
    relecture: "G", ligneEditoriale: "H", correction: "I", source: "J", comiteSci: "K",
    etatMiseEnPage: "L", illustrations: "M", pages: "N", etatAudio: "O",
    enregistrement: "P", montage: "Q", communicationRs: "R",
  },
};

export function cellAt(ws, colLetter, row1based) {
  const addr = `${colLetter}${row1based}`;
  const cell = ws[addr];
  if (!cell) return { value: null, hyperlink: null };
  return { value: cell.v ?? null, hyperlink: cell.l?.Target || null };
}

export function isBlankRow(ws, row1based, cols) {
  return cols.every((c) => cellAt(ws, c, row1based).value == null);
}

/**
 * Parses one "Saison N" sheet into plain row objects — member fields
 * (`author`, `correction`, `source`, `enregistrement`, `montage`,
 * `relecture`) are raw name strings (or an array of them for relecture),
 * not resolved ids; the caller resolves those against `members` itself,
 * since the two callers want different member-resolution/dedup behavior.
 */
export function parseBohrSheet(ws, season) {
  const cols = COLUMN_PROFILES[season] || COLUMN_PROFILES.DEFAULT;
  const rows = [];
  let currentIssueLabel = "";
  let currentIssueMonth = "";
  let issueOrder = 0;
  let rowOrder = 0;
  let emptyStreak = 0;

  for (let row = cols.startRow; row < cols.startRow + 1200; row++) {
    const at = (col) => (col ? cellAt(ws, col, row) : { value: null, hyperlink: null });
    const A = cellAt(ws, "A", row);
    const subjectCell = cellAt(ws, cols.subject, row);

    const summaryMarker = [cellAt(ws, "H", row).value, cellAt(ws, "L", row).value].find(
      (v) => typeof v === "string" && v.trim().toLowerCase().startsWith("subtotal")
    );
    if (summaryMarker) continue;

    if (isBlankRow(ws, row, BOHR_COLS)) {
      emptyStreak++;
      if (emptyStreak >= MAX_EMPTY_STREAK) break;
      continue;
    }
    emptyStreak = 0;

    if (typeof A.value === "string" && A.value.trim()) {
      const parts = A.value.split("\n").map((s) => s.trim()).filter(Boolean);
      currentIssueLabel = parts[0] || "";
      currentIssueMonth = parts[1] || "";
      issueOrder++;
      rowOrder = 0;
    }

    if (subjectCell.value == null || String(subjectCell.value).trim() === "") continue;

    const get = (col) => at(col).value;
    const relectureRaw = get(cols.relecture);
    const relectureNames =
      typeof relectureRaw === "string" && relectureRaw.trim()
        ? relectureRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

    rows.push({
      season,
      issueLabel: currentIssueLabel,
      issueMonth: currentIssueMonth,
      issueOrder,
      rowOrder: ++rowOrder,
      subject: String(subjectCell.value).trim(),
      subjectUrl: subjectCell.hyperlink || "",
      topic: (get(cols.topic) || "").toString().trim(),
      authorName: get(cols.author),
      concept: (get(cols.concept) || "").toString().trim(),
      etatRedaction: (get(cols.etatRedaction) || "Pas commencé").toString().trim(),
      relectureNames,
      ligneEditoriale: get(cols.ligneEditoriale) === true,
      correctionName: get(cols.correction),
      sourceName: get(cols.source),
      comiteSci: get(cols.comiteSci) === true,
      etatMiseEnPage: (get(cols.etatMiseEnPage) || "Pas commencé").toString().trim(),
      illustrations: (get(cols.illustrations) || "Pas commencé").toString().trim(),
      pages: typeof get(cols.pages) === "number" ? get(cols.pages) : 0,
      etatAudio: audioStatus(get(cols.etatAudio)),
      enregistrementName: get(cols.enregistrement),
      montageName: get(cols.montage),
      communicationRs: (get(cols.communicationRs) || "Non").toString().trim(),
    });
  }
  return rows;
}

/** Parses every "Saison N" sheet present in the workbook. */
export function parseBohrWorkbook(wb) {
  const out = [];
  for (const name of wb.SheetNames) {
    if (!/^Saison\s+\d+$/i.test(name.trim())) continue;
    out.push(...parseBohrSheet(wb.Sheets[name], name.trim()));
  }
  return out;
}

export function readWorkbookFromBuffer(buffer) {
  return XLSX.read(buffer, { type: "buffer" });
}

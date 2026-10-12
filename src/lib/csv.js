/** Client-side CSV export — no server round-trip, builds straight from
 * whatever's already in memory. */
function escapeCsvCell(value) {
  const s = value == null ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows, columns) {
  const header = columns.map((c) => escapeCsvCell(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => escapeCsvCell(c.get(row))).join(","));
  return [header, ...lines].join("\r\n");
}

export function downloadCsv(filename, csvText) {
  const blob = new Blob([`﻿${csvText}`], { type: "text/csv;charset=utf-8;" }); // BOM so Excel opens accented text correctly
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

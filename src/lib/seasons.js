/** Shared "most recent season first" sort key — pulls the trailing number
 * out of a season name ("Saison 3" -> 3) so BohrBoard and ComPlan sort and
 * default consistently, rather than each re-deriving this. A name with no
 * number sorts last. */
export function seasonSortKey(name) {
  const m = /(\d+)/.exec(name || "");
  return m ? Number(m[1]) : -1;
}

export function sortSeasonsDesc(seasons) {
  return Array.from(seasons).sort((a, b) => seasonSortKey(b) - seasonSortKey(a));
}

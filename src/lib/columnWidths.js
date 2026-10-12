// Shared column-width metadata for Tableau de Bohr and Plan de
// Communication's tables — one place listing every column's key, French
// label, and default pixel width, used both to build each table's
// <colgroup> and to render the admin "Colonnes" settings form
// (AdminPanel.jsx). Defaults live here (not duplicated in each
// component) so BohrBoard/ComPlan and the admin form can never disagree
// about what a column is called or what it defaults to.

export const BOHR_COLUMNS = [
  { key: "avancement", label: "Avancement", defaultWidth: 56, fixed: true } /* colle à l'icône : pas de largeur réglable */,
  { key: "thematique", label: "Thématique", defaultWidth: 220 },
  { key: "redacteur", label: "Rédacteur·ice", defaultWidth: 140 },
  { key: "concept", label: "Concept", defaultWidth: 150 },
  { key: "etatRed", label: "État réd.", defaultWidth: 150 },
  { key: "relecture", label: "Relecture", defaultWidth: 170 },
  { key: "correction", label: "Correction", defaultWidth: 130 },
  { key: "sources", label: "Sources", defaultWidth: 130 },
  { key: "ligneEdito", label: "Ligne édito.", defaultWidth: 90 },
  { key: "comiteSci", label: "Comité sci", defaultWidth: 90 },
  { key: "etatMep", label: "État mise en page", defaultWidth: 170 },
  { key: "illustrations", label: "Illustrations", defaultWidth: 160 },
  { key: "pages", label: "Pages", defaultWidth: 90 },
  { key: "etatAudio", label: "État audio", defaultWidth: 140 },
  { key: "respMep", label: "Resp. mise en page", defaultWidth: 150 },
  { key: "respIllu", label: "Resp. illustration", defaultWidth: 150 },
  { key: "enregistrement", label: "Resp. enregistrement", defaultWidth: 150 },
  { key: "montage", label: "Resp. montage", defaultWidth: 150 },
  { key: "podcast", label: "Podcast", defaultWidth: 200 },
  { key: "postLie", label: "Post lié", defaultWidth: 190 },
  { key: "numero", label: "Numéro (C2R)", defaultWidth: 150 },
  { key: "delete", label: "Supprimer (C2R)", defaultWidth: 44, fixed: true },
];

export const COMPLAN_COLUMNS = [
  { key: "date", label: "Date", defaultWidth: 150 },
  { key: "type", label: "Type", defaultWidth: 170 },
  { key: "articleLie", label: "Article lié", defaultWidth: 190 },
  { key: "reseaux", label: "Réseaux", defaultWidth: 230 },
  { key: "coPost", label: "Co-post", defaultWidth: 150 },
  { key: "texte", label: "Texte", defaultWidth: 230 },
  { key: "lien", label: "Lien", defaultWidth: 120 },
  { key: "posted", label: "Posté (tout)", defaultWidth: 110 },
  { key: "delete", label: "Supprimer (C2R)", defaultWidth: 44 },
];

/** Builds a table's actual column list: given the keys currently visible
 * (already filtered by the caller for toggled groups/C2R-only columns), looks
 * up each one's default width from `meta` and applies any admin-set
 * override from `overridesJson` (a settings value — JSON string of
 * {key: widthPx}, or null/invalid, in which case every column just keeps
 * its default). */
export function buildColumnList(meta, keys, overridesJson) {
  let overrides = null;
  if (overridesJson) {
    try {
      overrides = JSON.parse(overridesJson);
    } catch {
      overrides = null; // malformed setting — fall back to defaults rather than throwing
    }
  }
  return keys.map((key) => {
    const info = meta.find((c) => c.key === key);
    const override = !info.fixed && overrides && Number(overrides[key]);
    return { key, width: override > 0 ? override : info.defaultWidth };
  });
}

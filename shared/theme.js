/**
 * theme.js — color tokens lifted from serotine.fr's own current
 * stylesheet (Serotine_fork/css/serotine.css's :root block), so this
 * internal tool reads as the same brand rather than a generic admin
 * theme. Single source of truth for both src/styles.css (as CSS custom
 * properties) and any JS that needs a raw hex.
 *
 * The site was re-branded (violet/green) since this was first written —
 * an earlier version of this file used stale steel-blue/amber values from
 * an old design-system memory that was never re-verified against the
 * live stylesheet before use. Re-pulled directly from the real file this
 * time, not from memory.
 */
export const SEROTINE_COLORS = {
  violet: "#65466e", // primary brand ("violet acier")
  violetClair: "#db9ced", // light violet — hover, secondary labels
  vert: "#b1ed4e", // accent green
  vertFonce: "#374620", // dark green
};

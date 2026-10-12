/** Small color helper for status/topic "chips" — computes an actual rgba()
 * string in JS rather than relying on CSS `color-mix()`, which is a
 * fairly recent function (reliable only in Chrome 111+/Firefox 113+/
 * Safari 16.4+) that silently makes the whole `background`/`border`
 * declaration invalid on anything older, leaving a chip with no visible
 * color at all rather than an error anyone would notice. Computing the
 * tint ourselves works everywhere rgba() itself works, which is
 * essentially every browser in use. */
export function hexToRgb(hex) {
  if (typeof hex !== "string") return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function tint(hex, alpha) {
  const rgb = hexToRgb(hex);
  if (!rgb) return `rgba(154, 165, 177, ${alpha})`; // neutral grey fallback for an unparseable color
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

/** The 3 CSS values a chip needs, computed once from its base hex color. */
export function chipStyle(hex) {
  const color = hexToRgb(hex) ? hex : "#9aa5b1";
  return {
    color,
    background: tint(color, 0.16),
    borderColor: tint(color, 0.4),
  };
}

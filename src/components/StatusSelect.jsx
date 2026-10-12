import { chipStyle } from "../lib/color.js";

/** A <select> of a bohr_status_options field's editable vocab, rendered as
 * a Notion-style pastel "chip" (light tinted background, solid-color
 * text — see .chip in styles.css + src/lib/color.js's chipStyle, which
 * computes the actual colors in JS rather than via CSS color-mix()).
 * Colors/labels themselves are managed in Administration -> "Statuts &
 * couleurs". */
export default function StatusSelect({ options, value, onChange, disabled }) {
  const current = options.find((o) => o.value === value);
  const { color, background, borderColor } = chipStyle(current?.color);
  return (
    <select
      className="chip"
      value={value || ""}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{ color, background, borderColor, cursor: disabled ? "default" : "pointer" }}
    >
      {!current && <option value="">—</option>}
      {options.map((o) => (
        <option key={o.id} value={o.value} style={{ color: "#000", background: "#fff" }}>
          {o.value}
        </option>
      ))}
    </select>
  );
}

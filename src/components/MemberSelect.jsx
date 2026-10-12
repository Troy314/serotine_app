// Choix d'une personne. Celles qui ne sont plus inscrites au projet Sérotine (`active === false`) ne sont plus proposées,
// sauf si elles sont déjà la valeur courante (l'ancien article garde son nom ; on peut seulement la remplacer ou la vider).
export default function MemberSelect({ members, value, onChange, disabled, allowEmpty = true }) {
  const options = members.filter((m) => m.active !== false || m.id === value);
  return (
    <select value={value ?? ""} disabled={disabled} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      {allowEmpty && <option value="">—</option>}
      {options.map((m) => (
        <option key={m.id} value={m.id}>
          {m.displayName}{m.active === false ? " (ancien·ne)" : ""}
        </option>
      ))}
    </select>
  );
}

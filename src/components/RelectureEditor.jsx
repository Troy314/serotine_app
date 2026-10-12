import MemberPicker from "./MemberPicker.jsx";

// Relecteurs (C2R) : plusieurs personnes, choisies par recherche avec suggestions (MemberPicker).
// `onToggle(id)` ajoute la personne si elle n'y est pas, la retire sinon — comme avant.
export default function RelectureEditor({ members, selectedIds, onToggle }) {
  return <MemberPicker members={members} selectedIds={selectedIds} multiple onAdd={onToggle} onRemove={onToggle} />;
}

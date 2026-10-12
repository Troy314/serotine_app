import EditableLinkList from "./EditableLinkList.jsx";

export default function DocumentsTechniques({ isSuperAdmin }) {
  return (
    <div className="card">
      <h3>Liens</h3>
      <EditableLinkList section="documents_technique" canEdit={isSuperAdmin} />
    </div>
  );
}

import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

/** A simple "title + url" list — backs both Documents Technique (a page of
 * links) and Podcast's platform-link row. Editing is super admin only
 * (2026-10-09 : narrowed from the whole C2R, same as LinkSettingsEditor —
 * these are the links/images at the top of each page) ; `canEdit` names
 * what it actually gates rather than reusing the generic "isAdmin". */
export default function EditableLinkList({ section, canEdit }) {
  const [links, setLinks] = useState([]);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", url: "" });

  function load() {
    api.links.list(section).then(setLinks);
  }
  useEffect(load, [section]);

  async function add(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.url.trim()) return;
    const created = await api.links.create(section, form);
    setLinks((prev) => [...prev, created]);
    setForm({ title: "", url: "" });
    setAdding(false);
  }

  async function remove(id) {
    await api.links.remove(id);
    setLinks((prev) => prev.filter((l) => l.id !== id));
  }

  return (
    <div className="link-row" style={{ alignItems: "center" }}>
      {links.map((l) => (
        <span key={l.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
          <a className="link-btn secondary" href={l.url} target="_blank" rel="noreferrer">{l.title} ↗</a>
          {canEdit && <button className="icon-btn" onClick={() => remove(l.id)}>✕</button>}
        </span>
      ))}
      {links.length === 0 && <span className="muted small">Aucun lien pour le moment.</span>}
      {canEdit && !adding && <button className="icon-btn" onClick={() => setAdding(true)}>+ ajouter un lien</button>}
      {canEdit && adding && (
        <form onSubmit={add} style={{ display: "flex", gap: 6 }}>
          <input placeholder="Titre" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} style={{ width: 120 }} />
          <input placeholder="https://…" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} style={{ width: 200 }} />
          <button className="link-btn" type="submit">Ajouter</button>
          <button type="button" className="icon-btn" onClick={() => setAdding(false)}>✕</button>
        </form>
      )}
    </div>
  );
}

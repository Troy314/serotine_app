import { useState } from "react";
import { api } from "../lib/api.js";

export default function ProfileMenu({ user, onUserChanged, onGoAdmin }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    displayName: user.displayName,
    creditLinkedin: "",
    creditInstagram: "",
    creditBluesky: "",
  });

  async function openEditor() {
    setOpen(false);
    // The session's `user` only carries display fields, not credit_* — pull
    // the full member row so the form isn't blank on every open.
    const all = await api.members.list().catch(() => []);
    const mine = all.find((m) => m.id === user.id);
    if (mine) {
      setForm({
        displayName: mine.displayName,
        creditLinkedin: mine.creditLinkedin,
        creditInstagram: mine.creditInstagram,
        creditBluesky: mine.creditBluesky,
      });
    }
    setEditing(true);
  }

  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=64`
    : null;

  async function saveSelf(e) {
    e.preventDefault();
    await api.members.updateSelf(form);
    setEditing(false);
    onUserChanged?.();
  }

  return (
    <div className="profile-menu">
      <button className="profile-btn" onClick={() => setOpen((v) => !v)}>
        <span className="avatar">{avatarUrl ? <img src={avatarUrl} alt="" /> : user.displayName?.[0] || "?"}</span>
        {user.displayName}
      </button>
      {open && (
        <div className="profile-dropdown">
          <button onClick={openEditor}><i className="fa-solid fa-pen" aria-hidden="true" /> Mon profil / crédits</button>
          {user.isAdmin && <button onClick={() => { onGoAdmin?.(); setOpen(false); }}><i className="fa-solid fa-gear" aria-hidden="true" /> Administration</button>}
          <a href="/auth/logout"><i className="fa-solid fa-right-from-bracket" aria-hidden="true" /> Se déconnecter</a>
        </div>
      )}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Mon profil</h3>
              <button className="icon-btn" onClick={() => setEditing(false)}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
            </div>
            <form onSubmit={saveSelf}>
              <div className="field">
                <label>Nom affiché (crédit)</label>
                <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
              </div>
              <div className="field">
                <label>LinkedIn</label>
                <input value={form.creditLinkedin} onChange={(e) => setForm({ ...form, creditLinkedin: e.target.value })} placeholder="https://linkedin.com/in/…" />
              </div>
              <div className="field">
                <label>Instagram</label>
                <input value={form.creditInstagram} onChange={(e) => setForm({ ...form, creditInstagram: e.target.value })} placeholder="@handle" />
              </div>
              <div className="field">
                <label>Bluesky</label>
                <input value={form.creditBluesky} onChange={(e) => setForm({ ...form, creditBluesky: e.target.value })} placeholder="@handle.bsky.social" />
              </div>
              <button className="link-btn" type="submit">Enregistrer</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

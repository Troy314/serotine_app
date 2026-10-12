import { useState } from "react";
import { api } from "../lib/api.js";

/** Small inline "edit these settings keys" modal, reused by every section
 * that owns just one or two fixed outbound links (Mise en page, Plan de
 * Communication, Podcast) so each doesn't duplicate its own settings-save
 * form. Administration has the full settings list for everything at once;
 * this is the fast path for the 1-2 keys a given section actually shows. */
export default function LinkSettingsEditor({ fields, settings, onSaved }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => Object.fromEntries(fields.map((f) => [f.key, settings[f.key] || ""])));

  async function save(e) {
    e.preventDefault();
    await api.settings.update(form);
    onSaved?.();
    setOpen(false);
  }

  return (
    <>
      <button className="icon-btn" title="Modifier les liens" onClick={() => setOpen(true)}><i className="fa-solid fa-pen" aria-hidden="true" /></button>
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h3>Modifier les liens</h3>
              <button className="icon-btn" onClick={() => setOpen(false)}><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
            </div>
            <form onSubmit={save}>
              {fields.map((f) => (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} placeholder="https://…" />
                </div>
              ))}
              <button className="link-btn" type="submit">Enregistrer</button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

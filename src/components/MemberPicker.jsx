import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

// « Sans accents, sans majuscules » : « ame » trouve « Amaëline ».
const norm = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Choix de membres par recherche : un bouton « + ajouter » (look des étiquettes) qui devient un champ de texte
 * avec suggestions pendant la frappe. `multiple=false` : une seule personne (en choisir une autre la remplace, ✕ la retire) ;
 * `multiple=true` : plusieurs étiquettes, chacune avec son ✕.
 * La liste de suggestions est affichée dans <body> (position fixe) pour ne pas être rognée par un tableau ou une colonne qui défile.
 * `onOpenChange(open)` permet au parent de désactiver le glisser-déposer pendant la saisie (un champ texte dans un élément
 * « draggable » ne se laisse pas sélectionner sous Firefox).
 */
export default function MemberPicker({ members, selectedIds, multiple = false, onAdd, onRemove, onOpenChange, addLabel = "+ ajouter", disabled = false }) {
  const [open, setOpenState] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState(null);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useRef(`mp-${Math.random().toString(36).slice(2, 8)}`).current;

  const selected = useMemo(() => members.filter((m) => selectedIds.includes(m.id)), [members, selectedIds]);
  const suggestions = useMemo(() => {
    const q = norm(query.trim());
    return members
      .filter((m) => m.active !== false) // les personnes qui ne sont plus au projet Sérotine ne sont plus proposées
      .filter((m) => !(multiple && selectedIds.includes(m.id))) // en mode multiple on ne re-propose pas ceux déjà choisis
      .filter((m) => !q || norm(m.displayName).includes(q))
      .sort((a, b) => {
        const sa = norm(a.displayName).startsWith(q) ? 0 : 1, sb = norm(b.displayName).startsWith(q) ? 0 : 1;
        return sa - sb || a.displayName.localeCompare(b.displayName, "fr", { sensitivity: "base" });
      });
  }, [members, selectedIds, multiple, query]);

  function setOpen(v) {
    setOpenState(v);
    onOpenChange?.(v);
    if (!v) setQuery("");
    setActive(0);
  }
  function pick(m) {
    onAdd(m.id);
    setOpen(false);
  }

  // Position de la liste sous le champ ; on la ferme si la page défile (elle ne suivrait pas).
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const place = () => {
      const r = inputRef.current?.getBoundingClientRect();
      if (r) setRect({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 200) });
    };
    place();
    const onDown = (e) => {
      if (rootRef.current?.contains(e.target) || listRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = (e) => { if (!listRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  function onKeyDown(e) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (suggestions[active]) pick(suggestions[active]); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  return (
    <div className="member-picker" ref={rootRef}>
      {selected.map((m) => (
        <span className={`tag ${m.active === false ? "tag--gone" : ""}`} key={m.id} style={{ gap: 4, alignItems: "center" }} title={m.active === false ? "N'est plus inscrit·e au projet Sérotine (garde son nom sur cet article)" : undefined}>
          {multiple || disabled ? (
            m.displayName
          ) : (
            <button type="button" className="mp-name" onClick={() => setOpen(true)} title="Changer de personne">{m.displayName}</button>
          )}
          {!disabled && (
            <button type="button" className="mp-x" aria-label={`Retirer ${m.displayName}`} title="Retirer" onClick={() => onRemove(m.id)}>
              <i className="fa-solid fa-xmark" aria-hidden="true" />
            </button>
          )}
        </span>
      ))}
      {!disabled && !open && (multiple || selected.length === 0) && (
        <button type="button" className="tag" style={{ cursor: "pointer" }} onClick={() => setOpen(true)}>{addLabel}</button>
      )}
      {open && (
        <>
          <input
            ref={inputRef}
            className="mp-input"
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={suggestions[active] ? `${listId}-${suggestions[active].id}` : undefined}
            placeholder="Chercher un nom…"
            value={query}
            autoComplete="off"
            onChange={(e) => { setQuery(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
          />
          {rect &&
            createPortal(
              <ul
                id={listId}
                role="listbox"
                ref={listRef}
                className="mp-list"
                style={{ position: "fixed", top: rect.top, left: rect.left, width: rect.width }}
              >
                {suggestions.length === 0 && <li className="mp-empty">Aucun résultat</li>}
                {suggestions.map((m, i) => (
                  <li
                    key={m.id}
                    id={`${listId}-${m.id}`}
                    role="option"
                    aria-selected={i === active}
                    className={`mp-option ${i === active ? "active" : ""}`}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(m)}
                  >
                    {m.displayName}
                  </li>
                ))}
              </ul>,
              document.body
            )}
        </>
      )}
    </div>
  );
}

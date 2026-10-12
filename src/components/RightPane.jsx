import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

function formatEventDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Seuls les 4 prochains événements sont affichés (demande du 2026-10-09) ; le serveur en renvoie davantage.
const MAX_EVENTS = 4;

export default function RightPane({ minutesUrl }) {
  const [events, setEvents] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.events
      .list()
      .then(setEvents)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="rp-section">
        <h3>Prochains événements</h3>
        {error && <p className="rp-empty">Calendrier indisponible ({error}).</p>}
        {!error && events === null && <p className="rp-empty">Chargement…</p>}
        {!error && events && events.length === 0 && (
          <p className="rp-empty">Aucun événement à venir, ou aucun calendrier configuré (voir Administration).</p>
        )}
        {events?.slice(0, MAX_EVENTS).map((ev, i) => (
          <div className="rp-event" key={i}>
            <div className="rp-event-date">{formatEventDate(ev.start)}</div>
            <div className="rp-event-title">{ev.summary}</div>
            {ev.location && <div className="muted small">{ev.location}</div>}
          </div>
        ))}
      </div>
      <div className="rp-section">
        <h3>Compte-rendu de réunion</h3>
        {minutesUrl ? (
          <a className="link-btn secondary" href={minutesUrl} target="_blank" rel="noreferrer">
            <i className="fa-solid fa-file-lines" aria-hidden="true" /> Dernier compte-rendu <i className="fa-solid fa-arrow-up-right-from-square" aria-hidden="true" />
          </a>
        ) : (
          <p className="rp-empty">Aucun lien configuré (voir Administration).</p>
        )}
      </div>
    </>
  );
}

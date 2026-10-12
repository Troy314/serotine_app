// Les responsables d'un article (un·e membre par rôle) — libellé, champ renvoyé par l'API, champ à écrire.
// `phase` : clé (voir PHASES dans BohrKanban.jsx) de l'étape où du Kanban ce rôle s'affiche directement sur la carte (la fenêtre « Responsables » les montre tous).
export const ROLES = [
  { label: "Correction", field: "correction", key: "correctionId", phase: "etatRedaction" },
  { label: "Sources", field: "source", key: "sourceId", phase: "etatRedaction" },
  { label: "Mise en page", field: "miseEnPage", key: "miseEnPageId", phase: "etatMiseEnPage" },
  { label: "Illustration", field: "illustration", key: "illustrationId", phase: "illustrations" },
  { label: "Enregistrement", field: "enregistrement", key: "enregistrementId", phase: "etatAudio" },
  { label: "Montage", field: "montage", key: "montageId", phase: "etatAudio" },
  { label: "Communication", field: "communication", key: "communicationId", phase: null },
];

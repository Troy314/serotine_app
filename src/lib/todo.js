// Règles de la page « À faire » : quels articles manquent de relecteurs, et quelles tâches restent à une personne.
// Pur calcul sur les articles et les posts déjà chargés (aucun appel serveur) — un seul endroit pour les règles.

/** Nombre minimum de relecteurs pour qu'un article soit « ok » (demande du 2026-10-09 : plus de 2, donc 3 au moins). */
export const MIN_RELECTEURS = 3;

const DONE_REDACTION = new Set(["Finito", "Annulé"]);

/** Articles encore en rédaction. Par défaut seulement ceux qui n'ont pas assez de relecteurs (les plus urgents d'abord : « Relisez moi », puis le moins de relecteurs) ;
 * avec `includeComplete`, aussi ceux qui en ont déjà 3 ou plus — 3 est un MINIMUM, jamais un maximum : on peut toujours en ajouter. */
export function articlesToProofread(articles, { includeComplete = false } = {}) {
  const urgency = (a) => (a.etatRedaction === "Relisez moi" ? 0 : a.etatRedaction === "En cours" || a.etatRedaction === "Retard" ? 1 : 2);
  const missing = (a) => a.relecture.length < MIN_RELECTEURS;
  return articles
    .filter((a) => !DONE_REDACTION.has(a.etatRedaction) && (includeComplete || missing(a)))
    .sort((a, b) => missing(b) - missing(a) || urgency(a) - urgency(b) || a.relecture.length - b.relecture.length || (a.subject || "").localeCompare(b.subject || ""));
}

/**
 * Tâches en attente d'un·e membre : une ligne { article, role, detail } par rôle tenu sur un article pas encore terminé.
 * « Terminé » dépend du rôle (voir les règles ci-dessous) ; un article annulé n'a plus aucune tâche.
 */
export function pendingTasksFor(memberId, articles, posts) {
  const postsByArticle = new Map();
  for (const p of posts) if (p.linkedArticleId) (postsByArticle.get(p.linkedArticleId) || postsByArticle.set(p.linkedArticleId, []).get(p.linkedArticleId)).push(p);
  const tasks = [];
  for (const a of articles) {
    if (a.etatRedaction === "Annulé") continue;
    const redactionOpen = a.etatRedaction !== "Finito";
    const is = (m) => m?.id === memberId;
    const add = (role, detail) => tasks.push({ article: a, role, detail });
    if (is(a.author) && redactionOpen) add("Rédaction", a.etatRedaction);
    if (a.relecture.some(is) && redactionOpen) add("Relecture", a.etatRedaction);
    if (is(a.correction) && redactionOpen) add("Correction", a.etatRedaction);
    if (is(a.source) && redactionOpen) add("Sources", a.etatRedaction);
    if (is(a.miseEnPage) && a.etatMiseEnPage !== "Finito") add("Mise en page", a.etatMiseEnPage);
    if (is(a.illustration) && a.illustrations !== "Finito" && a.illustrations !== "Non") add("Illustration", a.illustrations);
    // Audio : « Non » = pas de version audio prévue → rien à faire ; enregistrer tant que « Pas commencé », monter jusqu'à « Traité ».
    if (is(a.enregistrement) && a.etatAudio === "Pas commencé") add("Enregistrement", a.etatAudio);
    if (is(a.montage) && (a.etatAudio === "Pas commencé" || a.etatAudio === "Enregistré")) add("Montage", a.etatAudio);
    if (is(a.communication)) {
      const linked = postsByArticle.get(a.id) || [];
      const notPosted = linked.filter((p) => !p.posted).length;
      if (linked.length === 0) add("Communication", "aucun post lié");
      else if (notPosted > 0) add("Communication", `${notPosted} post${notPosted > 1 ? "s" : ""} à publier`);
    }
  }
  return tasks.sort((x, y) => (y.article.season || "").localeCompare(x.article.season || "") || (y.article.issueOrder || 0) - (x.article.issueOrder || 0) || x.article.subject.localeCompare(y.article.subject));
}

/**
 * Toute l'équipe, regroupé par article (comme dans le Tableau de Bohr : saison récente d'abord, puis numéro, puis ordre de la ligne) :
 * { article, entries: [{ member, role, detail }] } pour chaque article qui a au moins une tâche en attente.
 */
export function pendingTasksByArticle(members, articles, posts) {
  const byId = new Map();
  for (const member of members) {
    for (const t of pendingTasksFor(member.id, articles, posts)) {
      if (!byId.has(t.article.id)) byId.set(t.article.id, { article: t.article, entries: [] });
      byId.get(t.article.id).entries.push({ member, role: t.role, detail: t.detail });
    }
  }
  const ROLE_ORDER = ["Rédaction", "Relecture", "Correction", "Sources", "Mise en page", "Illustration", "Enregistrement", "Montage", "Communication"];
  for (const g of byId.values()) g.entries.sort((x, y) => ROLE_ORDER.indexOf(x.role) - ROLE_ORDER.indexOf(y.role) || x.member.displayName.localeCompare(y.member.displayName, "fr", { sensitivity: "base" }));
  return [...byId.values()].sort(
    (a, b) =>
      (b.article.season || "").localeCompare(a.article.season || "") ||
      (b.article.issueOrder || 0) - (a.article.issueOrder || 0) ||
      (a.article.rowOrder || 0) - (b.article.rowOrder || 0)
  );
}

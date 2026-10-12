/** Per-article completion, one % per production step plus an overall
 * average — the criteria were specified explicitly per step, not
 * inferred from the status fields alone. `linkedPosts` is that article's
 * own slice of Plan de Com posts (see BohrBoard.jsx's postsByArticle). */
export function computeAchievement(article, linkedPosts) {
  const redaction = article.etatRedaction === "Finito" ? 100 : 0;

  const relectureCriteria = [
    article.relecture.length > 2,
    article.ligneEditoriale === true,
    article.correctionValide === true,
    article.sourceValide === true,
  ];
  const relecture = pct(relectureCriteria);

  const miseEnPageCriteria = [article.etatMiseEnPage === "Finito", article.illustrations === "Finito" || article.illustrations === "Non" /* pas d'illustration prévue : rien à faire */];
  const miseEnPage = pct(miseEnPageCriteria);

  const audioCriteria = [!!article.enregistrement, !!article.montage, article.etatAudio === "Posté"];
  const audio = pct(audioCriteria);

  // "Posté (tout)" — an article only counts as fully communicated once it
  // has at least one linked post AND every linked post's own derived
  // `posted` (itself only true once every réseau on that post is
  // individually checked — see ComPlan.jsx) is true.
  const communication = linkedPosts.length > 0 && linkedPosts.every((p) => p.posted) ? 100 : 0;

  const overall = Math.round((redaction + relecture + miseEnPage + audio + communication) / 5);

  return { redaction, relecture, miseEnPage, audio, communication, overall };
}

function pct(criteria) {
  return Math.round((criteria.filter(Boolean).length / criteria.length) * 100);
}

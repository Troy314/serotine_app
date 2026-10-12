import test from "node:test";
import assert from "node:assert/strict";
import { mapBrevoCampaign } from "../server/brevo-stats.js";

// Forme documentée par Brevo (à remplacer par une vraie réponse du compte dès qu'on en a une).
const campaign = {
  id: 12, name: "Sérotine #7", subject: "Le numéro 7 est là", status: "sent", sentDate: "2026-09-21T09:00:00.000+02:00",
  statistics: { globalStats: { uniqueClicks: 40, clickers: 35, complaints: 1, delivered: 500, sent: 510, softBounces: 6, hardBounces: 4, uniqueViews: 210, trackableViews: 260, unsubscriptions: 3, viewed: 300 } },
};

test("une campagne complète est mise à plat avec taux d'ouverture et de clic", () => {
  const r = mapBrevoCampaign(campaign);
  assert.equal(r.sentDate, "2026-09-21");
  assert.equal(r.delivered, 500);
  assert.equal(r.opens, 210);
  assert.equal(r.openRate, 42);
  assert.equal(r.clickRate, 7);
  assert.equal(r.hardBounces, 4);
});

test("une campagne sans statistiques (ou mal formée) ne lève pas d'erreur et donne des zéros / null", () => {
  for (const bad of [{ id: 1, name: "x" }, { id: 2, statistics: {} }, { id: 3, statistics: { globalStats: { delivered: "abc", uniqueViews: null } } }, null, undefined]) {
    const r = mapBrevoCampaign(bad);
    assert.equal(r.delivered, 0);
    assert.equal(r.openRate, null);
  }
});

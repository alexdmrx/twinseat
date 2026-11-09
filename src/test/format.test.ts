import { test } from "node:test";
import assert from "node:assert/strict";
import { ageTexte, compteDepuisOnglet, libelleQuota, momentLocal, niveau, phraseAlerte, phraseMaj, phraseRetour, pourcent } from "../format";
import { Quotas } from "../quotas";
import { titreOnglet } from "../registre";

test("niveau : seuils 70 et 90", () => {
  assert.equal(niveau(0), "normal");
  assert.equal(niveau(69.9), "normal");
  assert.equal(niveau(70), "attention");
  assert.equal(niveau(89), "attention");
  assert.equal(niveau(90), "critique");
  assert.equal(niveau(100), "critique");
});

test("pourcent arrondit", () => {
  assert.equal(pourcent(61.6), "62 %");
});

test("titreOnglet : 25 caractères puis …", () => {
  assert.equal(titreOnglet("court"), "court");
  assert.equal(titreOnglet("a".repeat(25)), "a".repeat(25));
  assert.equal(titreOnglet("a".repeat(26)), `${"a".repeat(25)}…`);
});

const now = new Date(2026, 9, 7, 12, 0, 0).getTime(); // mercredi 7 octobre 2026, heure locale
test("momentLocal : même jour, demain, jour de semaine, passé", () => {
  assert.equal(momentLocal(new Date(2026, 9, 7, 16, 39).toISOString(), now), "à 16 h 39");
  assert.equal(momentLocal(new Date(2026, 9, 8, 9, 5).toISOString(), now), "demain à 9 h 05");
  assert.equal(momentLocal(new Date(2026, 9, 12, 16, 39).toISOString(), now), "lundi à 16 h 39");
  assert.equal(momentLocal(new Date(2026, 9, 7, 11, 0).toISOString(), now), undefined);
  assert.equal(momentLocal("pas une date", now), undefined);
  assert.equal(phraseRetour(new Date(2026, 9, 7, 16, 39).toISOString(), now), "retour à zéro à 16 h 39");
  assert.equal(phraseRetour(undefined, now), undefined);
});

test("ageTexte et phraseMaj", () => {
  assert.equal(ageTexte(now - 20_000, now), "à l'instant");
  assert.equal(ageTexte(now - 2 * 60_000, now), "il y a 2 min");
  assert.equal(ageTexte(now - 3 * 3600_000, now), "il y a 3 h");
  assert.equal(ageTexte(now - 3 * 86_400_000, now), "il y a 3 j");
  const q: Quotas = { compte: "A", majLe: now - 2 * 60_000, source: "direct" };
  assert.equal(phraseMaj(q, now), "mis à jour il y a 2 min");
  assert.equal(phraseMaj({ ...q, majLe: now - 3 * 3600_000, source: "cache" }, now), "chiffres d'il y a 3 h (mémoire de Claude)");
});

test("libelleQuota", () => {
  const q: Quotas = { compte: "A", majLe: now, source: "direct", cinqHeures: { pct: 62 }, semaine: { pct: 26 } };
  assert.equal(libelleQuota(q), "5 h : 62 % · semaine : 26 %");
  assert.equal(libelleQuota({ compte: "A", majLe: now, source: "direct" }), "quotas indisponibles");
  assert.equal(libelleQuota(undefined), "quotas pas encore relevés");
});

test("phraseAlerte", () => {
  const reset = new Date(2026, 9, 7, 16, 39).toISOString();
  assert.equal(phraseAlerte("A", 92, "5 h", reset, now), "Le compte A est à 92 % (limite de 5 h, retour à zéro à 16 h 39).");
  assert.equal(phraseAlerte("B", 91.4, "semaine", undefined, now), "Le compte B est à 91 % (limite de la semaine).");
});

test("compteDepuisOnglet : appariement sans ambiguïté", () => {
  const long = "Corriger le bug du panneau latéral de facturation";
  const convs = [
    { titre: long, compte: "B" as const },
    { titre: "Autre sujet", compte: "A" as const },
    { titre: "Sans registre" },
  ];
  assert.equal(compteDepuisOnglet(titreOnglet(long), convs), "B");
  assert.equal(compteDepuisOnglet("Autre sujet", convs), "A");
  assert.equal(compteDepuisOnglet("Claude Code", convs), undefined);
  assert.equal(compteDepuisOnglet("Inconnu", convs), undefined);
  assert.equal(compteDepuisOnglet("Sans registre", convs), undefined);
  // deux conversations de même titre : ambigu si comptes différents, net sinon
  assert.equal(compteDepuisOnglet("Doublon", [{ titre: "Doublon", compte: "A" }, { titre: "Doublon", compte: "B" }]), undefined);
  assert.equal(compteDepuisOnglet("Doublon", [{ titre: "Doublon", compte: "A" }, { titre: "Doublon", compte: "A" }]), "A");
  assert.equal(compteDepuisOnglet("  Autre   sujet ", convs), "A");
});

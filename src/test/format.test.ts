import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { ageTexte, compteDepuisOnglet, libelleQuota, momentLocal, niveau, phraseAlerte, phraseMaj, phraseRetour, pourcent } from "../format";
import { Quotas } from "../quotas";
import { titreOnglet } from "../registre";
import { definirLangue } from "../textes";

afterEach(() => {
  definirLangue("en");
});

/** Exécute f avec le français choisi (la langue est remise à « en » après chaque essai). */
const enFrancais = (f: () => void) => {
  definirLangue("fr");
  f();
};

test("niveau : seuils 70 et 90", () => {
  assert.equal(niveau(0), "normal");
  assert.equal(niveau(69.9), "normal");
  assert.equal(niveau(70), "attention");
  assert.equal(niveau(89), "attention");
  assert.equal(niveau(90), "critique");
  assert.equal(niveau(100), "critique");
});

test("pourcent arrondit (en, fr)", () => {
  assert.equal(pourcent(61.6), "62%");
  enFrancais(() => assert.equal(pourcent(61.6), "62 %"));
});

test("titreOnglet : 25 caractères puis …", () => {
  assert.equal(titreOnglet("court"), "court");
  assert.equal(titreOnglet("a".repeat(25)), "a".repeat(25));
  assert.equal(titreOnglet("a".repeat(26)), `${"a".repeat(25)}…`);
});

const now = new Date(2026, 9, 7, 12, 0, 0).getTime(); // mercredi 7 octobre 2026, heure locale
const jour = (j: number, h: number, mn: number) => new Date(2026, 9, j, h, mn).toISOString();

test("momentLocal et phraseRetour (en) : même jour, demain, jour de semaine, plus tard, passé", () => {
  assert.equal(momentLocal(jour(7, 16, 39), now), "at 16:39");
  assert.equal(momentLocal(jour(8, 9, 5), now), "tomorrow at 09:05");
  assert.equal(momentLocal(jour(8, 0, 31), now), "tomorrow at 00:31");
  assert.equal(momentLocal(jour(12, 16, 39), now), "Monday at 16:39");
  assert.equal(momentLocal(jour(14, 16, 39), now), "on Oct 14 at 16:39");
  assert.equal(momentLocal(jour(7, 11, 0), now), undefined);
  assert.equal(momentLocal("pas une date", now), undefined);
  assert.equal(phraseRetour(jour(7, 16, 39), now), "resets at 16:39");
  assert.equal(phraseRetour(jour(8, 0, 31), now), "resets tomorrow at 00:31");
  assert.equal(phraseRetour(undefined, now), undefined);
});

test("momentLocal et phraseRetour (fr)", () => {
  enFrancais(() => {
    assert.equal(momentLocal(jour(7, 16, 39), now), "à 16 h 39");
    assert.equal(momentLocal(jour(8, 9, 5), now), "demain à 9 h 05");
    assert.equal(momentLocal(jour(8, 0, 31), now), "demain à 0 h 31");
    assert.equal(momentLocal(jour(12, 16, 39), now), "lundi à 16 h 39");
    assert.equal(momentLocal(jour(14, 16, 39), now), "le 14 oct. à 16 h 39");
    assert.equal(momentLocal(jour(7, 11, 0), now), undefined);
    assert.equal(phraseRetour(jour(7, 16, 39), now), "retour à zéro à 16 h 39");
    assert.equal(phraseRetour(jour(8, 0, 31), now), "retour à zéro demain à 0 h 31");
    assert.equal(phraseRetour(undefined, now), undefined);
  });
});

const q: Quotas = { compte: "A", majLe: now - 2 * 60_000, source: "direct" };

test("ageTexte et phraseMaj (en)", () => {
  assert.equal(ageTexte(now - 20_000, now), "just now");
  assert.equal(ageTexte(now - 2 * 60_000, now), "2 min ago");
  assert.equal(ageTexte(now - 3 * 3600_000, now), "3 h ago");
  assert.equal(ageTexte(now - 3 * 86_400_000, now), "3 d ago");
  assert.equal(phraseMaj(q, now), "updated 2 min ago");
  assert.equal(phraseMaj({ ...q, majLe: now - 20_000 }, now), "updated just now");
  assert.equal(phraseMaj({ ...q, majLe: now - 3 * 3600_000, source: "cache" }, now), "from Claude's cache, 3 h ago");
  assert.equal(phraseMaj({ ...q, majLe: now - 20_000, source: "cache" }, now), "from Claude's cache, just now");
});

test("ageTexte et phraseMaj (fr)", () => {
  enFrancais(() => {
    assert.equal(ageTexte(now - 20_000, now), "à l'instant");
    assert.equal(ageTexte(now - 2 * 60_000, now), "il y a 2 min");
    assert.equal(ageTexte(now - 3 * 3600_000, now), "il y a 3 h");
    assert.equal(ageTexte(now - 3 * 86_400_000, now), "il y a 3 j");
    assert.equal(phraseMaj(q, now), "mis à jour il y a 2 min");
    assert.equal(phraseMaj({ ...q, majLe: now - 20_000 }, now), "mis à jour à l'instant");
    assert.equal(phraseMaj({ ...q, majLe: now - 3 * 3600_000, source: "cache" }, now), "chiffres d'il y a 3 h (mémoire de Claude)");
    assert.equal(phraseMaj({ ...q, majLe: now - 20_000, source: "cache" }, now), "chiffres à l'instant (mémoire de Claude)");
  });
});

const quotas: Quotas = { compte: "A", majLe: now, source: "direct", cinqHeures: { pct: 62 }, semaine: { pct: 26 } };
const sansChiffres: Quotas = { compte: "A", majLe: now, source: "direct" };

test("libelleQuota (en, fr)", () => {
  assert.equal(libelleQuota(quotas), "5-hour: 62% · week: 26%");
  assert.equal(libelleQuota({ ...quotas, semaine: undefined }), "5-hour: 62%");
  assert.equal(libelleQuota(sansChiffres), "usage unavailable");
  assert.equal(libelleQuota(undefined), "usage not read yet");
  enFrancais(() => {
    assert.equal(libelleQuota(quotas), "5 h : 62 % · semaine : 26 %");
    assert.equal(libelleQuota(sansChiffres), "quotas indisponibles");
    assert.equal(libelleQuota(undefined), "quotas pas encore relevés");
  });
});

test("phraseAlerte (en)", () => {
  assert.equal(phraseAlerte("A", 92, "5 h", jour(7, 16, 39), now), "Account A is at 92% (5-hour limit, resets at 16:39).");
  assert.equal(phraseAlerte("B", 91.4, "semaine", undefined, now), "Account B is at 91% (weekly limit).");
});

test("phraseAlerte (fr)", () => {
  enFrancais(() => {
    assert.equal(phraseAlerte("A", 92, "5 h", jour(7, 16, 39), now), "Le compte A est à 92 % (limite de 5 h, retour à zéro à 16 h 39).");
    assert.equal(phraseAlerte("B", 91.4, "semaine", undefined, now), "Le compte B est à 91 % (limite de la semaine).");
  });
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

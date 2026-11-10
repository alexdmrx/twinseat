import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Cle, CLES_WEBVIEW, definirLangue, en, fr, heure, langue, liste, t, textesWebview } from "../textes";

afterEach(() => {
  definirLangue("en");
});

/** Noms des {variables} d'un texte, triés. `hh` (heure sur 2 chiffres) compte comme `h` : les deux langues choisissent. */
const variables = (s: string): string[] =>
  [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => (m[1] === "hh" ? "h" : m[1])))].sort();

test("le français a exactement les clés de l'anglais (et l'inverse)", () => {
  const cles = Object.keys(en).sort();
  assert.deepEqual(Object.keys(fr).sort(), cles);
  for (const c of cles) {
    assert.ok(en[c as Cle].length > 0, `en vide : ${c}`);
    assert.ok(fr[c as Cle].length > 0, `fr vide : ${c}`);
  }
});

test("compilation : une table à qui il manque une clé est refusée", () => {
  const complet: Record<Cle, string> = fr; // le français est complet
  assert.ok(complet);
  // @ts-expect-error clé manquante : doit être refusée à la compilation
  const incomplet: Record<Cle, string> = { "fmt.pourcent": "x" };
  assert.ok(incomplet);
});

test("chaque clé a les mêmes {variables} dans les deux langues", () => {
  for (const c of Object.keys(en) as Cle[]) {
    assert.deepEqual(variables(fr[c]), variables(en[c]), `variables différentes : ${c}`);
  }
});

test("les listes de jours et de mois ont 7 et 12 éléments, dans les deux langues", () => {
  for (const l of ["en", "fr"]) {
    definirLangue(l);
    assert.equal(liste("jours").length, 7);
    assert.equal(liste("mois").length, 12);
  }
});

test("le nom du produit n'est traduit nulle part (l'ancien nom a disparu)", () => {
  const ancienNom = new RegExp(["Comptes", "Claude"].join(" "));
  for (const table of [en, fr]) {
    for (const [cle, texte] of Object.entries(table)) {
      assert.ok(!ancienNom.test(texte), `ancien nom dans ${cle}`);
    }
  }
});

test("définirLangue : « fr » et ses variantes → français, le reste → anglais", () => {
  assert.equal(langue(), "en"); // défaut
  for (const l of ["fr", "fr-FR", "fr-ca", "FR"]) assert.equal(definirLangue(l), "fr", l);
  assert.equal(langue(), "fr");
  for (const l of ["en", "en-US", "de", "zh-cn", "", "frr" /* frison du Nord : pas du français */]) {
    assert.equal(definirLangue(l), "en", l);
  }
});

test("t : variables remplacées, inconnue laissée telle quelle", () => {
  assert.equal(t("fmt.pourcent", { n: 62 }), "62%");
  assert.equal(t("fmt.pourcent"), "{n}%");
  definirLangue("fr");
  assert.equal(t("fmt.pourcent", { n: 62 }), "62 %");
  // une valeur qui ressemble à une variable n'est pas réinterprétée
  assert.equal(t("compte.nom", { compte: "{n}" }), "Compte {n}");
});

test("heure : 24 h sur 2 chiffres en anglais, « 0 h 31 » en français", () => {
  assert.equal(heure(0, 31), "00:31");
  assert.equal(heure(16, 5), "16:05");
  definirLangue("fr");
  assert.equal(heure(0, 31), "0 h 31");
  assert.equal(heure(16, 39), "16 h 39");
});

test("textes du panneau : toutes les clés existent et sortent en JSON simple", () => {
  for (const l of ["en", "fr"]) {
    definirLangue(l);
    const d = textesWebview();
    assert.deepEqual(Object.keys(d).sort(), [...CLES_WEBVIEW].sort());
    for (const v of Object.values(d)) assert.equal(typeof v, "string");
  }
  definirLangue("fr");
  assert.equal(textesWebview()["web.actualiser"], "Actualiser les quotas");
  definirLangue("en");
  assert.equal(textesWebview()["web.actualiser"], "Refresh usage");
});

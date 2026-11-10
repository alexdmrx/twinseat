import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  compteDepuisNom, etiquettesValides, libelle, LONGUEUR_MAX, messageErreur, titreCompte, validerEtiquette,
  ErreurEtiquette,
} from "../etiquettes";
import { definirLangue } from "../textes";

afterEach(() => {
  definirLangue("en");
});

const ok = (v: unknown, c: "A" | "B" = "A", autre?: string) => {
  const r = validerEtiquette(v, c, autre);
  assert.ok(r.ok, `refusé : ${JSON.stringify(v)} → ${r.ok ? "" : r.erreur}`);
  return r.etiquette;
};
const refus = (v: unknown, attendu: ErreurEtiquette, c: "A" | "B" = "A", autre?: string) => {
  const r = validerEtiquette(v, c, autre);
  assert.ok(!r.ok, `accepté à tort : ${JSON.stringify(v)}`);
  assert.equal(r.erreur, attendu, JSON.stringify(v));
};

test("étiquette : lettres, chiffres, espace, _ . - (lettres Unicode comprises)", () => {
  assert.equal(ok("work"), "work");
  assert.equal(ok("Personal 2"), "Personal 2");
  assert.equal(ok("mon_compte.v-2"), "mon_compte.v-2");
  assert.equal(ok("Équipe été"), "Équipe été");
  assert.equal(ok("日本語"), "日本語");
  assert.equal(ok("Αλέξης"), "Αλέξης");
  assert.equal(ok("٣٤"), "٣٤"); // chiffres arabo-indiens : des chiffres
});

test("étiquette : espaces autour retirés, texte accentué normalisé (NFC)", () => {
  assert.equal(ok("  work  "), "work");
  assert.equal(ok("été"), "été");
  assert.equal(ok("été"), "été"); // « é » décomposé → composé
});

test("étiquette : vide ou pas du texte → refus « vide »", () => {
  for (const v of ["", "   ", undefined, null, 42, {}, [], true]) refus(v, "vide");
});

test("étiquette : 1 à 24 caractères (comptés en caractères, pas en unités UTF-16)", () => {
  assert.equal(LONGUEUR_MAX, 24);
  ok("x");
  ok("x".repeat(24));
  refus("x".repeat(25), "longueur");
  ok("é".repeat(24));
  ok("é".repeat(24)); // 24 « é » décomposés : 24 caractères après normalisation
  ok("日".repeat(24));
  ok("\u{1D49C}".repeat(24)); // lettre hors plan de base (2 unités UTF-16) : compte pour 1
  refus("\u{1D49C}".repeat(25), "longueur");
  ok(" ".repeat(5) + "x".repeat(24) + " ".repeat(5)); // les espaces autour ne comptent pas
});

test("étiquette : caractères interdits → « caracteres »", () => {
  for (const v of ["a/b", "wo<rk>", "a\\b", "x:y", "a,b", "(x)", "x!", "$HOME", "a@b", "x😀", "a\tb", "a\nb", "a b", "a​b", "../x", "a\u0000b"]) {
    refus(v, "caracteres");
  }
});

test("étiquette : jamais celle de l'autre compte, ni sa lettre (sans tenir compte de la casse)", () => {
  refus("Work", "doublon", "A", "work");
  refus("WORK", "doublon", "B", "Work");
  refus("été", "doublon", "A", "ÉTÉ");
  refus("b", "doublon", "A");
  refus("B", "doublon", "A");
  refus(" b ", "doublon", "A");
  refus("a", "doublon", "B");
  refus("A", "doublon", "B");
  ok("a", "A"); // la lettre de son propre compte reste permise
  ok("A", "A");
  ok("b", "B");
  ok("Ab", "A");
  ok("work", "A", "personal");
  ok("work", "A", undefined);
});

test("étiquettesValides : tout ce qui n'est pas un objet donne {}", () => {
  for (const v of [undefined, null, "work", 42, true, [], ["work", "home"], () => 1]) {
    assert.deepEqual(etiquettesValides(v), {});
  }
});

test("étiquettesValides : garde les valides, retire les autres (jamais d'exception)", () => {
  assert.deepEqual(etiquettesValides({ A: "work", B: "personal" }), { A: "work", B: "personal" });
  assert.deepEqual(etiquettesValides({ A: " work " }), { A: "work" });
  assert.deepEqual(etiquettesValides({ A: "bad/name", B: "ok" }), { B: "ok" });
  assert.deepEqual(etiquettesValides({ A: "", B: "   " }), {});
  assert.deepEqual(etiquettesValides({ A: 3, B: null }), {});
  assert.deepEqual(etiquettesValides({ A: "x".repeat(25), B: "y".repeat(24) }), { B: "y".repeat(24) });
  assert.deepEqual(etiquettesValides({ A: "work", C: "other", a: "lower" }), { A: "work" }); // clés inconnues ignorées
  assert.deepEqual(etiquettesValides(Object.create({ A: "hérité" })), {}); // pas de valeur héritée
});

test("étiquettesValides : la lettre de l'autre compte est refusée, la sienne permise", () => {
  assert.deepEqual(etiquettesValides({ A: "B" }), {});
  assert.deepEqual(etiquettesValides({ A: "b", B: "x" }), { B: "x" });
  assert.deepEqual(etiquettesValides({ B: "a" }), {});
  assert.deepEqual(etiquettesValides({ A: "a", B: "b" }), { A: "a", B: "b" });
});

test("étiquettesValides : deux noms identiques (casse comprise) → A garde le sien, B retombe sur sa lettre", () => {
  assert.deepEqual(etiquettesValides({ A: "Work", B: "work" }), { A: "Work" });
  assert.deepEqual(etiquettesValides({ A: "été", B: "ÉTÉ" }), { A: "été" });
  assert.deepEqual(etiquettesValides({ A: "work", B: "home" }), { A: "work", B: "home" });
});

test("libellé = étiquette, sinon la lettre ; titre = étiquette, sinon « Account A » / « Compte A »", () => {
  assert.equal(libelle("A", {}), "A");
  assert.equal(libelle("B", { A: "work" }), "B");
  assert.equal(libelle("A", { A: "work" }), "work");
  assert.equal(titreCompte("A", {}), "Account A");
  assert.equal(titreCompte("B", { A: "work" }), "Account B");
  assert.equal(titreCompte("A", { A: "work" }), "work");
  definirLangue("fr");
  assert.equal(titreCompte("B", {}), "Compte B");
  assert.equal(titreCompte("B", { B: "perso" }), "perso");
});

test("compteDepuisNom : étiquette (sans casse), lettre A/B, sinon rien", () => {
  const e = { A: "work", B: "Été perso" };
  assert.equal(compteDepuisNom("work", e), "A");
  assert.equal(compteDepuisNom("WORK", e), "A");
  assert.equal(compteDepuisNom("  Work  ", e), "A");
  assert.equal(compteDepuisNom("été perso", e), "B");
  assert.equal(compteDepuisNom("Été perso", e), "B"); // décomposé
  assert.equal(compteDepuisNom("A", e), "A");
  assert.equal(compteDepuisNom("b", e), "B");
  assert.equal(compteDepuisNom("a", {}), "A");
  for (const v of ["", "  ", "ghost", "AB", "C", "work2", 42, null, undefined, {}, ["A"], true]) {
    assert.equal(compteDepuisNom(v, e), undefined, JSON.stringify(v));
  }
  assert.equal(compteDepuisNom("work", {}), undefined); // sans étiquette, « work » n'est personne
});

test("messageErreur : un texte propre à chaque erreur, dans les deux langues", () => {
  const erreurs: ErreurEtiquette[] = ["vide", "longueur", "caracteres", "doublon"];
  const vus = new Set<string>();
  for (const l of ["en", "fr"]) {
    definirLangue(l);
    for (const e of erreurs) {
      const m = messageErreur(e);
      assert.ok(m.length > 0 && !/\{\w+\}/.test(m), `${l}/${e}: ${m}`);
      vus.add(`${l}|${m}`);
    }
  }
  assert.equal(vus.size, erreurs.length * 2); // tous différents
  definirLangue("en");
  assert.match(messageErreur("longueur"), /24/);
});

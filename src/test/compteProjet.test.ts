import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { etiquettesValides } from "../etiquettes";
import { resoudreCompte, texteOrigine } from "../compteProjet";
import { definirLangue } from "../textes";

afterEach(() => {
  definirLangue("en");
});

const ETIQ = { A: "work", B: "personal" };

test("réglage du projet valide (étiquette ou lettre, sans casse) → source « project-setting »", () => {
  assert.deepEqual(resoudreCompte("work", ETIQ, undefined), { compte: "A", source: "project-setting" });
  assert.deepEqual(resoudreCompte("Personal", ETIQ, undefined), { compte: "B", source: "project-setting" });
  assert.deepEqual(resoudreCompte(" PERSONAL ", ETIQ, "A"), { compte: "B", source: "project-setting" });
  assert.deepEqual(resoudreCompte("B", ETIQ, undefined), { compte: "B", source: "project-setting" });
  assert.deepEqual(resoudreCompte("a", {}, "B"), { compte: "A", source: "project-setting" });
});

test("ordre : réglage du projet, puis mémoire du projet, puis A", () => {
  assert.deepEqual(resoudreCompte("work", ETIQ, "B"), { compte: "A", source: "project-setting" }); // le réglage gagne
  assert.deepEqual(resoudreCompte("personal", ETIQ, "A"), { compte: "B", source: "project-setting" });
  assert.deepEqual(resoudreCompte("", ETIQ, "B"), { compte: "B", source: "remembered" });
  assert.deepEqual(resoudreCompte(undefined, ETIQ, "A"), { compte: "A", source: "remembered" });
  assert.deepEqual(resoudreCompte(undefined, ETIQ, undefined), { compte: "A", source: "default" });
  assert.deepEqual(resoudreCompte(undefined, {}, undefined), { compte: "A", source: "default" });
});

test("réglage absent : rien à signaler (undefined, null, vide, espaces)", () => {
  for (const v of [undefined, null, "", "   ", "\t\n"]) {
    const r = resoudreCompte(v, ETIQ, "B");
    assert.deepEqual(r, { compte: "B", source: "remembered" }, JSON.stringify(v));
    assert.ok(!("valeurIgnoree" in r));
  }
});

test("réglage inconnu : ignoré mais signalé, la mémoire (puis A) prend le relais", () => {
  assert.deepEqual(resoudreCompte("ghost", ETIQ, "B"), { compte: "B", source: "remembered", valeurIgnoree: "ghost" });
  assert.deepEqual(resoudreCompte("ghost", ETIQ, undefined), { compte: "A", source: "default", valeurIgnoree: "ghost" });
  assert.deepEqual(resoudreCompte("  ghost  ", ETIQ, undefined), { compte: "A", source: "default", valeurIgnoree: "ghost" });
  // sans étiquette, un ancien nom ne désigne plus personne
  assert.deepEqual(resoudreCompte("work", {}, "B"), { compte: "B", source: "remembered", valeurIgnoree: "work" });
  assert.deepEqual(resoudreCompte("C", ETIQ, undefined), { compte: "A", source: "default", valeurIgnoree: "C" });
});

test("réglage inconnu : jamais la source « project-setting »", () => {
  for (const v of ["ghost", "AB", 42, {}, ["A"], true]) {
    for (const memoire of [undefined, "A", "B"] as const) {
      const r = resoudreCompte(v, ETIQ, memoire);
      assert.notEqual(r.source, "project-setting", JSON.stringify(v));
      assert.ok(r.valeurIgnoree !== undefined, JSON.stringify(v));
    }
  }
});

test("valeur ignorée : texte lisible, court, sur une ligne (mauvais type compris)", () => {
  assert.equal(resoudreCompte(42, ETIQ, undefined).valeurIgnoree, "42");
  assert.equal(resoudreCompte(true, ETIQ, undefined).valeurIgnoree, "true");
  assert.equal(resoudreCompte(["A"], ETIQ, undefined).valeurIgnoree, '["A"]');
  assert.equal(resoudreCompte("a\nb\tc", ETIQ, undefined).valeurIgnoree, "a b c");
  const long = resoudreCompte("x".repeat(200), ETIQ, undefined).valeurIgnoree ?? "";
  assert.ok(long.length <= 41 && long.endsWith("…"), long);
});

test("un réglage lié à une étiquette devenue invalide n'est plus reconnu (retombe sur la lettre)", () => {
  const e = etiquettesValides({ A: "bad/name" });
  assert.deepEqual(resoudreCompte("bad/name", e, undefined), { compte: "A", source: "default", valeurIgnoree: "bad/name" });
  assert.deepEqual(resoudreCompte("A", e, "B"), { compte: "A", source: "project-setting" });
});

test("l'emplacement est toujours « A » ou « B » (jamais une étiquette)", () => {
  for (const v of ["work", "personal", "a", "b", "ghost", undefined, 3]) {
    for (const m of [undefined, "A", "B"] as const) {
      assert.match(resoudreCompte(v, ETIQ, m).compte, /^[AB]$/);
    }
  }
});

test("texteOrigine : d'où vient le compte (en)", () => {
  const e = ETIQ;
  assert.match(texteOrigine({ compte: "A", source: "project-setting" }, "A", e), /this project's settings/);
  assert.match(texteOrigine({ compte: "B", source: "remembered" }, "B", e), /remembered for this project/);
  assert.match(texteOrigine({ compte: "A", source: "default" }, "A", e), /default/);
});

test("texteOrigine : fenêtre changée à la main alors que le réglage dit autre chose", () => {
  const m = texteOrigine({ compte: "A", source: "project-setting" }, "B", ETIQ);
  assert.match(m, /this window/);
  assert.match(m, /work/); // le compte du réglage, par son nom
  assert.doesNotMatch(m, /\{/);
  // même compte : le réglage s'applique, pas de mention de dérive
  assert.doesNotMatch(texteOrigine({ compte: "A", source: "project-setting" }, "A", ETIQ), /this window/);
});

test("texteOrigine (fr)", () => {
  definirLangue("fr");
  assert.match(texteOrigine({ compte: "A", source: "project-setting" }, "A", ETIQ), /réglages de ce projet/);
  assert.match(texteOrigine({ compte: "B", source: "remembered" }, "B", ETIQ), /mémorisé pour ce projet/);
  assert.match(texteOrigine({ compte: "A", source: "default" }, "A", ETIQ), /par défaut/);
  assert.match(texteOrigine({ compte: "A", source: "project-setting" }, "B", ETIQ), /work/);
});

test("texteOrigine : trois sources, trois textes différents, aucune variable laissée", () => {
  for (const l of ["en", "fr"]) {
    definirLangue(l);
    const textes = (["project-setting", "remembered", "default"] as const).map((source) =>
      texteOrigine({ compte: "A", source }, "A", {}),
    );
    assert.equal(new Set(textes).size, 3);
    for (const x of textes) assert.doesNotMatch(x, /\{\w+\}/);
  }
});

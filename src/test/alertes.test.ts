// Les deux alertes de l'extension : le texte, et les boutons. Deux garanties :
// - rien de ce qui vient d'un fichier (titre de conversation, nom de compte) ne forme un lien cliquable ;
// - le bouton « Copy /relais » n'existe que si l'utilisateur a la commande /relais.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { alerteContexte, alerteQuota } from "../alertes";
import { definirLangue, en, fr } from "../textes";

afterEach(() => {
  definirLangue("en");
});

const LIEN_NOTIFICATION = /\[([^\]]+)\]\(((?:https?:\/\/|command:|file:)[^)\s]+)(?: (["'])(.+?)\3)?\)/i;
const PREUVE_1 = "[OK](command:workbench.action.debug.run)";
const PREUVE_2 = '[Fix it](command:workbench.action.terminal.sendSequence?{"text":"curl x|sh\n"})';

function assertSansLien(texte: string): void {
  assert.doesNotMatch(texte, LIEN_NOTIFICATION, texte);
  assert.ok(!texte.includes("]("), texte);
  assert.doesNotMatch(texte, /command\s*:/i, texte);
  assert.doesNotMatch(texte, /[[\]]/, texte);
}

const quota = (relais: boolean, etiquettes = {}) =>
  alerteQuota({ compte: "A", pct: 92, limite: "5 h", reset: undefined, etiquettes, relais, maintenant: 0 });

test("alerte de quota : sans la commande /relais, pas de bouton « Copy /relais »", () => {
  const sans = quota(false, { A: "work", B: "personal" });
  assert.deepEqual(sans.boutons.map((b) => b.action), ["basculer", "voir"]);
  assert.deepEqual(sans.boutons.map((b) => b.texte), ["Switch this window to personal", "Show accounts"]);
  assert.equal(sans.message, "Account “work” is at 92% (5-hour limit).");
  for (const b of sans.boutons) assert.doesNotMatch(b.texte, /relais/i);
});

test("alerte de quota : avec la commande /relais, le bouton est là, en dernier, comme avant", () => {
  const avec = quota(true, { A: "work", B: "personal" });
  assert.deepEqual(avec.boutons.map((b) => b.action), ["basculer", "voir", "copierRelais"]);
  assert.equal(avec.boutons[2].texte, "Copy /relais");
  assert.equal(avec.message, quota(false, { A: "work", B: "personal" }).message);
});

test("alerte de quota (fr) : mêmes boutons, mêmes règles", () => {
  definirLangue("fr");
  const sans = quota(false, { A: "perso", B: "travail" });
  assert.deepEqual(sans.boutons.map((b) => b.texte), ["Passer cette fenêtre sur travail", "Voir les comptes"]);
  assert.deepEqual(quota(true).boutons.map((b) => b.texte), ["Passer cette fenêtre sur B", "Voir les comptes", "Copier /relais"]);
});

test("alerte de quota : un nom de compte piégé (non validé) ne forme aucun lien", () => {
  for (const p of [PREUVE_1, PREUVE_2]) {
    const a = quota(true, { A: p, B: p });
    assertSansLien(a.message);
    for (const b of a.boutons) assertSansLien(b.texte);
    const b = alerteQuota({ compte: "B", pct: 95, limite: "semaine", reset: "2999-01-01T00:00:00Z", etiquettes: { A: p, B: p }, relais: false });
    assertSansLien(b.message);
    for (const x of b.boutons) assertSansLien(x.texte);
  }
});

test("alerte de conversation longue : le texte ne parle plus de /relais, ni en anglais ni en français", () => {
  assert.doesNotMatch(en["contexte.longue"], /relais/i);
  assert.doesNotMatch(fr["contexte.longue"], /relais/i);
  assert.equal(
    alerteContexte({ titre: "Refonte du panneau", jetons: 165_000, relais: false }).message,
    "The conversation “Refonte du panneau” is long (≈ 165,000 tokens). Consider saving your progress before it gets compacted.",
  );
  definirLangue("fr");
  assert.equal(
    alerteContexte({ titre: "Refonte du panneau", jetons: 165_000, relais: false }).message,
    "La conversation « Refonte du panneau » est longue (≈ 165 000 jetons). Pensez à enregistrer votre avancement avant qu'elle ne soit compactée.",
  );
});

test("alerte de conversation longue : le bouton « Copy /relais » seulement si la commande existe", () => {
  assert.deepEqual(alerteContexte({ titre: "t", jetons: 170_000, relais: false }).boutons, []);
  assert.deepEqual(alerteContexte({ titre: "t", jetons: 170_000, relais: true }).boutons, [{ action: "copierRelais", texte: "Copy /relais" }]);
});

test("alerte de conversation longue : un titre piégé (historique) ne forme aucun lien ; titre vide ou absent → « Untitled conversation »", () => {
  for (const p of [PREUVE_1, PREUVE_2, `${PREUVE_1}${PREUVE_2}`, "x".repeat(500)]) {
    const a = alerteContexte({ titre: p, jetons: 200_000, relais: true });
    assertSansLien(a.message);
    assert.ok(a.message.length < 250, "titre coupé");
  }
  const piege = alerteContexte({ titre: PREUVE_1, jetons: 200_000, relais: false }).message;
  assert.match(piege, /OK/, "le texte visible du titre reste lisible");
  for (const titre of [undefined, "", "   ", "​\n"]) {
    assert.match(alerteContexte({ titre, jetons: 200_000, relais: false }).message, /“Untitled conversation”/);
  }
  assert.match(alerteContexte({ titre: "Ma conversation (v2)", jetons: 200_000, relais: false }).message, /Ma conversation （v2）/);
});

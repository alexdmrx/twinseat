// Aucun texte venu de l'extérieur (titre de conversation, valeur de réglage, adresse lue dans un fichier)
// ne doit pouvoir former un lien dans une notification : VS Code rend `[x](command:…)` cliquable, et un clic
// exécute la commande. Ici : le texte sûr, les endroits où il est appliqué, et une garde contre l'oubli.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { resoudreCompte } from "../compteProjet";
import { libelle, titreCompte } from "../etiquettes";
import { definirLangue, en, fr, t, tSur } from "../textes";
import { texteSur, texteSurOptionnel } from "../texteSur";

afterEach(() => {
  definirLangue("en");
});

/** L'expression que VS Code utilise pour reconnaître un lien dans le texte d'une notification (linkedText.ts). */
const LIEN_NOTIFICATION = /\[([^\]]+)\]\(((?:https?:\/\/|command:|file:)[^)\s]+)(?: (["'])(.+?)\3)?\)/i;

const PREUVE_1 = "[OK](command:workbench.action.debug.run)";
// Deux écritures du saut de ligne de la preuve : le vrai caractère, et l'échappement JSON (barre oblique + n).
const PREUVE_2 = '[Fix it](command:workbench.action.terminal.sendSequence?{"text":"curl x|sh\n"})';
const PREUVE_2B = '[Fix it](command:workbench.action.terminal.sendSequence?{"text":"curl x|sh\\n"})';
// La même, encodée comme VS Code l'attend dans une URL (sans espace) : celle-là, VS Code en ferait bien un lien.
const PREUVE_2C = "[Fix it](command:workbench.action.terminal.sendSequence?%7B%22text%22%3A%22curl%20x%7Csh%5Cn%22%7D)";
const PREUVES = [PREUVE_1, PREUVE_2, PREUVE_2B, PREUVE_2C];

/** Un texte dont on ne peut plus faire un lien : ni « ]( », ni crochets ou parenthèses, ni schéma exécutable. */
function assertSans(lien: string, contexte = ""): void {
  assert.ok(!lien.includes("]("), `« ]( » dans ${JSON.stringify(lien)} ${contexte}`);
  assert.doesNotMatch(lien, /[[\]()]/, `crochet ou parenthèse dans ${JSON.stringify(lien)} ${contexte}`);
  assert.doesNotMatch(lien, /command\s*:/i, `command: dans ${JSON.stringify(lien)} ${contexte}`);
  assert.doesNotMatch(lien, /(?:file|https?|vscode|javascript)\s*:/i, `schéma dans ${JSON.stringify(lien)} ${contexte}`);
  assert.doesNotMatch(lien, LIEN_NOTIFICATION, `lien de notification dans ${JSON.stringify(lien)} ${contexte}`);
  assert.doesNotMatch(lien, /[\p{Cc}\p{Cf}]/u, `caractère de contrôle dans ${JSON.stringify(lien)} ${contexte}`);
}

test("texteSur : les deux preuves sortent sans « ]( », sans « command: » et sans lien possible", () => {
  for (const p of PREUVES) {
    const s = texteSur(p);
    assertSans(s);
    assert.ok(s.includes("OK") || s.includes("Fix it"), "le texte visible reste lisible");
  }
  // ce que VS Code aurait rendu cliquable avant, ne l'est plus après
  assert.match(PREUVE_1, LIEN_NOTIFICATION);
  assert.match(PREUVE_2C, LIEN_NOTIFICATION);
});

test("texteSur : les titres ordinaires restent lisibles", () => {
  for (const titre of [
    "Fix the login bug",
    "Refactor: split the module",
    "Résumé de la réunion — équipe",
    "Déploiement 🚀 prod",
    "Profile: review the settings", // « file: » à l'intérieur d'un mot n'est pas un schéma
    "日本語のタイトル",
    "a_b-c.d",
    "Ratio 3:1 at 12:30",
    "Data: nettoyage de la base",
  ]) {
    assert.equal(texteSur(titre), titre);
  }
  // Les parenthèses et crochets changent de forme, rien d'autre ne bouge.
  const s = texteSur("Fix bug (auth) [urgent]");
  assert.equal(s, "Fix bug （auth） ［urgent］");
  assertSans(s);
});

test("texteSur : les schémas command:, file:, http(s):// et les autres sont brisés, quelle que soit la casse", () => {
  for (const x of [
    "command:workbench.action.reloadWindow",
    "COMMAND:x",
    "Command : x",
    "file:///etc/passwd",
    "http://evil.example/x",
    "https://evil.example/x",
    "vscode://file/etc/passwd",
    "javascript:alert(1)",
    "see (command:a) and [b](file:c)",
  ]) {
    assertSans(texteSur(x), x);
  }
});

test("texteSur : les caractères invisibles ne cachent rien (zéro largeur, sens d'écriture, contrôles)", () => {
  for (const x of [
    "com​mand:workbench.action.debug.run",
    "[x]​(command:y)",
    "‮[x](command:y)‬",
    "[x]\u0000(command:y)",
    "[x]\n(command:y)",
    "[x] (command:y)",
    "[x]­(command:y)",
    "﻿[x](file:///y)",
  ]) {
    assertSans(texteSur(x), JSON.stringify(x));
  }
  assert.equal(texteSur("a\nb\r\nc\td"), "a b c d");
  assert.equal(texteSur("  a\u0000b  "), "a b");
  assert.equal(texteSur("a​b‮c"), "abc");
  assert.equal(texteSur("165 000"), "165 000", "l'espace fine insécable des milliers (fr) est gardée");
});

test("texteSur : coupé à `max` caractères, jamais au milieu d'un emoji, avec « … »", () => {
  const long = texteSur("x".repeat(500), 80);
  assert.equal([...long].length, 80);
  assert.ok(long.endsWith("…"));
  assert.equal(texteSur("x".repeat(80), 80), "x".repeat(80), "pile à la limite : rien ne change");
  assert.equal([...texteSur("y".repeat(500))].length, 80, "80 par défaut");
  const emojis = texteSur("😀".repeat(100), 10);
  assert.equal([...emojis].length, 10);
  assert.equal(Buffer.from(emojis, "utf8").toString("utf8"), emojis, "aucune demi-paire isolée");
  assert.equal(texteSur("abc", 1), "…");
  assert.equal(texteSur("abc", 0), "…", "une limite absurde ne plante pas");
});

test("texteSur : undefined et null → vide, un nombre s'écrit, un texte sûr ne change plus (idempotent)", () => {
  assert.equal(texteSur(undefined), "");
  assert.equal(texteSur(null), "");
  assert.equal(texteSur(42), "42");
  assert.equal(texteSur("   "), "");
  for (const p of [...PREUVES, "x".repeat(300), "Fix bug (auth)", "a\nb"]) {
    const une = texteSur(p);
    assert.equal(texteSur(une), une, JSON.stringify(p));
  }
  assert.equal(texteSurOptionnel(undefined), undefined);
  assert.equal(texteSurOptionnel(""), undefined);
  assert.equal(texteSurOptionnel("​"), undefined);
  assert.equal(texteSurOptionnel("jane@example.com", 100), "jane@example.com");
});

test("tSur : chaque variable textuelle est rendue sûre, dans les deux langues ; le modèle et les nombres ne changent pas", () => {
  for (const l of ["en", "fr"]) {
    definirLangue(l);
    for (const p of PREUVES) {
      for (const message of [
        tSur("projet.reglageInconnu", { valeur: p }),
        tSur("contexte.longue", { titre: p, jetons: "165,000" }),
        tSur("fenetre.change", { compte: p }),
        tSur("relais.reprise", { compte: p, texte: p }),
        tSur("alias.confirmer", { fichier: `/Users/x/${p}/.zshrc` }),
      ]) {
        // (les parenthèses du modèle sont les nôtres : seul ce qui forme un lien, ou un schéma, compte)
        assert.doesNotMatch(message, LIEN_NOTIFICATION, l);
        assert.ok(!message.includes("]("), l);
        assert.doesNotMatch(message, /[[\]]/, l);
        assert.doesNotMatch(message, /command\s*:/i, l);
        assert.doesNotMatch(message, /[\p{Cc}\p{Cf}]/u, l);
      }
    }
  }
  // Le modèle est le nôtre : ses parenthèses restent ; les nombres passent tels quels.
  definirLangue("en");
  assert.match(tSur("contexte.longue", { titre: "t", jetons: "165,000" }), /\(≈ 165,000 tokens\)/);
  assert.equal(tSur("fmt.pourcent", { n: 62 }), t("fmt.pourcent", { n: 62 }));
  assert.equal(tSur("fmt.pourcent"), "{n}%");
});

test("valeur de réglage ignorée (twinseat.account) : sûre dès sa source, 40 caractères au plus", () => {
  for (const p of PREUVES) {
    const v = resoudreCompte(p, { A: "work", B: "personal" }, undefined).valeurIgnoree ?? "";
    assert.ok(v.length > 0);
    assertSans(v);
    assert.ok([...v].length <= 41);
  }
  assert.equal(resoudreCompte("ghost", {}, undefined).valeurIgnoree, "ghost");
});

test("étiquettes de comptes : sûres même si une valeur non validée y arrive", () => {
  const piege = { A: PREUVE_1, B: "ok" };
  assertSans(libelle("A", piege));
  assertSans(titreCompte("A", piege));
  assert.equal(libelle("B", piege), "ok");
  assert.equal(libelle("A", {}), "A");
  assert.equal(titreCompte("B", {}), "Account B");
  assert.equal(libelle("A", { A: "work" }), "work");
  assert.equal(titreCompte("A", { A: "work" }), "work");
  assert.equal(libelle("A", { A: "​" }), "A", "un nom qui devient vide retombe sur la lettre");
});

test("aucun texte fixe de l'interface ne contient la syntaxe d'un lien", () => {
  for (const [nom, table] of [["en", en], ["fr", fr]] as const) {
    for (const [cle, texte] of Object.entries(table)) {
      assert.ok(!texte.includes("]("), `${nom}.${cle} : « ]( »`);
      assert.doesNotMatch(texte, LIEN_NOTIFICATION, `${nom}.${cle}`);
    }
  }
});

// --- Garde contre l'oubli : un module qui parle à vscode n'appelle jamais `t` avec des variables ---------

const RACINE = path.resolve(__dirname, "../..");
const MODULES_VSCODE = ["extension.ts", "fenetre.ts", "alias.ts", "verification.ts", "panneau.ts", "onglets.ts", "reglages.ts"];

/** Les appels `t(…)` d'un source, chacun avec son texte d'arguments (parenthèses et guillemets équilibrés). */
function appelsT(source: string): string[] {
  const appels: string[] = [];
  for (const m of source.matchAll(/(?<![\w.$])t\(/g)) {
    let profondeur = 1;
    let i = (m.index ?? 0) + m[0].length;
    const debut = i;
    let guillemet = "";
    for (; i < source.length && profondeur > 0; i++) {
      const c = source[i];
      if (guillemet) {
        if (c === "\\") i++;
        else if (c === guillemet) guillemet = "";
      } else if (c === '"' || c === "'" || c === "`") guillemet = c;
      else if (c === "(") profondeur++;
      else if (c === ")") profondeur--;
    }
    appels.push(source.slice(debut, i - 1));
  }
  return appels;
}

test("garde : dans les modules qui parlent à vscode, `t` ne reçoit jamais de variables (c'est `tSur`)", () => {
  for (const f of MODULES_VSCODE) {
    const source = fs.readFileSync(path.join(RACINE, "src", f), "utf8");
    for (const args of appelsT(source)) {
      assert.ok(!args.includes("{"), `${f} : t(${args}) passe des variables sans tSur`);
    }
  }
  // la garde voit bien ce qu'elle doit voir
  assert.deepEqual(appelsT('x(t("a.b"), t("c", { n: 1 }), tSur("d", { n: 2 }))'), ['"a.b"', '"c", { n: 1 }']);
});

test("garde : extension.ts compose ses alertes avec alertes.ts, et n'y met aucun titre ni nom brut", () => {
  const source = fs.readFileSync(path.join(RACINE, "src", "extension.ts"), "utf8");
  assert.match(source, /alerteQuota\(/);
  assert.match(source, /alerteContexte\(/);
  assert.doesNotMatch(source, /phraseAlerte|jetonsTexte|COPIER_RELAIS/);
  // toute description de menu venue d'un fichier (l'adresse) passe par texteSurOptionnel
  for (const f of ["extension.ts", "fenetre.ts"]) {
    const s = fs.readFileSync(path.join(RACINE, "src", f), "utf8");
    assert.doesNotMatch(s, /description:\s*infosCompte/, `${f} : adresse brute dans un menu`);
  }
});

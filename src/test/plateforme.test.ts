import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { pageNonSupportee, PLATEFORMES_SUPPORTEES, plateformeSupportee } from "../plateforme";
import { definirLangue, en, fr, t } from "../textes";

test("plateformeSupportee : macOS et Linux, aucune autre", () => {
  assert.deepEqual([...PLATEFORMES_SUPPORTEES].sort(), ["darwin", "linux"]);
  assert.equal(plateformeSupportee("darwin"), true);
  assert.equal(plateformeSupportee("linux"), true);
  for (const autre of ["win32", "freebsd", "openbsd", "sunos", "aix", "android", "cygwin", "Linux", "darwin ", ""]) {
    assert.equal(plateformeSupportee(autre), false, JSON.stringify(autre));
  }
});

test("plateformeSupportee : sans argument, lit la plateforme du processus", () => {
  assert.equal(plateformeSupportee(), process.platform === "darwin" || process.platform === "linux");
});

test("le message de plateforme existe dans les deux langues et nomme macOS et Linux", () => {
  assert.match(en["plateforme.nonSupportee"], /macOS/);
  assert.match(en["plateforme.nonSupportee"], /Linux/);
  assert.match(fr["plateforme.nonSupportee"], /macOS/);
  assert.match(fr["plateforme.nonSupportee"], /Linux/);
  assert.notEqual(en["plateforme.nonSupportee"], fr["plateforme.nonSupportee"]);
  definirLangue("fr");
  assert.equal(t("plateforme.nonSupportee"), fr["plateforme.nonSupportee"]);
  definirLangue("en");
});

test("pageNonSupportee : le texte (échappé), ni script ni bouton", () => {
  const page = pageNonSupportee("Only <macOS> & \"Linux\"", "en");
  assert.match(page, /^<!DOCTYPE html>/);
  assert.match(page, /<html lang="en">/);
  assert.ok(page.includes("Only &lt;macOS&gt; &amp; &quot;Linux&quot;"));
  assert.ok(!page.includes("<macOS>"));
  assert.doesNotMatch(page, /<script|<button|<a |onclick|acquireVsCodeApi/i);
  assert.match(page, /Content-Security-Policy/);
  assert.match(page, /default-src 'none'/);
  assert.doesNotMatch(page, /script-src/);
});

test("pageNonSupportee : la langue est écrite telle quelle dans lang", () => {
  assert.match(pageNonSupportee("x", "fr"), /<html lang="fr">/);
});

test("extension.ts : la garde de plateforme précède toute installation et tout réglage", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src/extension.ts"), "utf8");
  const debut = source.indexOf("export function activate(");
  assert.ok(debut >= 0);
  const garde = source.indexOf("plateformeSupportee(", debut);
  assert.ok(garde > debut, "la garde doit être dans activate");
  for (const motif of ["installer(", "process.env.CLAUDE_COMPTE_FENETRE =", "initFenetre(", "createStatusBarItem(", "getConfiguration("]) {
    const i = source.indexOf(motif, debut);
    assert.ok(i > garde, `« ${motif} » doit venir après la garde de plateforme`);
  }
});

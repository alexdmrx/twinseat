import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

// Ce fichier compile dans out/test/ : la racine du projet est deux dossiers plus haut.
const RACINE = path.resolve(__dirname, "../..");
const lire = (f: string): string => fs.readFileSync(path.join(RACINE, f), "utf8");
const lireJson = (f: string) => JSON.parse(lire(f)) as Record<string, any>;

const pkg = lireJson("package.json");
const nls = lireJson("package.nls.json");
const nlsFr = lireJson("package.nls.fr.json");

/** Toutes les chaînes « %clé% » de package.json. */
function cles(v: unknown, trouvees = new Set<string>()): Set<string> {
  if (typeof v === "string") {
    const m = /^%(.+)%$/.exec(v);
    if (m) trouvees.add(m[1]);
  } else if (v && typeof v === "object") {
    for (const x of Object.values(v)) cles(x, trouvees);
  }
  return trouvees;
}

test("package.nls : mêmes clés en anglais et en français, toutes utilisées par package.json", () => {
  assert.deepEqual(Object.keys(nlsFr).sort(), Object.keys(nls).sort());
  const utilisees = cles(pkg);
  for (const c of utilisees) assert.ok(c in nls, `clé absente de package.nls.json : ${c}`);
  for (const c of Object.keys(nls)) assert.ok(utilisees.has(c), `clé jamais utilisée : ${c}`);
  for (const v of [...Object.values(nls), ...Object.values(nlsFr)]) assert.ok(typeof v === "string" && v.length > 0);
});

test("réglages : twinseat.accountLabels (application) et twinseat.account (resource), décrits par une clé nls", () => {
  const p = pkg.contributes.configuration.properties as Record<string, any>;
  const etiquettes = p["twinseat.accountLabels"];
  assert.equal(etiquettes.type, "object");
  assert.equal(etiquettes.scope, "application");
  assert.deepEqual(etiquettes.default, {});
  assert.match(etiquettes.description, /^%.+%$/);
  const compte = p["twinseat.account"];
  assert.equal(compte.type, "string");
  assert.equal(compte.scope, "resource");
  assert.equal(compte.default, "");
  assert.match(compte.description, /^%.+%$/);
  assert.match(pkg.contributes.configuration.title, /^%.+%$/);
});

test("commandes : chaque commande déclarée est enregistrée dans extension.ts, et réciproquement", () => {
  const source = lire("src/extension.ts");
  const enregistrees = new Set([...source.matchAll(/\bcmd\("(\w+)"/g)].map((m) => `claudeComptes.${m[1]}`));
  const declarees = new Set<string>((pkg.contributes.commands as { command: string }[]).map((c) => c.command));
  for (const c of declarees) assert.ok(enregistrees.has(c), `déclarée mais pas enregistrée : ${c}`);
  for (const c of enregistrees) assert.ok(declarees.has(c), `enregistrée mais pas déclarée : ${c}`);
  for (const c of ["claudeComptes.nommerCompte", "claudeComptes.epinglerProjet"]) assert.ok(declarees.has(c), c);
});

test("commandes de vérification et de diagnostic : déclarées avec un titre traduit, et le panneau a son bouton", () => {
  const titres = new Map((pkg.contributes.commands as { command: string; title: string }[]).map((c) => [c.command, c.title]));
  assert.equal(titres.get("claudeComptes.verifier"), "%command.verifier.title%");
  assert.equal(titres.get("claudeComptes.diagnostic"), "%command.diagnostic.title%");
  assert.equal(nls["command.verifier.title"], "Twinseat: Check and Repair Setup");
  assert.equal(nls["command.diagnostic.title"], "Twinseat: Copy Diagnostics");
  // elles restent dans la palette de commandes (pas masquées par un « when: false »)
  const masquees = (pkg.contributes.menus.commandPalette as { command: string; when: string }[]).filter((m) => m.when === "false").map((m) => m.command);
  assert.ok(!masquees.includes("claudeComptes.verifier") && !masquees.includes("claudeComptes.diagnostic"));
  // le bouton du panneau : action de la liste fermée, relayée vers la commande
  assert.match(lire("src/panneau.ts"), /case "verifier":\s+void vscode\.commands\.executeCommand\("claudeComptes\.verifier"\)/);
  assert.match(lire("src/panneau.ts"), /bouton\(tr\('web\.verifier'\), \{ action: 'verifier' \}, true\)/);
});

test("désinstallation : vscode:uninstall lance out/desinstallation.js, jsonc-parser est une dépendance livrée dans le .vsix", () => {
  assert.equal(pkg.scripts["vscode:uninstall"], "node ./out/desinstallation.js");
  assert.match(pkg.dependencies["jsonc-parser"], /^\^?3\.\d+\.\d+$/);
  assert.ok(!("jsonc-parser" in (pkg.devDependencies ?? {})));
  assert.ok(!/from "vscode"|require\("vscode"\)/.test(lire("src/desinstallation.ts")), "le crochet de désinstallation tourne sans l'API vscode");
  // .vscodeignore ne doit pas exclure tout node_modules : le crochet a besoin de jsonc-parser
  const ignores = lire(".vscodeignore").split("\n").map((l) => l.trim());
  assert.ok(!ignores.includes("node_modules/**") && !ignores.includes("node_modules"), "node_modules exclu du .vsix");
  assert.ok(!ignores.some((l) => /^node_modules\/jsonc-parser\/(\*\*|lib\/\*\*|lib\/umd(\/.*)?|package\.json)$/.test(l)), "jsonc-parser (umd) exclu du .vsix");
  assert.ok(!ignores.includes("out/**") && !ignores.includes("out/desinstallation.js"));
});

test("les emplacements restent A et B : identifiants internes inchangés", () => {
  const ids = (pkg.contributes.commands as { command: string }[]).map((c) => c.command);
  for (const id of ["claudeComptes.bulleA", "claudeComptes.bulleB", "claudeComptes.choisirCompte"]) assert.ok(ids.includes(id), id);
  assert.match(lire("src/chemins.ts"), /COMPTES: readonly Compte\[\] = \["A", "B"\]/);
});

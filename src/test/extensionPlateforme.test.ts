// Fait tourner activate() avec un « vscode » factice sur une plateforme non prise en charge :
// il doit montrer UN message, poser le panneau et les commandes qui répètent ce message, et rien d'autre
// (aucun fichier, aucun réglage, aucune variable d'environnement, aucun minuteur).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Module from "node:module";
import { en } from "../textes";

type Obj = Record<string, any>;

const appels: { nom: string; args: unknown[] }[] = [];
const touches: string[] = []; // tout ce que activate() a touché sans que le test l'ait prévu
const vues = new Map<string, Obj>();
const commandes = new Map<string, (...a: unknown[]) => unknown>();

/** Objet dont tout accès à un membre non prévu est noté dans `touches`. */
function espion(prefixe: string, prevus: Obj): Obj {
  return new Proxy(prevus, {
    get(cible, prop) {
      if (typeof prop === "symbol" || prop in cible) return cible[prop as string];
      touches.push(`${prefixe}.${prop}`);
      return undefined;
    },
  });
}

const dispose = () => ({ dispose() {} });
const vscodeFaux = espion("vscode", {
  __esModule: true, // le compilateur lit ce drapeau en important le module
  env: espion("vscode.env", { language: "en" }),
  window: espion("vscode.window", {
    showInformationMessage: (...args: unknown[]) => {
      appels.push({ nom: "showInformationMessage", args });
      return Promise.resolve(undefined);
    },
    registerWebviewViewProvider: (id: string, fournisseur: Obj) => {
      vues.set(id, fournisseur);
      return dispose();
    },
  }),
  commands: espion("vscode.commands", {
    registerCommand: (id: string, f: (...a: unknown[]) => unknown) => {
      commandes.set(id, f);
      return dispose();
    },
  }),
  EventEmitter: class {
    event = () => dispose();
    fire() {}
  },
});

const charger = (Module as unknown as { _load: (requete: string, ...reste: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (this: unknown, requete: string, ...reste: unknown[]) {
  return requete === "vscode" ? vscodeFaux : charger.call(this, requete, ...reste);
};

const plateformeReelle = Object.getOwnPropertyDescriptor(process, "platform")!;
const maisonReelle = process.env.HOME;
const maison = fs.mkdtempSync(path.join(os.tmpdir(), "plateforme-test-"));
after(() => {
  Object.defineProperty(process, "platform", plateformeReelle);
  if (maisonReelle === undefined) delete process.env.HOME;
  else process.env.HOME = maisonReelle;
  fs.rmSync(maison, { recursive: true, force: true });
});

const RACINE = path.resolve(__dirname, "../..");
const pkg = JSON.parse(fs.readFileSync(path.join(RACINE, "package.json"), "utf8")) as Obj;

test("plateforme non prise en charge : un message, le panneau, des commandes qui répètent le message, rien d'autre", async () => {
  Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  process.env.HOME = maison;
  delete process.env.CLAUDE_COMPTE_FENETRE;
  const souscriptions: unknown[] = [];
  const contexte = espion("context", {
    subscriptions: souscriptions,
    extension: espion("context.extension", { packageJSON: pkg }),
  });

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const extension = require("../extension") as { activate(c: unknown): void };
  extension.activate(contexte);

  // Un seul message, traduit, qui nomme macOS et Linux.
  assert.equal(appels.length, 1);
  assert.equal(appels[0].nom, "showInformationMessage");
  assert.equal(appels[0].args[0], en["plateforme.nonSupportee"]);
  assert.match(String(appels[0].args[0]), /macOS and Linux/);

  // Rien n'a été fait : ni dossier, ni variable, ni accès hors du plan.
  assert.deepEqual(fs.readdirSync(maison), []);
  assert.equal(process.env.CLAUDE_COMPTE_FENETRE, undefined);
  assert.deepEqual(touches, []);

  // Le panneau montre le même texte, sans script ni bouton.
  const panneau = vues.get("claudeComptes.panneau");
  assert.ok(panneau, "panneau enregistré");
  const vue: Obj = { webview: { options: {}, html: "", cspSource: "vscode-resource:" }, onDidDispose: dispose, onDidChangeVisibility: dispose };
  panneau.resolveWebviewView(vue);
  assert.ok(vue.webview.html.includes(en["plateforme.nonSupportee"]));
  assert.doesNotMatch(vue.webview.html, /<script|<button/i);
  assert.notEqual(vue.webview.options.enableScripts, true);

  // Chaque commande déclarée existe (pas de « commande introuvable ») et ne fait que répéter le message.
  const declarees = (pkg.contributes.commands as { command: string }[]).map((c) => c.command);
  for (const id of declarees) assert.ok(commandes.has(id), `commande non enregistrée : ${id}`);
  assert.deepEqual([...commandes.keys()].sort(), [...declarees].sort());
  appels.length = 0;
  for (const id of declarees) {
    await commandes.get(id)!("A");
    assert.equal(appels.length, 1, id);
    assert.equal(appels[0].args[0], en["plateforme.nonSupportee"], id);
    appels.length = 0;
  }
  assert.deepEqual(fs.readdirSync(maison), []);
  assert.deepEqual(touches, []);
  assert.equal(souscriptions.length, declarees.length + 1); // les commandes et le panneau, rien d'autre
});

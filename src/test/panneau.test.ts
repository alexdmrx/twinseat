// Le panneau, de bout en bout sans VS Code : l'état qu'il calcule (avec un « vscode » factice et un dossier
// personnel jetable) et la page qui l'affiche (son script tourne dans un bac à sable avec un faux DOM).
// Ce qu'on vérifie : la formule d'abonnement s'écrit « Max », et la section « Handoff notes » n'existe que si
// l'utilisateur a la commande /relais.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vm from "node:vm";
import Module from "node:module";
import type { Etat, Panneau } from "../panneau";
import { dossierRelais } from "../relais";
import { definirLangue } from "../textes";

type Obj = Record<string, any>;

// panneau.ts n'utilise de vscode, hors types, que ce qu'il appelle à la demande : rien ne sert ici.
const charger = (Module as unknown as { _load: (requete: string, ...reste: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (this: unknown, requete: string, ...reste: unknown[]) {
  return requete === "vscode" ? { __esModule: true, commands: {}, window: {}, Uri: {} } : charger.call(this, requete, ...reste);
};

const maisonReelle = process.env.HOME;
const racines: string[] = [];
after(() => {
  if (maisonReelle === undefined) delete process.env.HOME;
  else process.env.HOME = maisonReelle;
  for (const r of racines) fs.rmSync(r, { recursive: true, force: true });
});

/** Une maison jetable : deux comptes connectés (plans « max » et « pro »), un projet, une note de relais. */
function maison(): { home: string; projet: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "panneau-test-"));
  racines.push(home);
  process.env.HOME = home;
  const projet = path.join(home, "projet");
  fs.mkdirSync(projet, { recursive: true });
  for (const [c, plan] of [["A", "max"], ["B", "pro"]] as const) {
    const dossier = path.join(home, ".claude", "comptes", c);
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: `${c.toLowerCase()}@example.com` } }));
    fs.mkdirSync(path.join(home, ".claude", "comptes", "quotas"), { recursive: true });
    fs.writeFileSync(
      path.join(home, ".claude", "comptes", "quotas", `${c}.json`),
      JSON.stringify({ compte: c, majLe: Date.now(), source: "direct", plan, cinqHeures: { pct: 42 }, semaine: { pct: 10 } }),
    );
  }
  const notes = dossierRelais(projet, home);
  fs.mkdirSync(notes, { recursive: true });
  fs.writeFileSync(path.join(notes, "2026-11-08-1530.md"), "# Relais — Refonte du panneau — 2026-11-08 15:30\n\ncorps\n");
  return { home, projet };
}

function panneau(projet: string | undefined): Panneau {
  // Chargé ici, une fois le « vscode » factice en place (les imports du haut sont exécutés avant lui).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Panneau: Classe } = require("../panneau") as typeof import("../panneau");
  return new Classe({
    compteFenetre: () => "A",
    etatLanceur: () => "actif",
    quandCompteChange: (() => ({ dispose() {} })) as never,
    dossierProjet: () => projet,
    etiquettes: () => ({}),
  });
}

const etatDe = (p: Panneau): Promise<Etat> => (p as unknown as { etat(): Promise<Etat> }).etat();

/** Un nœud de faux DOM : juste ce que le script de la page appelle. */
function noeud(tag: string): Obj {
  return {
    tag,
    className: "",
    title: "",
    style: {},
    enfants: [] as Obj[],
    _texte: "",
    appendChild(c: Obj) {
      this.enfants.push(c);
      return c;
    },
    setAttribute() {},
    addEventListener() {},
    set textContent(v: string) {
      this._texte = String(v);
      this.enfants.length = 0; // comme le vrai DOM : affecter textContent vide les enfants
    },
    get textContent() {
      return this._texte;
    },
  };
}

const texteDe = (n: Obj): string => [n._texte, ...n.enfants.map(texteDe)].filter(Boolean).join("\n");

/** Fait tourner la page du panneau, lui envoie `etat`, rend tout le texte qu'elle affiche. */
function afficher(p: Panneau, etat: Etat): string {
  const html: string = (p as unknown as { html(w: Obj): string }).html({ cspSource: "vscode-resource:" });
  const script = /<script nonce="[^"]+">([\s\S]*)<\/script>/.exec(html)?.[1];
  assert.ok(script, "la page a son script");
  const racine = noeud("div");
  let ecoute: ((ev: Obj) => void) | undefined;
  const bac = {
    document: {
      getElementById: () => racine,
      createElement: (tag: string) => noeud(tag),
      createTextNode: (t: string) => ({ enfants: [], _texte: t }),
    },
    window: { addEventListener: (type: string, f: (ev: Obj) => void) => (type === "message" ? (ecoute = f) : undefined) },
    acquireVsCodeApi: () => ({ postMessage() {} }),
  };
  vm.runInNewContext(script, bac);
  assert.ok(ecoute, "la page écoute les messages de l'extension");
  ecoute({ data: { type: "etat", etat } });
  return texteDe(racine);
}

test("formule d'abonnement : « max » s'affiche « Max », « pro » « Pro » (état et page)", async () => {
  definirLangue("en");
  const { projet } = maison();
  const p = panneau(projet);
  const etat = await etatDe(p);
  assert.equal(etat.comptes[0].plan, "Max");
  assert.equal(etat.comptes[1].plan, "Pro");
  const page = afficher(p, etat);
  assert.match(page, /^Max$/m);
  assert.match(page, /^Pro$/m);
  assert.doesNotMatch(page, /^(max|pro)$/m);
});

test("sans la commande /relais : pas de section « Handoff notes », même s'il y a des notes dans le dossier", async () => {
  definirLangue("en");
  const { projet, home } = maison();
  assert.ok(fs.readdirSync(dossierRelais(projet, home)).length > 0, "une note existe");
  const p = panneau(projet);
  const etat = await etatDe(p);
  assert.equal(etat.relaisDispo, false);
  assert.deepEqual(etat.relais, []);
  const page = afficher(p, etat);
  assert.doesNotMatch(page, /Handoff notes/);
  assert.doesNotMatch(page, /Refonte du panneau/);
  assert.doesNotMatch(page, /handoff|\/relais/i);
  // le reste du panneau est là
  assert.match(page, /Open conversations/);
  assert.match(page, /Recent conversations in this project/);
  assert.match(page, /Check setup/);
});

test("avec ~/.claude/commands/relais.md : la section et les notes sont là, comme avant", async () => {
  definirLangue("en");
  const { projet, home } = maison();
  fs.mkdirSync(path.join(home, ".claude", "commands"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "commands", "relais.md"), "# relais\n");
  const p = panneau(projet);
  const etat = await etatDe(p);
  assert.equal(etat.relaisDispo, true);
  assert.deepEqual(etat.relais.map((n) => n.titre), ["Refonte du panneau"]);
  const page = afficher(p, etat);
  assert.match(page, /Handoff notes/);
  assert.match(page, /Refonte du panneau/);
});

test("avec ~/.claude/skills/relais/ : la section est là aussi ; sans note, le texte d'état vide reste", async () => {
  definirLangue("en");
  const { projet, home } = maison();
  fs.mkdirSync(path.join(home, ".claude", "skills", "relais"), { recursive: true });
  fs.rmSync(dossierRelais(projet, home), { recursive: true });
  const p = panneau(projet);
  const etat = await etatDe(p);
  assert.equal(etat.relaisDispo, true);
  assert.deepEqual(etat.relais, []);
  const page = afficher(p, etat);
  assert.match(page, /Handoff notes/);
  assert.match(page, /No handoff notes for this project/);
});

test("sans dossier ouvert et sans la commande : le panneau s'affiche, sans section de relais", async () => {
  definirLangue("en");
  maison();
  const p = panneau(undefined);
  const etat = await etatDe(p);
  assert.equal(etat.aDossier, false);
  assert.equal(etat.relaisDispo, false);
  const page = afficher(p, etat);
  assert.match(page, /No folder is open in this window/);
  assert.doesNotMatch(page, /Handoff notes/);
});

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { cleProjetClaude } from "../chemins";
import {
  cheminNote, commandesRelaisPresentes, dateNote, dossierRelais, estNomNote, jetonsContexte, jetonsTexte, listerNotes,
  marquerAlerteContexte, nettoyerAlertesContexte, titreNote,
} from "../relais";
import { definirLangue } from "../textes";

afterEach(() => {
  definirLangue("en");
});

const maison = () => fs.mkdtempSync(path.join(os.tmpdir(), "relais-test-"));

test("slug des notes = cleProjetClaude", () => {
  const p = "/Users/jane/Desktop/dossier sans titre/projet";
  const h = "/h";
  assert.equal(dossierRelais(p, h), path.join(h, ".claude", "relais", cleProjetClaude(p)));
  assert.equal(cleProjetClaude(p), "-Users-jane-Desktop-dossier-sans-titre-projet");
});

test("nom de note : seul AAAA-MM-JJ-HHMM.md passe", () => {
  assert.ok(estNomNote("2026-10-07-1405.md"));
  for (const x of ["../2026-10-07-1405.md", "2026-10-07-1405.md/x", "a.md", "2026-10-07-14055.md", 3, undefined]) {
    assert.ok(!estNomNote(x));
  }
  assert.equal(cheminNote("/p", "../x.md", "/h"), undefined);
});

test("date d'une note (en : « Nov 8, 15:30 », fr : « 8 nov. 15 h 30 »)", () => {
  assert.equal(dateNote("2026-11-08-1530.md"), "Nov 8, 15:30");
  assert.equal(dateNote("2026-10-07-1405.md"), "Oct 7, 14:05");
  assert.equal(dateNote("2026-12-31-0000.md"), "Dec 31, 00:00");
  assert.equal(dateNote("2026-13-01-0000.md"), undefined);
  assert.equal(dateNote("n.md"), undefined);
  definirLangue("fr");
  assert.equal(dateNote("2026-11-08-1530.md"), "8 nov. 15 h 30");
  assert.equal(dateNote("2026-10-07-1405.md"), "7 oct. 14 h 05");
  assert.equal(dateNote("2026-12-31-0000.md"), "31 déc. 0 h 00");
  assert.equal(dateNote("2026-13-01-0000.md"), undefined);
});

test("titre d'une note", () => {
  assert.equal(titreNote("# Relais — Refonte du panneau — 2026-10-07 14:05", "n.md"), "Refonte du panneau");
  assert.equal(titreNote("# Relais — A — B — 2026-10-07", "n.md"), "A — B");
  assert.equal(titreNote("# Relais — Sans date", "n.md"), "Sans date");
  assert.equal(titreNote("# Autre chose", "n.md"), "n.md");
  assert.equal(titreNote(undefined, "n.md"), "n.md");
  assert.equal(titreNote("# Relais — ", "n.md"), "n.md");
});

test("listerNotes : 3 plus récentes, ignore les intrus", () => {
  const h = maison();
  const p = "/tmp/mon projet";
  const d = dossierRelais(p, h);
  fs.mkdirSync(d, { recursive: true });
  const noms = ["2026-10-05-0900.md", "2026-10-07-1405.md", "2026-10-06-1000.md", "2026-10-04-1000.md"];
  for (const n of noms) fs.writeFileSync(path.join(d, n), `# Relais — T${n.slice(8, 10)} — 2026\ncorps\n`);
  fs.writeFileSync(path.join(d, "notes.md"), "x");
  const l = listerNotes(p, 3, h);
  assert.deepEqual(l.map((x) => x.nom), ["2026-10-07-1405.md", "2026-10-06-1000.md", "2026-10-05-0900.md"]);
  assert.equal(l[0].titre, "T07");
  assert.equal(l[0].date, "Oct 7, 14:05");
  assert.deepEqual(listerNotes("/inconnu", 3, h), []);
});

const ligne = (o: unknown) => JSON.stringify(o);
test("jetonsContexte : dernière réponse avec usage, première ligne tronquée ignorée", () => {
  const fin = [
    '{"type":"assistant","message":{"usage":{"input_tokens":999999,"cache_read_input_tokens":1}}', // tronquée (fin de ligne coupée)
    ligne({ type: "assistant", message: { usage: { input_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } } }),
    ligne({ type: "user", message: { content: "salut" } }),
    ligne({ type: "assistant", message: { usage: { input_tokens: 3, cache_read_input_tokens: 150000, cache_creation_input_tokens: 15000 } } }),
    ligne({ type: "assistant", message: { content: "sans usage" } }),
    ligne({ type: "ai-title", aiTitle: "x" }),
    "",
  ].join("\n");
  assert.equal(jetonsContexte(fin), 165003);
  assert.equal(jetonsContexte(ligne({ type: "assistant", message: { usage: { input_tokens: 7 } } })), 7);
  assert.equal(jetonsContexte(ligne({ type: "user", message: { usage: { input_tokens: 7 } } })), undefined);
  assert.equal(jetonsContexte("rien\n{coupé"), undefined);
  assert.equal(jetonsContexte(""), undefined);
});

test("marqueur d'alerte : une seule fois ; nettoyage > 7 jours", () => {
  const h = maison();
  const id = "11111111-2222-3333-4444-555555555555";
  assert.equal(marquerAlerteContexte(id, h), true);
  assert.equal(marquerAlerteContexte(id, h), false);
  assert.equal(marquerAlerteContexte("../x", h), false);
  assert.equal(nettoyerAlertesContexte(h), 0);
  const f = path.join(h, ".claude", "comptes", "alertes-contexte", id);
  const vieux = new Date(Date.now() - 8 * 24 * 3600 * 1000);
  fs.utimesSync(f, vieux, vieux);
  assert.equal(nettoyerAlertesContexte(h), 1);
});

test("jetonsTexte arrondit au millier (en : 165,000 ; fr : 165 000 avec espace fine insécable)", () => {
  assert.equal(jetonsTexte(165003), "165,000");
  assert.equal(jetonsTexte(999), "1,000");
  assert.equal(jetonsTexte(4200), "4,000");
  definirLangue("fr");
  assert.equal(jetonsTexte(165003), "165\u202f000");
  assert.equal(jetonsTexte(1_234_567), "1\u202f235\u202f000");
});

test("racineProjet : sous-dossier et worktree → racine du dépôt principal (comme bin/dossier-relais)", () => {
  const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
  const fsx = require("node:fs") as typeof import("node:fs");
  const osx = require("node:os") as typeof import("node:os");
  const px = require("node:path") as typeof import("node:path");
  const { racineProjet } = require("../relais") as typeof import("../relais");
  const t = fsx.realpathSync(fsx.mkdtempSync(px.join(osx.tmpdir(), "relais-git-")));
  const depot = px.join(t, "dépôt principal");
  fsx.mkdirSync(px.join(depot, "sous", "dossier"), { recursive: true });
  const git = (...a: string[]) => execFileSync("git", a, { cwd: depot, stdio: "ignore" });
  git("init", "-q");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "x");
  git("worktree", "add", "-q", px.join(t, "copie"));
  assert.equal(racineProjet(depot), depot);
  assert.equal(racineProjet(px.join(depot, "sous", "dossier")), depot);
  assert.equal(racineProjet(px.join(t, "copie")), depot);
  assert.equal(racineProjet(t), t); // hors dépôt : le dossier lui-même
  fsx.rmSync(t, { recursive: true, force: true });
});

// --- Les commandes personnelles /relais existent-elles ? ---------------------------------------------------

test("commandesRelaisPresentes : absentes d'un dossier personnel vide ou sans commandes", () => {
  const h = maison();
  assert.equal(commandesRelaisPresentes(h), false, "aucun dossier ~/.claude");
  fs.mkdirSync(path.join(h, ".claude", "commands"), { recursive: true });
  fs.mkdirSync(path.join(h, ".claude", "skills"), { recursive: true });
  assert.equal(commandesRelaisPresentes(h), false, "dossiers vides");
  // d'autres commandes, un nom voisin, un dossier à la place du fichier, un fichier à la place du dossier
  fs.writeFileSync(path.join(h, ".claude", "commands", "reprendre.md"), "x");
  fs.writeFileSync(path.join(h, ".claude", "commands", "relais.md.bak"), "x");
  fs.mkdirSync(path.join(h, ".claude", "commands", "relais.md"));
  fs.mkdirSync(path.join(h, ".claude", "skills", "relais-autre"));
  assert.equal(commandesRelaisPresentes(h), false);
  fs.writeFileSync(path.join(h, ".claude", "skills", "relais"), "un fichier, pas un dossier");
  assert.equal(commandesRelaisPresentes(h), false);
  // la copie de relais.md d'un projet n'est pas la commande personnelle
  fs.mkdirSync(path.join(h, "projet", ".claude", "commands"), { recursive: true });
  fs.writeFileSync(path.join(h, "projet", ".claude", "commands", "relais.md"), "x");
  assert.equal(commandesRelaisPresentes(h), false);
});

test("commandesRelaisPresentes : ~/.claude/commands/relais.md, ou ~/.claude/skills/relais/", () => {
  const parCommande = maison();
  fs.mkdirSync(path.join(parCommande, ".claude", "commands"), { recursive: true });
  fs.writeFileSync(path.join(parCommande, ".claude", "commands", "relais.md"), "# relais\n");
  assert.equal(commandesRelaisPresentes(parCommande), true);

  const parSkill = maison();
  fs.mkdirSync(path.join(parSkill, ".claude", "skills", "relais"), { recursive: true });
  assert.equal(commandesRelaisPresentes(parSkill), true);

  // un lien (gestionnaire de dotfiles, ou dossier commun des comptes) est suivi ; un lien cassé ne compte pas
  const parLien = maison();
  const dotfiles = path.join(parLien, "dotfiles");
  fs.mkdirSync(path.join(dotfiles, "skills-relais"), { recursive: true });
  fs.writeFileSync(path.join(dotfiles, "relais.md"), "x");
  fs.mkdirSync(path.join(parLien, ".claude", "commands"), { recursive: true });
  fs.mkdirSync(path.join(parLien, ".claude", "skills"), { recursive: true });
  fs.symlinkSync(path.join(dotfiles, "relais.md"), path.join(parLien, ".claude", "commands", "relais.md"));
  assert.equal(commandesRelaisPresentes(parLien), true);
  fs.rmSync(path.join(parLien, ".claude", "commands", "relais.md"));
  fs.symlinkSync(path.join(dotfiles, "absent.md"), path.join(parLien, ".claude", "commands", "relais.md"));
  assert.equal(commandesRelaisPresentes(parLien), false, "lien cassé");
  fs.symlinkSync(path.join(dotfiles, "skills-relais"), path.join(parLien, ".claude", "skills", "relais"));
  assert.equal(commandesRelaisPresentes(parLien), true);
});

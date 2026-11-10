import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ajouterAlias, aliasPresents, detecterShell, fichierShell, LIGNES_ALIAS, planAlias } from "../installation";

// Ancien nom du produit, écrit dans le bloc par la version 0.2 (reconnu pour ne pas le doubler).
const ANCIEN_NOM = ["Comptes", "Claude"].join(" ");

const maison = () => fs.mkdtempSync(path.join(os.tmpdir(), "alias-test-"));

test("detecterShell : zsh, bash, et rien d'autre (d'après $SHELL)", () => {
  assert.equal(detecterShell("/bin/zsh"), "zsh");
  assert.equal(detecterShell("/usr/local/bin/zsh"), "zsh");
  assert.equal(detecterShell("/bin/bash"), "bash");
  assert.equal(detecterShell("/opt/homebrew/bin/bash"), "bash");
  for (const autre of ["/opt/homebrew/bin/fish", "/bin/sh", "/bin/tcsh", "/usr/bin/nu", "", undefined, "/bin/zsh-fake", "zshell"]) {
    assert.equal(detecterShell(autre), undefined, String(autre));
  }
});

test("fichierShell : ~/.zshrc pour zsh, ~/.bashrc pour bash", () => {
  assert.equal(fichierShell("zsh", "/h"), path.join("/h", ".zshrc"));
  assert.equal(fichierShell("bash", "/h"), path.join("/h", ".bashrc"));
});

test("les deux lignes d'alias pointent sur les dossiers des comptes A et B", () => {
  assert.equal(LIGNES_ALIAS.length, 2);
  assert.match(LIGNES_ALIAS[0], /^alias claude-a='CLAUDE_CONFIG_DIR="\$HOME\/\.claude\/comptes\/A" claude'$/);
  assert.match(LIGNES_ALIAS[1], /^alias claude-b='CLAUDE_CONFIG_DIR="\$HOME\/\.claude\/comptes\/B" claude'$/);
});

test("ajouterAlias : fichier zsh existant → bloc ajouté, contenu d'origine intact", () => {
  const h = maison();
  const f = fichierShell("zsh", h);
  fs.writeFileSync(f, "export PATH=$PATH:/x\n");
  assert.equal(aliasPresents(f), false);
  assert.equal(ajouterAlias(f), true);
  const texte = fs.readFileSync(f, "utf8");
  assert.ok(texte.startsWith("export PATH=$PATH:/x\n"));
  for (const l of LIGNES_ALIAS) assert.ok(texte.includes(l));
  assert.equal(aliasPresents(f), true);
  // les deux alias se définissent vraiment dans un shell qui lit ces lignes
  const sortie = execFileSync("/bin/sh", ["-c", `HOME=/h; ${LIGNES_ALIAS.join("; ")}; alias claude-a; alias claude-b`], { encoding: "utf8" });
  assert.match(sortie, /comptes\/A/);
  assert.match(sortie, /comptes\/B/);
});

test("ajouterAlias : fichier bash absent → créé avec le seul bloc", () => {
  const h = maison();
  const f = fichierShell("bash", h);
  assert.equal(fs.existsSync(f), false);
  assert.equal(ajouterAlias(f), true);
  const texte = fs.readFileSync(f, "utf8");
  for (const l of LIGNES_ALIAS) assert.ok(texte.includes(l));
  assert.deepEqual(fs.readdirSync(h), [".bashrc"]);
});

test("ajouterAlias : idempotent (les appels suivants ne changent pas un octet)", () => {
  const h = maison();
  const f = fichierShell("zsh", h);
  fs.writeFileSync(f, "# mon zshrc");
  assert.equal(ajouterAlias(f), true);
  const apres1 = fs.readFileSync(f);
  assert.equal(ajouterAlias(f), false);
  assert.equal(ajouterAlias(f), false);
  assert.ok(fs.readFileSync(f).equals(apres1));
  assert.equal([...apres1.toString().matchAll(/alias claude-a=/g)].length, 1);
});

test("ajouterAlias : le bloc écrit par l'ancienne version (avant Twinseat) compte comme déjà présent", () => {
  const h = maison();
  const f = fichierShell("zsh", h);
  const ancien = [`# >>> ${ANCIEN_NOM} (claude-a / claude-b) >>>`, ...LIGNES_ALIAS, `# <<< ${ANCIEN_NOM} <<<`, ""].join("\n");
  fs.writeFileSync(f, ancien);
  assert.equal(aliasPresents(f), true);
  assert.equal(ajouterAlias(f), false);
  assert.equal(fs.readFileSync(f, "utf8"), ancien);
});

test("planAlias : zsh et bash → écrire dans le bon fichier ; déjà fait → signalé", () => {
  const h = maison();
  assert.deepEqual(planAlias("/bin/zsh", h), { action: "ecrire", shell: "zsh", fichier: path.join(h, ".zshrc"), dejaFait: false });
  assert.deepEqual(planAlias("/bin/bash", h), { action: "ecrire", shell: "bash", fichier: path.join(h, ".bashrc"), dejaFait: false });
  ajouterAlias(path.join(h, ".bashrc"));
  assert.deepEqual(planAlias("/bin/bash", h), { action: "ecrire", shell: "bash", fichier: path.join(h, ".bashrc"), dejaFait: true });
  assert.deepEqual(planAlias("/bin/zsh", h), { action: "ecrire", shell: "zsh", fichier: path.join(h, ".zshrc"), dejaFait: false });
});

test("planAlias : shell inconnu ou absent → copier les lignes, rien n'est écrit", () => {
  const h = maison();
  for (const s of ["/opt/homebrew/bin/fish", "/bin/sh", "", undefined]) {
    const p = planAlias(s, h);
    assert.equal(p.action, "copier", String(s));
    assert.deepEqual(p.action === "copier" ? p.lignes : [], LIGNES_ALIAS);
  }
  assert.deepEqual(fs.readdirSync(h), []); // planAlias lui-même n'écrit jamais
});

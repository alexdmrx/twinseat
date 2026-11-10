import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ajouterAlias, aliasPresents, detecterShell, fichierConseille, fichierShell, LIGNES_ALIAS, planAlias } from "../installation";

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

test("fichierShell : zsh → ~/.zshrc, sur macOS comme sur Linux, quels que soient les fichiers bash", () => {
  for (const plateforme of ["darwin", "linux"]) {
    const h = maison();
    assert.equal(fichierShell("zsh", h, plateforme), path.join(h, ".zshrc"), plateforme);
    fs.writeFileSync(path.join(h, ".bash_profile"), "");
    fs.writeFileSync(path.join(h, ".bashrc"), "");
    assert.equal(fichierShell("zsh", h, plateforme), path.join(h, ".zshrc"), plateforme);
  }
});

test("fichierShell : bash sous Linux → ~/.bashrc, même si ~/.bash_profile existe", () => {
  const h = maison();
  assert.equal(fichierShell("bash", h, "linux"), path.join(h, ".bashrc")); // aucun fichier
  fs.writeFileSync(path.join(h, ".bash_profile"), "");
  assert.equal(fichierShell("bash", h, "linux"), path.join(h, ".bashrc")); // .bash_profile seul
  fs.writeFileSync(path.join(h, ".bashrc"), "");
  assert.equal(fichierShell("bash", h, "linux"), path.join(h, ".bashrc")); // les deux
});

test("fichierShell : bash sous macOS → ~/.bash_profile SEULEMENT s'il existe déjà ; sinon rien (jamais ~/.bashrc, jamais de création)", () => {
  const sans = maison();
  assert.equal(fichierShell("bash", sans, "darwin"), undefined); // aucun fichier : le créer pourrait masquer ~/.profile

  const rcSeul = maison();
  fs.writeFileSync(path.join(rcSeul, ".bashrc"), "");
  assert.equal(fichierShell("bash", rcSeul, "darwin"), undefined); // .bashrc seul : un shell de connexion ne le lit pas

  const profilSeul = maison();
  fs.writeFileSync(path.join(profilSeul, ".bash_profile"), "");
  assert.equal(fichierShell("bash", profilSeul, "darwin"), path.join(profilSeul, ".bash_profile")); // .bash_profile seul

  const deux = maison();
  fs.writeFileSync(path.join(deux, ".bash_profile"), "");
  fs.writeFileSync(path.join(deux, ".bashrc"), "");
  assert.equal(fichierShell("bash", deux, "darwin"), path.join(deux, ".bash_profile")); // les deux

  const profile = maison();
  fs.writeFileSync(path.join(profile, ".profile"), "");
  assert.equal(fichierShell("bash", profile, "darwin"), undefined); // ~/.profile seul : on ne crée pas ~/.bash_profile à côté
});

test("fichierShell : sans plateforme donnée, celle du processus", () => {
  const h = maison();
  assert.equal(fichierShell("bash", h), process.platform === "darwin" ? undefined : path.join(h, ".bashrc"));
});

test("fichierConseille : le fichier que bash lit sous macOS (le premier qui existe parmi .bash_profile, .bash_login, .profile), sinon ~/.bash_profile", () => {
  const sans = maison();
  assert.equal(fichierConseille(sans), "~/.bash_profile");
  fs.writeFileSync(path.join(sans, ".bashrc"), "");
  assert.equal(fichierConseille(sans), "~/.bash_profile", ".bashrc n'est pas lu par un shell de connexion");

  const profile = maison();
  fs.writeFileSync(path.join(profile, ".profile"), "");
  assert.equal(fichierConseille(profile), "~/.profile");

  const login = maison();
  fs.writeFileSync(path.join(login, ".profile"), "");
  fs.writeFileSync(path.join(login, ".bash_login"), "");
  assert.equal(fichierConseille(login), "~/.bash_login");

  const profil = maison();
  fs.writeFileSync(path.join(profil, ".profile"), "");
  fs.writeFileSync(path.join(profil, ".bash_profile"), "");
  assert.equal(fichierConseille(profil), "~/.bash_profile");
  assert.deepEqual(fs.readdirSync(sans).sort(), [".bashrc"], "rien n'est créé");
});

test("fichierShell : ne crée ni ne modifie rien", () => {
  const h = maison();
  fichierShell("bash", h, "darwin");
  fichierShell("bash", h, "linux");
  fichierShell("zsh", h, "darwin");
  fichierConseille(h);
  assert.deepEqual(fs.readdirSync(h), []);
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

test("ajouterAlias : fichier bash absent sous Linux → ~/.bashrc créé avec le seul bloc", () => {
  const h = maison();
  const f = fichierShell("bash", h, "linux") as string;
  assert.equal(f, path.join(h, ".bashrc"));
  assert.equal(fs.existsSync(f), false);
  assert.equal(ajouterAlias(f), true);
  const texte = fs.readFileSync(f, "utf8");
  for (const l of LIGNES_ALIAS) assert.ok(texte.includes(l));
  assert.deepEqual(fs.readdirSync(h), [".bashrc"]);
});

test("ajouterAlias : bash sous macOS avec ~/.bash_profile → le bloc y est ajouté, ~/.bashrc intact", () => {
  const h = maison();
  fs.writeFileSync(path.join(h, ".bash_profile"), "export A=1\n");
  fs.writeFileSync(path.join(h, ".bashrc"), "export B=2\n");
  assert.equal(ajouterAlias(fichierShell("bash", h, "darwin") as string), true);
  assert.ok(fs.readFileSync(path.join(h, ".bash_profile"), "utf8").includes(LIGNES_ALIAS[0]));
  assert.equal(fs.readFileSync(path.join(h, ".bashrc"), "utf8"), "export B=2\n");
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

test("planAlias : zsh et bash → écrire dans le bon fichier ; déjà fait → signalé (Linux)", () => {
  const h = maison();
  assert.deepEqual(planAlias("/bin/zsh", h, "linux"), { action: "ecrire", shell: "zsh", fichier: path.join(h, ".zshrc"), dejaFait: false });
  assert.deepEqual(planAlias("/bin/bash", h, "linux"), { action: "ecrire", shell: "bash", fichier: path.join(h, ".bashrc"), dejaFait: false });
  ajouterAlias(path.join(h, ".bashrc"));
  assert.deepEqual(planAlias("/bin/bash", h, "linux"), { action: "ecrire", shell: "bash", fichier: path.join(h, ".bashrc"), dejaFait: true });
  assert.deepEqual(planAlias("/bin/zsh", h, "linux"), { action: "ecrire", shell: "zsh", fichier: path.join(h, ".zshrc"), dejaFait: false });
});

test("planAlias : sous macOS, bash n'écrit que dans un ~/.bash_profile qui existe ; sinon on copie les lignes en disant dans quel fichier les mettre ; zsh reste ~/.zshrc", () => {
  const h = maison();
  assert.deepEqual(planAlias("/bin/zsh", h, "darwin"), { action: "ecrire", shell: "zsh", fichier: path.join(h, ".zshrc"), dejaFait: false });

  // aucun fichier bash : rien n'est créé, on dit où coller
  assert.deepEqual(planAlias("/bin/bash", h, "darwin"), { action: "copier", lignes: LIGNES_ALIAS, fichierConseille: "~/.bash_profile" });
  // ~/.bashrc seul : jamais écrit (un shell de connexion ne le lit pas), toujours rien de créé
  fs.writeFileSync(path.join(h, ".bashrc"), "");
  assert.deepEqual(planAlias("/bin/bash", h, "darwin"), { action: "copier", lignes: LIGNES_ALIAS, fichierConseille: "~/.bash_profile" });
  // ~/.profile existe : c'est lui que bash lit, c'est lui qu'on nomme ; ~/.bash_profile n'est pas créé à côté
  fs.writeFileSync(path.join(h, ".profile"), "");
  assert.deepEqual(planAlias("/bin/bash", h, "darwin"), { action: "copier", lignes: LIGNES_ALIAS, fichierConseille: "~/.profile" });
  assert.deepEqual(fs.readdirSync(h).sort(), [".bashrc", ".profile"]);
  assert.equal(fs.readFileSync(path.join(h, ".bashrc"), "utf8"), "");
  // ~/.bash_profile existe : on y écrit
  fs.writeFileSync(path.join(h, ".bash_profile"), "");
  assert.deepEqual(planAlias("/bin/bash", h, "darwin"), { action: "ecrire", shell: "bash", fichier: path.join(h, ".bash_profile"), dejaFait: false });
  ajouterAlias(path.join(h, ".bash_profile"));
  assert.equal((planAlias("/bin/bash", h, "darwin") as { dejaFait: boolean }).dejaFait, true);
});

test("planAlias : shell inconnu ou absent → copier les lignes, rien n'est écrit", () => {
  const h = maison();
  for (const plateforme of ["darwin", "linux"]) {
    for (const s of ["/opt/homebrew/bin/fish", "/bin/sh", "", undefined]) {
      const p = planAlias(s, h, plateforme);
      assert.equal(p.action, "copier", `${plateforme} ${String(s)}`);
      assert.deepEqual(p.action === "copier" ? p.lignes : [], LIGNES_ALIAS);
      assert.equal(p.action === "copier" ? p.fichierConseille : "x", undefined, "pas de fichier conseillé : le shell est inconnu");
    }
  }
  assert.deepEqual(fs.readdirSync(h), []); // planAlias lui-même n'écrit jamais
});

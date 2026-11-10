import { test } from "node:test";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { base, cheminLanceur, COMPTES, dossierCompte, sousDossier } from "../chemins";
import {
  anonymiser, construireRapport, EntreesDiagnostic, etatReglage, nomVerification, reparables, reparer, resumeTexte, trouverBinaireClaude, verifier, Verification,
} from "../diagnostic";
import { DOSSIERS_PARTAGES, FICHIERS_PARTAGES, installer } from "../installation";
import { en, fr } from "../textes";

const LANCEUR = path.resolve(__dirname, "../../resources/lanceur.sh");
const EMAIL = "jane.doe@example.com";
const UUID = "123e4567-e89b-12d3-a456-426614174000";
const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

/** Une maison jetable avec Twinseat installé, le compte A connecté et le programme claude en place. */
function installee(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "diag-test-"));
  fs.writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: EMAIL }, mcpServers: {} }));
  installer(LANCEUR, home);
  const fiche = path.join(dossierCompte("A", home), ".claude.json");
  fs.writeFileSync(fiche, JSON.stringify({ oauthAccount: { emailAddress: EMAIL, organizationName: "work" } }), { mode: 0o600 });
  fs.chmodSync(fiche, 0o600);
  fs.mkdirSync(path.join(home, ".local", "bin"), { recursive: true });
  fs.writeFileSync(path.join(home, ".local", "bin", "claude"), "#!/bin/sh\n", { mode: 0o755 });
  return home;
}

function entrees(home: string, extra: Partial<EntreesDiagnostic> = {}): EntreesDiagnostic {
  return {
    home,
    plateforme: "darwin",
    arch: "arm64",
    versionSysteme: "25.6.0",
    lanceurInclus: LANCEUR,
    dossierExtensionClaude: undefined,
    reglageLanceur: cheminLanceur(home),
    versions: { twinseat: "0.3.0", vscode: "1.94.2", claudeCode: "2.1.319" },
    langue: "en",
    ...extra,
  };
}

const par = (v: Verification[], id: string): Verification => {
  const x = v.find((y) => y.id === id);
  assert.ok(x, `vérification absente : ${id} (${v.map((y) => y.id).join(", ")})`);
  return x;
};

/** Tout ce que contient un dossier : chemin → contenu (fichier), « lien → cible » ou « dossier ». */
function photo(racine: string): Map<string, string> {
  const m = new Map<string, string>();
  const parcourir = (d: string): void => {
    for (const nom of fs.readdirSync(d)) {
      const p = path.join(d, nom);
      const st = fs.lstatSync(p);
      if (st.isSymbolicLink()) m.set(p, `-> ${fs.readlinkSync(p)}`);
      else if (st.isDirectory()) {
        m.set(p, "dossier");
        parcourir(p);
      } else m.set(p, fs.readFileSync(p, "utf8"));
    }
  };
  parcourir(racine);
  return m;
}

const IDS_ATTENDUS = [
  "plateforme", "claude", "lanceur", "reglage",
  ...COMPTES.flatMap((c) => ["dossier", "fiche", "connecte", "liens"].map((x) => `compte.${c}.${x}`)),
  "registre",
];

// --- Installation saine -------------------------------------------------------------------------

test("installation saine : tout est ok, sauf le compte B qui n'est pas connecté (à faire par l'utilisateur)", () => {
  const home = installee();
  const v = verifier(entrees(home));
  assert.deepEqual(v.map((x) => x.id), IDS_ATTENDUS);
  for (const x of v) {
    assert.deepEqual(Object.keys(x).sort(), ["detail", "id", "nom", "reparable", "statut"], x.id);
    assert.ok(["ok", "warn", "fail"].includes(x.statut), x.id);
    assert.equal(typeof x.reparable, "boolean");
    assert.ok(x.detail.length > 0 && x.nom.length > 0, x.id);
    assert.ok(!(x.reparable && x.statut === "ok"), `réparable mais ok : ${x.id}`);
    assert.doesNotMatch(x.detail, /\{\w+\}/, `variable non remplacée : ${x.id}`);
  }
  for (const x of v) if (x.id !== "compte.B.connecte") assert.equal(x.statut, "ok", `${x.id} : ${x.detail}`);
  assert.equal(par(v, "compte.B.connecte").statut, "warn");
  assert.equal(par(v, "compte.B.connecte").reparable, false);
  assert.equal(par(v, "compte.A.connecte").statut, "ok");
  assert.deepEqual(reparables(v), []);
});

test("verifier ne modifie rien", () => {
  const home = installee();
  fs.chmodSync(path.join(dossierCompte("B", home), ".claude.json"), 0o644);
  fs.rmSync(path.join(dossierCompte("A", home), "skills"));
  const avant = photo(home);
  verifier(entrees(home));
  assert.deepEqual(photo(home), avant);
});

// --- Plateforme ---------------------------------------------------------------------------------

test("plateforme non prise en charge : un seul constat, non réparable, aucun accès aux fichiers", () => {
  const absent = path.join(os.tmpdir(), "diag-test-n-existe-pas");
  for (const p of ["win32", "freebsd"]) {
    const v = verifier(entrees(absent, { plateforme: p }));
    assert.deepEqual(v.map((x) => x.id), ["plateforme"]);
    assert.equal(v[0].statut, "fail");
    assert.equal(v[0].reparable, false);
    assert.match(v[0].detail, /macOS and Linux/);
  }
  assert.equal(par(verifier(entrees(installee(), { plateforme: "linux" })), "plateforme").statut, "ok");
});

// --- Programme claude ---------------------------------------------------------------------------

test("claude : trouvé dans l'extension, ou dans ~/.local/bin ; sinon un avertissement (sans chemin dans le texte)", () => {
  const home = installee();
  const ext = fs.mkdtempSync(path.join(os.tmpdir(), "diag-ext-"));
  fs.mkdirSync(path.join(ext, "resources", "native-binary"), { recursive: true });
  fs.writeFileSync(path.join(ext, "resources", "native-binary", "claude"), "");

  assert.equal(trouverBinaireClaude(ext, home), path.join(ext, "resources", "native-binary", "claude"));
  assert.equal(trouverBinaireClaude(undefined, home), path.join(home, ".local", "bin", "claude"));
  assert.equal(trouverBinaireClaude(path.join(ext, "absent"), home), path.join(home, ".local", "bin", "claude"));
  fs.rmSync(path.join(home, ".local", "bin", "claude"));
  assert.equal(trouverBinaireClaude(undefined, home), undefined);
  assert.equal(trouverBinaireClaude(path.join(ext, "absent"), home), undefined);

  const trouve = par(verifier(entrees(home, { dossierExtensionClaude: ext })), "claude");
  assert.equal(trouve.statut, "ok");
  assert.ok(!trouve.detail.includes(ext), "le chemin n'est pas dit");
  const absent = par(verifier(entrees(home)), "claude");
  assert.equal(absent.statut, "warn");
  assert.equal(absent.reparable, false);
});

// --- Lanceur installé ---------------------------------------------------------------------------

test("lanceur : absent, modifié, non exécutable → réparés par une copie atomique identique à l'original", () => {
  const home = installee();
  const dest = cheminLanceur(home);

  fs.rmSync(dest);
  let l = par(verifier(entrees(home)), "lanceur");
  assert.deepEqual([l.statut, l.reparable], ["fail", true]);
  let r = reparer(entrees(home));
  assert.deepEqual(r.erreurs, []);
  assert.ok(r.actions.includes("lanceur"));
  assert.equal(sha(dest), sha(LANCEUR));
  assert.equal(fs.statSync(dest).mode & 0o777, 0o755);

  fs.appendFileSync(dest, "# édité à la main\n");
  l = par(verifier(entrees(home)), "lanceur");
  assert.deepEqual([l.statut, l.reparable], ["warn", true]);
  r = reparer(entrees(home));
  assert.equal(sha(dest), sha(LANCEUR));

  fs.chmodSync(dest, 0o644);
  l = par(verifier(entrees(home)), "lanceur");
  assert.deepEqual([l.statut, l.reparable], ["fail", true]);
  r = reparer(entrees(home));
  assert.equal(fs.statSync(dest).mode & 0o777, 0o755);
  assert.equal(sha(dest), sha(LANCEUR));
  assert.deepEqual(fs.readdirSync(path.dirname(dest)), ["lanceur"], "aucun fichier temporaire");
  assert.equal(par(r.apres, "lanceur").statut, "ok");
});

test("lanceur : un dossier ou un lien à cet endroit est signalé et n'est jamais touché ; la source illisible n'est pas réparable", () => {
  const home = installee();
  const dest = cheminLanceur(home);
  const cible = path.join(home, "mon-lanceur");
  fs.writeFileSync(cible, "#!/bin/sh\necho à moi\n", { mode: 0o700 });
  fs.rmSync(dest);
  fs.symlinkSync(cible, dest);
  const l = par(verifier(entrees(home)), "lanceur");
  assert.deepEqual([l.statut, l.reparable], ["fail", false]);
  const avant = photo(home);
  const r = reparer(entrees(home));
  assert.ok(!r.actions.includes("lanceur"));
  assert.deepEqual(photo(home), avant);
  assert.equal(fs.statSync(cible).mode & 0o777, 0o700);

  const saine = installee();
  const s = par(verifier(entrees(saine, { lanceurInclus: path.join(saine, "absent.sh") })), "lanceur");
  assert.deepEqual([s.statut, s.reparable], ["fail", false]);
});

// --- Réglage du lanceur dans VS Code ------------------------------------------------------------

test("réglage : le nôtre, aucun, ou celui d'un autre programme (jamais « réparé »)", () => {
  const home = installee();
  assert.equal(etatReglage(cheminLanceur(home), home), "notre");
  assert.equal(etatReglage(undefined, home), "aucun");
  assert.equal(etatReglage("", home), "aucun");
  assert.equal(etatReglage("/opt/autre/wrapper.sh", home), "autre");
  assert.equal(etatReglage(cheminLanceur(home) + "x", home), "autre");

  assert.deepEqual([par(verifier(entrees(home)), "reglage").statut, par(verifier(entrees(home)), "reglage").reparable], ["ok", false]);
  for (const valeur of [undefined, "/opt/autre/wrapper.sh"]) {
    const e = entrees(home, { reglageLanceur: valeur });
    const x = par(verifier(e), "reglage");
    assert.deepEqual([x.statut, x.reparable], ["warn", false], String(valeur));
    const r = reparer(e);
    assert.ok(r.actions.every((a) => a === "lanceur" || a === "installation" || a.startsWith("droits")));
    assert.equal(par(r.apres, "reglage").statut, "warn");
  }
  // ce que dit le texte ne reprend pas le chemin de l'autre programme
  assert.ok(!par(verifier(entrees(home, { reglageLanceur: "/opt/autre/wrapper.sh" })), "reglage").detail.includes("autre/wrapper"));
});

// --- Dossiers des comptes et fiches .claude.json ------------------------------------------------

test("fiche .claude.json : droits 600 (réparable), absente (pas réparable), lien ou dossier (conflit intact)", () => {
  const home = installee();
  const fiche = path.join(dossierCompte("A", home), ".claude.json");

  fs.chmodSync(fiche, 0o644);
  let x = par(verifier(entrees(home)), "compte.A.fiche");
  assert.deepEqual([x.statut, x.reparable], ["warn", true]);
  assert.match(x.detail, /644/);
  const r = reparer(entrees(home));
  assert.deepEqual(r.erreurs, []);
  assert.ok(r.actions.includes("droits-A"));
  assert.equal(fs.statSync(fiche).mode & 0o777, 0o600);
  assert.equal(par(r.apres, "compte.A.fiche").statut, "ok");

  fs.rmSync(fiche);
  x = par(verifier(entrees(home)), "compte.A.fiche");
  assert.deepEqual([x.statut, x.reparable], ["warn", false]);

  // un lien vers le .claude.json de l'utilisateur : chmod le suivrait, donc on ne touche à rien
  const sien = path.join(home, ".claude.json");
  fs.chmodSync(sien, 0o644);
  fs.symlinkSync(sien, fiche);
  x = par(verifier(entrees(home)), "compte.A.fiche");
  assert.deepEqual([x.statut, x.reparable], ["fail", false]);
  reparer(entrees(home));
  assert.equal(fs.statSync(sien).mode & 0o777, 0o644, "la cible du lien n'a pas changé de droits");
  assert.ok(fs.lstatSync(fiche).isSymbolicLink());
});

test("connecté ou non : un booléen, jamais l'adresse", () => {
  const home = installee();
  const v = verifier(entrees(home));
  assert.equal(par(v, "compte.A.connecte").statut, "ok");
  assert.equal(par(v, "compte.B.connecte").statut, "warn");
  for (const x of v) assert.ok(!x.detail.includes(EMAIL) && !x.detail.includes("example.com"), x.id);
});

test("dossier d'un compte : absent → réparé par l'installateur ; un fichier à sa place → conflit intact", () => {
  const home = installee();
  const dossier = dossierCompte("B", home);
  fs.rmSync(dossier, { recursive: true });
  let x = par(verifier(entrees(home)), "compte.B.dossier");
  assert.deepEqual([x.statut, x.reparable], ["fail", true]);
  const r = reparer(entrees(home));
  assert.deepEqual(r.erreurs, []);
  assert.ok(r.actions.includes("installation"));
  assert.ok(fs.statSync(dossier).isDirectory());
  assert.equal(par(r.apres, "compte.B.dossier").statut, "ok");
  assert.equal(par(r.apres, "compte.B.liens").statut, "ok");

  const autre = installee();
  const d = dossierCompte("B", autre);
  fs.rmSync(d, { recursive: true });
  fs.writeFileSync(d, "un fichier, pas un dossier");
  x = par(verifier(entrees(autre)), "compte.B.dossier");
  assert.deepEqual([x.statut, x.reparable], ["fail", false]);
  reparer(entrees(autre));
  assert.equal(fs.readFileSync(d, "utf8"), "un fichier, pas un dossier");
});

// --- Liens partagés -----------------------------------------------------------------------------

test("liens partagés : un lien manquant est recréé ; un vrai dossier ou un lien ailleurs est un conflit qui n'est jamais touché", () => {
  const home = installee();
  const A = dossierCompte("A", home);
  const B = dossierCompte("B", home);
  const total = FICHIERS_PARTAGES.length + DOSSIERS_PARTAGES.length;
  assert.match(par(verifier(entrees(home)), "compte.A.liens").detail, new RegExp(`${total}`));

  // A : un lien manquant. B : un vrai dossier avec du contenu, et un lien qui pointe ailleurs.
  fs.rmSync(path.join(A, "agents"));
  fs.rmSync(path.join(B, "skills"));
  fs.mkdirSync(path.join(B, "skills"));
  fs.writeFileSync(path.join(B, "skills", "garde.txt"), "x");
  fs.rmSync(path.join(B, "hooks"));
  fs.symlinkSync("/tmp/ailleurs", path.join(B, "hooks"));

  const v = verifier(entrees(home));
  const a = par(v, "compte.A.liens");
  assert.deepEqual([a.statut, a.reparable], ["warn", true]);
  assert.match(a.detail, /agents/);
  const b = par(v, "compte.B.liens");
  assert.deepEqual([b.statut, b.reparable], ["warn", false]);
  assert.match(b.detail, /skills/);
  assert.match(b.detail, /hooks/);

  const r = reparer(entrees(home));
  assert.deepEqual(r.erreurs, []);
  assert.equal(fs.readlinkSync(path.join(A, "agents")), path.join(base(home), "agents"));
  assert.ok(fs.lstatSync(path.join(B, "skills")).isDirectory());
  assert.equal(fs.readFileSync(path.join(B, "skills", "garde.txt"), "utf8"), "x");
  assert.equal(fs.readlinkSync(path.join(B, "hooks")), "/tmp/ailleurs");
  assert.equal(par(r.apres, "compte.A.liens").statut, "ok");
  const b2 = par(r.apres, "compte.B.liens");
  assert.deepEqual([b2.statut, b2.reparable], ["warn", false]);
});

test("liens partagés : un dossier commun supprimé dans ~/.claude est recréé (vide) ; un fichier à sa place est un conflit", () => {
  const home = installee();
  fs.rmSync(path.join(base(home), "skills"), { recursive: true });
  let x = par(verifier(entrees(home)), "compte.A.liens");
  assert.deepEqual([x.statut, x.reparable], ["warn", true]);
  const r = reparer(entrees(home));
  assert.deepEqual(fs.readdirSync(path.join(base(home), "skills")), []);
  assert.equal(par(r.apres, "compte.A.liens").statut, "ok");

  // les fichiers partagés n'ont pas besoin d'exister (le lien suffit)
  assert.equal(fs.existsSync(path.join(base(home), "settings.json")), false);
  assert.equal(par(r.apres, "compte.B.liens").statut, "ok");

  fs.rmSync(path.join(base(home), "agents"), { recursive: true });
  fs.writeFileSync(path.join(base(home), "agents"), "un fichier");
  x = par(verifier(entrees(home)), "compte.A.liens");
  assert.equal(x.reparable, false);
  reparer(entrees(home));
  assert.equal(fs.readFileSync(path.join(base(home), "agents"), "utf8"), "un fichier");
});

// --- Dossier du registre ------------------------------------------------------------------------

test("registre : absent → recréé ; non modifiable → signalé, pas réparable", (t) => {
  const home = installee();
  const dossier = sousDossier.registre(home);
  fs.writeFileSync(path.join(dossier, UUID), "A\n");
  assert.deepEqual([par(verifier(entrees(home)), "registre").statut, par(verifier(entrees(home)), "registre").reparable], ["ok", false]);

  fs.rmSync(dossier, { recursive: true });
  let x = par(verifier(entrees(home)), "registre");
  assert.deepEqual([x.statut, x.reparable], ["fail", true]);
  const r = reparer(entrees(home));
  assert.ok(fs.statSync(dossier).isDirectory());
  assert.equal(par(r.apres, "registre").statut, "ok");

  if (process.getuid?.() === 0) {
    t.diagnostic("exécuté en root : l'essai du dossier non modifiable est sauté");
    return;
  }
  fs.chmodSync(dossier, 0o500);
  try {
    x = par(verifier(entrees(home)), "registre");
    assert.deepEqual([x.statut, x.reparable], ["fail", false]);
  } finally {
    fs.chmodSync(dossier, 0o700);
  }
});

// --- Réparation : jamais de suppression, jamais d'écrasement -------------------------------------

test("réparer sur une maison abîmée : tout ce qui existait existe encore, à l'identique ; seul ce qui manquait est ajouté", () => {
  const home = installee();
  const A = dossierCompte("A", home);
  const B = dossierCompte("B", home);
  // abîmé : lanceur périmé, droits, lien manquant, dossier commun absent, registre absent
  fs.appendFileSync(cheminLanceur(home), "# vieux\n");
  fs.chmodSync(path.join(A, ".claude.json"), 0o666);
  fs.rmSync(path.join(A, "plugins"));
  fs.rmSync(path.join(base(home), "todos"), { recursive: true });
  fs.rmSync(sousDossier.registre(home), { recursive: true });
  // en travers : du contenu réel là où un lien est attendu, un lien ailleurs, des fichiers de l'utilisateur
  fs.rmSync(path.join(B, "skills"));
  fs.mkdirSync(path.join(B, "skills"));
  fs.writeFileSync(path.join(B, "skills", "a-moi.md"), "précieux");
  fs.rmSync(path.join(B, "CLAUDE.md"));
  fs.writeFileSync(path.join(B, "CLAUDE.md"), "mes consignes");
  fs.writeFileSync(path.join(home, ".zshrc"), "export X=1\n");

  const avant = photo(home);
  const r = reparer(entrees(home));
  assert.deepEqual(r.erreurs, []);
  const apres = photo(home);
  for (const [chemin, contenu] of avant) {
    if (chemin === cheminLanceur(home)) continue; // réparé : remplacé par la copie du lanceur
    assert.ok(apres.has(chemin), `supprimé : ${chemin}`);
    assert.equal(apres.get(chemin), contenu, `modifié : ${chemin}`);
  }
  assert.equal(sha(cheminLanceur(home)), sha(LANCEUR));
  assert.equal(fs.statSync(path.join(A, ".claude.json")).mode & 0o777, 0o600);
  assert.ok(fs.lstatSync(path.join(A, "plugins")).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(base(home), "todos")));
  assert.ok(fs.existsSync(sousDossier.registre(home)));
  assert.equal(fs.readFileSync(path.join(B, "skills", "a-moi.md"), "utf8"), "précieux");
  assert.equal(fs.readFileSync(path.join(B, "CLAUDE.md"), "utf8"), "mes consignes");

  // ce qui reste en travers est dit, et n'est plus réparable
  assert.equal(par(r.apres, "compte.B.liens").reparable, false);
  assert.deepEqual(reparables(r.apres), []);
  // un deuxième passage ne fait plus rien
  assert.deepEqual(reparer(entrees(home)).actions, []);
});

test("réparer sur une installation saine ne fait rien, et ne lève jamais d'erreur même quand tout échoue", () => {
  const home = installee();
  assert.deepEqual(reparer(entrees(home)).actions, []);
  const absent = path.join(os.tmpdir(), "diag-test-absent-" + process.pid);
  assert.doesNotThrow(() => reparer(entrees(absent, { lanceurInclus: path.join(absent, "x.sh") })));
  assert.doesNotThrow(() => verifier(entrees(absent)));
  assert.doesNotThrow(() => reparer(entrees(absent, { plateforme: "win32" })));
});

// --- Résumé lisible -----------------------------------------------------------------------------

test("résumé : une ligne par vérification, une marque d'état, « réparable » dit ; en anglais et en français sans variable restante", () => {
  const home = installee();
  fs.chmodSync(path.join(dossierCompte("A", home), ".claude.json"), 0o644);
  for (const langue of ["en", "fr"] as const) {
    const v = verifier(entrees(home, { langue }));
    const texte = resumeTexte(v, langue);
    const lignes = texte.split("\n").filter(Boolean);
    assert.equal(lignes.length, v.length, langue);
    assert.doesNotMatch(texte, /\{\w+\}/, langue);
    assert.match(texte, /✔/);
    assert.match(texte, /⚠/);
    assert.match(lignes.find((l) => l.includes("644")) ?? "", langue === "en" ? /can be repaired/ : /réparable/);
    assert.equal(nomVerification("compte.B.liens", langue).includes("B"), true);
  }
  const messy = verifier(entrees(home, { plateforme: "win32", langue: "fr" }));
  assert.doesNotMatch(resumeTexte(messy, "fr"), /\{\w+\}/);
});

// --- Diagnostic à copier : rien de personnel ------------------------------------------------------

test("rapport : versions, système, état du lanceur et chaque vérification ; jamais d'adresse, de nom de compte, de conversation, de jeton ; le dossier personnel devient ~", () => {
  const home = installee();
  // Des données personnelles, partout où un code distrait irait les chercher.
  fs.writeFileSync(path.join(sousDossier.registre(home), UUID), "A\n");
  fs.writeFileSync(path.join(dossierCompte("B", home), ".claude.json"), JSON.stringify({ oauthAccount: { emailAddress: "john.smith@example.org", displayName: "personal" }, token: "sk-ant-oat01-SECRET" }), { mode: 0o600 });
  fs.mkdirSync(path.join(base(home), "projects", "-Users-jane-work"), { recursive: true });
  fs.writeFileSync(path.join(base(home), "projects", "-Users-jane-work", `${UUID}.jsonl`), JSON.stringify({ title: "Mon projet secret" }));
  const ext = fs.mkdtempSync(path.join(home, "ext-"));
  fs.mkdirSync(path.join(ext, "resources", "native-binary"), { recursive: true });
  fs.writeFileSync(path.join(ext, "resources", "native-binary", "claude"), "");
  const reglageEtranger = `${home}/work/personal/${EMAIL}/wrapper.sh`;

  for (const reglageLanceur of [cheminLanceur(home), reglageEtranger, undefined]) {
    for (const langue of ["en", "fr"] as const) {
      const rapport = construireRapport(entrees(home, { reglageLanceur, dossierExtensionClaude: ext, langue }));

      // ce qui doit y être
      assert.match(rapport, /0\.3\.0/);
      assert.match(rapport, /1\.94\.2/);
      assert.match(rapport, /2\.1\.319/);
      assert.match(rapport, /macOS/);
      assert.match(rapport, /darwin/);
      assert.match(rapport, /arm64/);
      assert.match(rapport, reglageLanceur === undefined ? /not set/ : reglageLanceur === reglageEtranger ? /another program/ : /Twinseat's launcher/);
      for (const x of verifier(entrees(home, { reglageLanceur, dossierExtensionClaude: ext, langue: "en" }))) {
        assert.ok(rapport.includes(x.nom), `vérification absente du rapport : ${x.id}`);
        assert.ok(rapport.includes(x.detail), `détail absent du rapport : ${x.id}`);
      }
      assert.match(rapport, /^# /);
      assert.doesNotMatch(rapport, /\{\w+\}/);
      assert.match(rapport, /Twinseat diagnostics/, "toujours en anglais, quelle que soit la langue de VS Code");

      // ce qui ne doit JAMAIS y être
      assert.ok(!rapport.includes("@"), "aucun @");
      for (const interdit of [EMAIL, "jane.doe", "john.smith", "example.com", "example.org", UUID, "work", "personal", "Mon projet secret", "sk-ant", "SECRET", "wrapper.sh"]) {
        assert.ok(!rapport.toLowerCase().includes(interdit.toLowerCase()), `« ${interdit} » dans le rapport`);
      }
      assert.ok(!rapport.includes(home), "le dossier personnel n'est pas écrit en clair");
      assert.ok(!rapport.includes(fs.realpathSync(home)), "ni sous son nom réel");
      assert.ok(!rapport.includes(os.homedir()) || os.homedir() === "/", "ni le vrai dossier personnel de la machine");
      assert.match(rapport, /~\/\.claude\/comptes/, "les chemins sont écrits avec ~");
    }
  }
});

test("rapport : le diagnostic ne contient que des textes sans les mots « work » ni « personal » (les noms de comptes ne s'y glissent pas par hasard)", () => {
  for (const [cle, texte] of Object.entries(en)) {
    if (!/^(diag|rapport|reglage)\./.test(cle)) continue;
    assert.doesNotMatch(texte, /work|personal/i, cle);
  }
  assert.ok(Object.keys(fr).some((c) => c.startsWith("rapport.")));
});

test("anonymiser : dossier personnel → ~, adresses, numéros de conversation, et tout « @ » restant", () => {
  const home = "/Users/jane";
  assert.equal(anonymiser("/Users/jane/.claude/x et /Users/jane", home), "~/.claude/x et ~");
  assert.equal(anonymiser("écrit à jane.doe@example.com.", home).includes("@"), false);
  assert.ok(!anonymiser("écrit à jane.doe@example.com.", home).includes("jane.doe"));
  assert.ok(!anonymiser(`id ${UUID.toUpperCase()}`, home).includes(UUID.toUpperCase()));
  assert.ok(!anonymiser(`id ${UUID}`, home).includes(UUID));
  assert.equal(anonymiser("@anthropic-ai/claude-code", home).includes("@"), false);
  assert.equal(anonymiser("rien à cacher", home), "rien à cacher");
  assert.equal(anonymiser("/Users/janet/x", home), "/Users/janet/x", "le nom d'un autre dossier n'est pas coupé en deux");
  assert.equal(anonymiser("/Users/jane/", "/Users/jane/"), "~/", "barre finale du dossier personnel ignorée");
  assert.equal(anonymiser("/ et /a", "/"), "/ et /a", "un dossier personnel réduit à / n'est pas remplacé");
});

test("rapport : même une version qui contient une adresse ou le dossier personnel est nettoyée", () => {
  const home = installee();
  const rapport = construireRapport(entrees(home, { versions: { twinseat: `0.3.0 (${EMAIL})`, vscode: `${home}/code`, claudeCode: `@anthropic/${UUID}` } }));
  assert.ok(!rapport.includes("@"));
  assert.ok(!rapport.includes(EMAIL));
  assert.ok(!rapport.includes(home));
  assert.ok(!rapport.includes(UUID));
  assert.match(rapport, /~\/code/);
});

test("rapport sans l'extension Claude Code : le dit, sans planter", () => {
  const home = installee();
  const rapport = construireRapport(entrees(home, { versions: { twinseat: "0.3.0", vscode: "1.94.2", claudeCode: undefined } }));
  assert.match(rapport, /not installed/);
});

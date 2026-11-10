import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createScanner, parse, ParseError } from "jsonc-parser";
import { cheminLanceur } from "../chemins";
import { CLE_REGLAGE, desinstaller, fichiersReglages, retirerLanceur, PRODUITS, SERVEURS } from "../desinstallation";

const maison = () => fs.mkdtempSync(path.join(os.tmpdir(), "desinstall-test-"));
const L = "/Users/jane/.claude/comptes/bin/lanceur";
const ligne = (valeur: string) => `"${CLE_REGLAGE}": "${valeur}"`;

// --- Le cœur : texte → nouveau texte (ou null) ---------------------------------------------

test("retirerLanceur : notre lanceur retiré, commentaires et virgules finales gardés", () => {
  const avant = [
    "// Mes réglages",
    "{",
    "  // éditeur",
    `  "editor.fontSize": 14, /* garde-moi */`,
    "  // le lanceur de Twinseat",
    `  ${ligne(L)},`,
    `  "files.autoSave": "afterDelay", // garde aussi`,
    "}",
    "",
  ].join("\n");
  const apres = [
    "// Mes réglages",
    "{",
    "  // éditeur",
    `  "editor.fontSize": 14, /* garde-moi */`,
    "  // le lanceur de Twinseat",
    `  "files.autoSave": "afterDelay", // garde aussi`,
    "}",
    "",
  ].join("\n");
  assert.equal(retirerLanceur(avant, L), apres);
});

test("retirerLanceur : le lanceur peut être premier, dernier (avec ou sans virgule finale), seul ou sur une seule ligne", () => {
  const cas: [string, string][] = [
    [`{\n  ${ligne(L)},\n  "a": 1\n}\n`, `{\n  "a": 1\n}\n`],
    [`{\n  "a": 1,\n  ${ligne(L)}\n}\n`, `{\n  "a": 1\n}\n`],
    [`{\n  "a": 1,\n  ${ligne(L)},\n}\n`, `{\n  "a": 1,\n}\n`],
    [`{\n  ${ligne(L)}\n}\n`, `{\n}\n`],
    [`{"a":1,${ligne(L)},"b":2}`, `{"a":1,"b":2}`],
    [`{"a":1,${ligne(L)}}`, `{"a":1}`],
    [`{\r\n  "a": 1,\r\n  ${ligne(L)},\r\n  "b": 2\r\n}\r\n`, `{\r\n  "a": 1,\r\n  "b": 2\r\n}\r\n`],
    [`﻿{\n  "a": 1,\n  ${ligne(L)}\n}\n`, `﻿{\n  "a": 1\n}\n`],
    [`{\n\t"a": 1,\n\t${ligne(L)},\n\t"b": 2\n}\n`, `{\n\t"a": 1,\n\t"b": 2\n}\n`],
  ];
  for (const [avant, attendu] of cas) assert.equal(retirerLanceur(avant, L), attendu, JSON.stringify(avant));
});

test("retirerLanceur : un autre lanceur, ou rien d'exploitable → null (le fichier ne bouge pas)", () => {
  const cas: Record<string, string> = {
    "lanceur étranger": `{\n  ${ligne("/opt/autre/wrapper.sh")},\n  "a": 1\n}\n`,
    "lanceur d'un autre utilisateur": `{\n  ${ligne("/Users/autre/.claude/comptes/bin/lanceur")}\n}\n`,
    "même chemin avec une barre finale": `{\n  ${ligne(L + "/")}\n}\n`,
    "même chemin avec ~": `{\n  ${ligne("~/.claude/comptes/bin/lanceur")}\n}\n`,
    "aucun lanceur": `{\n  "a": 1\n}\n`,
    "valeur nulle": `{\n  "${CLE_REGLAGE}": null\n}\n`,
    "valeur numérique": `{\n  "${CLE_REGLAGE}": 3\n}\n`,
    "valeur objet": `{\n  "${CLE_REGLAGE}": { "x": "${L}" }\n}\n`,
    "clé imbriquée, pas à la racine": `{\n  "autre": { ${ligne(L)} }\n}\n`,
    "clé en double, la nôtre en dernier (ambigu)": `{\n  ${ligne("/opt/autre")},\n  ${ligne(L)}\n}\n`,
    "clé en double, la nôtre en premier : c'est l'autre qui gagne": `{\n  ${ligne(L)},\n  ${ligne("/opt/autre")}\n}\n`,
    "clé en double, deux fois la nôtre": `{\n  ${ligne(L)},\n  ${ligne(L)}\n}\n`,
    "JSON invalide (accolade)": `{ "a": 1, ${ligne(L)} `,
    "JSON invalide (virgule)": `{ "a": 1 ${ligne(L)} }`,
    "fichier vide": "",
    "racine tableau": `[1, 2]`,
    "texte quelconque": `export PATH=$PATH:/x`,
  };
  for (const [nom, texte] of Object.entries(cas)) assert.equal(retirerLanceur(texte, L), null, nom);
});

/** Les commentaires d'un texte, dans l'ordre. */
function commentaires(texte: string): string[] {
  const s = createScanner(texte, false);
  const trouves: string[] = [];
  for (let k = s.scan(); k !== 17 /* EOF */; k = s.scan()) {
    if (k === 12 /* ligne */ || k === 13 /* bloc */) trouves.push(texte.slice(s.getTokenOffset(), s.getTokenOffset() + s.getTokenLength()).trim());
  }
  return trouves;
}

test("retirerLanceur : quelle que soit la mise en forme, le résultat est valide, ne perd aucun commentaire ni aucun autre réglage", () => {
  const lignes = ["a", "b", "c"].map((k, i) => `"${k}": ${i}`);
  let essais = 0;
  for (const eol of ["\n", "\r\n"]) {
    for (const position of [0, 1, 2, 3]) {
      for (const virguleFinale of [false, true]) {
        for (const commentaireAvant of [false, true]) {
          for (const commentaireApres of ["", " // après", " /* après */"]) {
            for (const compact of [false, true]) {
              const ordre = [...lignes];
              ordre.splice(position, 0, ligne(L));
              const corps = ordre.map((l, i) => {
                const dernier = i === ordre.length - 1;
                const virgule = !dernier || virguleFinale ? "," : "";
                const note = i === position ? commentaireApres : "";
                const avant = i === position && commentaireAvant ? `// avant${eol}  ` : "";
                return compact ? `${l}${virgule}${note}${note.startsWith(" //") ? eol : ""}` : `  ${avant}${l}${virgule}${note}`;
              });
              const texte = compact ? `{${corps.join("")}}` : `// début${eol}{${eol}${corps.join(eol)}${eol}}${eol}`;
              const erreurs: ParseError[] = [];
              const avantObjet = parse(texte, erreurs, { allowTrailingComma: true });
              assert.equal(erreurs.length, 0, `fixture invalide : ${JSON.stringify(texte)}`);
              const apres = retirerLanceur(texte, L);
              assert.notEqual(apres, null, JSON.stringify(texte));
              const erreurs2: ParseError[] = [];
              const apresObjet = parse(apres as string, erreurs2, { allowTrailingComma: true });
              assert.equal(erreurs2.length, 0, `résultat invalide : ${JSON.stringify(apres)} (depuis ${JSON.stringify(texte)})`);
              const attendu = { ...avantObjet };
              delete attendu[CLE_REGLAGE];
              assert.deepEqual(apresObjet, attendu, JSON.stringify(texte));
              assert.deepEqual(commentaires(apres as string), commentaires(texte), `commentaires perdus : ${JSON.stringify(texte)}`);
              assert.ok(!(apres as string).includes(L), JSON.stringify(texte));
              essais++;
            }
          }
        }
      }
    }
  }
  assert.ok(essais >= 190, `${essais} combinaisons essayées`);
});

// --- Les fichiers : emplacements par plateforme ---------------------------------------------

const PRODUITS_ATTENDUS = ["Code", "Code - Insiders", "Code - OSS", "VSCodium", "Cursor", "Windsurf"];
const SERVEURS_ATTENDUS = [".vscode-server", ".vscode-server-insiders", ".cursor-server", ".windsurf-server", ".vscodium-server"];
/** Les réglages d'un serveur distant : Machine et User, sous le dossier personnel (quel que soit le système). */
const reglagesServeurs = (h: string): string[] => SERVEURS_ATTENDUS.flatMap((s) => ["Machine", "User"].map((d) => path.join(h, s, "data", d, "settings.json")));

function reglage(home: string, plateforme: "darwin" | "linux", produit: string, xdg?: string): string {
  const racine = plateforme === "darwin" ? path.join(home, "Library", "Application Support") : (xdg ?? path.join(home, ".config"));
  return path.join(racine, produit, "User", "settings.json");
}

function ecrire(fichier: string, texte: string, mode?: number): void {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  fs.writeFileSync(fichier, texte);
  if (mode !== undefined) fs.chmodSync(fichier, mode);
}

const AVEC_NOTRE = (home: string) => `// réglages de ${path.basename(home)}\n{\n  "editor.fontSize": 14,\n  ${ligne(cheminLanceur(home))},\n  "files.autoSave": "off"\n}\n`;

test("les six éditeurs (Code - OSS compris) et les cinq serveurs distants, sous macOS et sous Linux", () => {
  assert.deepEqual([...PRODUITS], PRODUITS_ATTENDUS);
  assert.deepEqual([...SERVEURS], SERVEURS_ATTENDUS);
  const h = "/home/jane";
  const serveurs = reglagesServeurs(h);
  assert.equal(serveurs.length, 10);
  assert.ok(serveurs.includes("/home/jane/.vscode-server/data/Machine/settings.json"));
  assert.ok(serveurs.includes("/home/jane/.cursor-server/data/User/settings.json"));
  assert.deepEqual(
    fichiersReglages({ home: h, plateforme: "darwin", xdg: null }).sort(),
    [...PRODUITS_ATTENDUS.map((p) => `${h}/Library/Application Support/${p}/User/settings.json`), ...serveurs].sort(),
  );
  assert.deepEqual(
    fichiersReglages({ home: h, plateforme: "linux", xdg: null }).sort(),
    [...PRODUITS_ATTENDUS.map((p) => `${h}/.config/${p}/User/settings.json`), ...serveurs].sort(),
  );
  // XDG_CONFIG_HOME, quand il est défini et absolu, s'ajoute (sans doublon) ; sinon il est ignoré.
  const total = PRODUITS_ATTENDUS.length + serveurs.length;
  const avecXdg = fichiersReglages({ home: h, plateforme: "linux", xdg: "/srv/conf" });
  assert.equal(avecXdg.length, PRODUITS_ATTENDUS.length * 2 + serveurs.length);
  assert.ok(avecXdg.includes("/srv/conf/Code/User/settings.json"));
  assert.ok(avecXdg.includes("/srv/conf/Code - OSS/User/settings.json"));
  assert.equal(fichiersReglages({ home: h, plateforme: "linux", xdg: `${h}/.config` }).length, total);
  assert.equal(fichiersReglages({ home: h, plateforme: "linux", xdg: "relatif/conf" }).length, total);
  assert.equal(fichiersReglages({ home: h, plateforme: "linux", xdg: "" }).length, total);
  assert.equal(fichiersReglages({ home: h, plateforme: "darwin", xdg: "/srv/conf" }).length, total);
  // Une plateforme sans éditeur connu : rien à nettoyer.
  assert.deepEqual(fichiersReglages({ home: h, plateforme: "win32", xdg: null }), []);
});

test("macOS : notre lanceur est retiré dans chaque éditeur, un lanceur étranger reste, un fichier absent est ignoré", () => {
  const home = maison();
  const etranger = `{\n  ${ligne("/opt/autre/wrapper.sh")},\n  "a": 1\n}\n`;
  for (const p of ["Code", "Code - Insiders", "VSCodium", "Windsurf"]) ecrire(reglage(home, "darwin", p), AVEC_NOTRE(home), p === "Windsurf" ? 0o664 : 0o600);
  ecrire(reglage(home, "darwin", "Cursor"), etranger);
  // Un fichier posé là où macOS ne le cherche pas : jamais touché.
  const lineaire = reglage(home, "linux", "Code");
  ecrire(lineaire, AVEC_NOTRE(home));

  const r = desinstaller({ home, plateforme: "darwin", xdg: null });

  for (const p of ["Code", "Code - Insiders", "VSCodium", "Windsurf"]) {
    const f = reglage(home, "darwin", p);
    const texte = fs.readFileSync(f, "utf8");
    assert.ok(!texte.includes(CLE_REGLAGE), p);
    assert.ok(texte.includes("// réglages de") && texte.includes(`"editor.fontSize": 14`) && texte.includes(`"files.autoSave": "off"`), p);
    assert.equal(fs.statSync(f).mode & 0o777, p === "Windsurf" ? 0o664 : 0o600, `mode gardé : ${p}`); // 664 : le umask ne doit pas le rogner
    assert.deepEqual(fs.readdirSync(path.dirname(f)), ["settings.json"], `aucun fichier temporaire : ${p}`);
  }
  assert.equal(fs.readFileSync(reglage(home, "darwin", "Cursor"), "utf8"), etranger);
  assert.equal(fs.readFileSync(lineaire, "utf8"), AVEC_NOTRE(home));
  assert.deepEqual(r.filter((x) => x.issue === "retire").map((x) => x.fichier).sort(), ["Code", "Code - Insiders", "VSCodium", "Windsurf"].map((p) => reglage(home, "darwin", p)).sort());
  assert.equal(r.find((x) => x.fichier === reglage(home, "darwin", "Cursor"))?.issue, "inchange");
  assert.ok(r.every((x) => x.issue === "retire" || x.issue === "inchange" || x.issue === "absent"));
});

test("Linux : ~/.config/<éditeur>/User/settings.json, et XDG_CONFIG_HOME quand il est défini", () => {
  const home = maison();
  const xdg = path.join(home, "ailleurs");
  for (const p of PRODUITS_ATTENDUS) ecrire(reglage(home, "linux", p), AVEC_NOTRE(home));
  ecrire(reglage(home, "linux", "Code", xdg), AVEC_NOTRE(home));
  const macOs = reglage(home, "darwin", "Code");
  ecrire(macOs, AVEC_NOTRE(home));

  desinstaller({ home, plateforme: "linux", xdg });

  for (const p of PRODUITS_ATTENDUS) assert.ok(!fs.readFileSync(reglage(home, "linux", p), "utf8").includes(CLE_REGLAGE), p);
  assert.ok(!fs.readFileSync(reglage(home, "linux", "Code", xdg), "utf8").includes(CLE_REGLAGE));
  assert.equal(fs.readFileSync(macOs, "utf8"), AVEC_NOTRE(home), "l'emplacement macOS est ignoré sous Linux");
});

test("profils VS Code : User/profiles/<id>/settings.json est nettoyé aussi", () => {
  const home = maison();
  const defaut = reglage(home, "darwin", "Code");
  const profil = path.join(path.dirname(defaut), "profiles", "-1a2b3c4d", "settings.json");
  const autreProfil = path.join(path.dirname(defaut), "profiles", "5e6f7a8b", "settings.json");
  ecrire(defaut, AVEC_NOTRE(home));
  ecrire(profil, AVEC_NOTRE(home));
  ecrire(autreProfil, `{ ${ligne("/opt/autre")} }`);
  fs.mkdirSync(path.join(path.dirname(defaut), "profiles", "vide"), { recursive: true });
  desinstaller({ home, plateforme: "darwin", xdg: null });
  assert.ok(!fs.readFileSync(defaut, "utf8").includes(CLE_REGLAGE));
  assert.ok(!fs.readFileSync(profil, "utf8").includes(CLE_REGLAGE));
  assert.equal(fs.readFileSync(autreProfil, "utf8"), `{ ${ligne("/opt/autre")} }`);
});

test("fichier illisible, invalide, vide ou qui n'en est pas un : intact, sans erreur", () => {
  const home = maison();
  const invalide = `{ "a": 1, ${ligne(cheminLanceur(home))} `; // accolade manquante
  ecrire(reglage(home, "darwin", "Code"), invalide);
  ecrire(reglage(home, "darwin", "VSCodium"), "");
  ecrire(reglage(home, "darwin", "Cursor"), "nimporte quoi");
  fs.mkdirSync(reglage(home, "darwin", "Windsurf"), { recursive: true }); // un dossier qui s'appelle settings.json
  const r = desinstaller({ home, plateforme: "darwin", xdg: null });
  assert.equal(fs.readFileSync(reglage(home, "darwin", "Code"), "utf8"), invalide);
  assert.equal(fs.readFileSync(reglage(home, "darwin", "VSCodium"), "utf8"), "");
  assert.equal(fs.readFileSync(reglage(home, "darwin", "Cursor"), "utf8"), "nimporte quoi");
  assert.ok(fs.statSync(reglage(home, "darwin", "Windsurf")).isDirectory());
  assert.ok(r.every((x) => x.issue !== "retire"));
});

test("settings.json est un lien (gestionnaire de dotfiles) : le lien reste, la cible est mise à jour", () => {
  const home = maison();
  const cible = path.join(home, "dotfiles", "settings.json");
  ecrire(cible, AVEC_NOTRE(home), 0o640);
  const lien = reglage(home, "darwin", "Code");
  fs.mkdirSync(path.dirname(lien), { recursive: true });
  fs.symlinkSync(cible, lien);
  desinstaller({ home, plateforme: "darwin", xdg: null });
  assert.ok(fs.lstatSync(lien).isSymbolicLink(), "le lien est toujours un lien");
  assert.equal(fs.readlinkSync(lien), cible);
  assert.ok(!fs.readFileSync(cible, "utf8").includes(CLE_REGLAGE));
  assert.equal(fs.statSync(cible).mode & 0o777, 0o640);
  assert.deepEqual(fs.readdirSync(path.dirname(cible)), ["settings.json"]);
});

test("ne lève jamais : dossier personnel absent, dossier non modifiable", (t) => {
  const absent = path.join(maison(), "n-existe-pas");
  assert.doesNotThrow(() => desinstaller({ home: absent, plateforme: "darwin", xdg: null }));
  assert.doesNotThrow(() => desinstaller({ home: absent, plateforme: "linux", xdg: null }));

  if (process.getuid?.() === 0) {
    t.diagnostic("exécuté en root : l'essai du dossier non modifiable est sauté");
    return;
  }
  const home = maison();
  const f = reglage(home, "darwin", "Code");
  ecrire(f, AVEC_NOTRE(home));
  fs.chmodSync(path.dirname(f), 0o500); // lisible, pas modifiable : le fichier temporaire ne peut pas être créé
  try {
    const r = desinstaller({ home, plateforme: "darwin", xdg: null });
    assert.equal(fs.readFileSync(f, "utf8"), AVEC_NOTRE(home), "le fichier d'origine reste intact");
    assert.equal(r.find((x) => x.fichier === f)?.issue, "ecriture");
  } finally {
    fs.chmodSync(path.dirname(f), 0o700);
  }
});

// --- Code - OSS et les serveurs distants -------------------------------------------------------------------------

test("Code - OSS : le dossier de réglages de la version libre de VS Code est nettoyé aussi", () => {
  const home = maison();
  const f = reglage(home, "linux", "Code - OSS");
  ecrire(f, AVEC_NOTRE(home));
  const r = desinstaller({ home, plateforme: "linux", xdg: null });
  assert.ok(!fs.readFileSync(f, "utf8").includes(CLE_REGLAGE));
  assert.equal(r.find((x) => x.fichier === f)?.issue, "retire");
});

test("serveurs distants : ~/.vscode-server et ses frères, réglages Machine, User et profils", () => {
  for (const plateforme of ["linux", "darwin"] as const) {
    const home = maison();
    const etranger = `{ ${ligne("/opt/autre")} }`;
    for (const f of reglagesServeurs(home)) ecrire(f, AVEC_NOTRE(home));
    const profil = path.join(home, ".cursor-server", "data", "User", "profiles", "-1a2b", "settings.json");
    ecrire(profil, AVEC_NOTRE(home));
    const autre = path.join(home, ".windsurf-server", "data", "Machine", "settings.json");
    ecrire(autre, etranger); // un lanceur étranger reste
    const horsPlan = path.join(home, ".vscode-server", "data", "Machine", "autre.json");
    ecrire(horsPlan, AVEC_NOTRE(home)); // pas un settings.json : jamais touché

    const r = desinstaller({ home, plateforme, xdg: null });

    for (const f of [...reglagesServeurs(home).filter((x) => x !== autre), profil]) {
      assert.ok(!fs.readFileSync(f, "utf8").includes(CLE_REGLAGE), `${plateforme} : ${f}`);
      assert.equal(r.find((x) => x.fichier === f)?.issue, "retire", f);
    }
    assert.equal(fs.readFileSync(autre, "utf8"), etranger);
    assert.equal(fs.readFileSync(horsPlan, "utf8"), AVEC_NOTRE(home));
  }
  // Une plateforme sans éditeur connu ne touche pas non plus aux dossiers de serveur.
  const home = maison();
  const f = reglagesServeurs(home)[0];
  ecrire(f, AVEC_NOTRE(home));
  desinstaller({ home, plateforme: "win32", xdg: null });
  assert.equal(fs.readFileSync(f, "utf8"), AVEC_NOTRE(home));
});

// --- Twinseat est encore installé dans un autre éditeur ---------------------------------------------------------

const EXT = "alexdmrx.twinseat-0.3.0";
const dossierExt = (home: string, dossier: string, nom = EXT): string => {
  const d = path.join(home, dossier, "extensions", nom);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

test("désinstaller dans Cursor ne retire pas le réglage de VS Code tant que Twinseat y est installé", () => {
  const home = maison();
  const code = reglage(home, "linux", "Code");
  const cursor = reglage(home, "linux", "Cursor");
  const insiders = reglage(home, "linux", "Code - Insiders");
  for (const f of [code, cursor, insiders]) ecrire(f, AVEC_NOTRE(home));
  dossierExt(home, ".vscode"); // Twinseat est toujours dans VS Code
  const moi = dossierExt(home, ".cursor"); // et c'est l'installation de Cursor qu'on retire : son script tourne de là
  const journal: string[] = [];

  const r = desinstaller({ home, plateforme: "linux", xdg: null, dossierExtension: moi }, (m) => journal.push(m));

  assert.equal(fs.readFileSync(code, "utf8"), AVEC_NOTRE(home), "VS Code garde son réglage : Twinseat y est encore");
  assert.ok(!fs.readFileSync(cursor, "utf8").includes(CLE_REGLAGE), "Cursor est nettoyé : c'est lui qu'on désinstalle");
  assert.ok(!fs.readFileSync(insiders, "utf8").includes(CLE_REGLAGE), "Insiders n'a pas Twinseat : nettoyé");
  assert.equal(r.find((x) => x.fichier === code)?.issue, "installee");
  assert.equal(r.find((x) => x.fichier === cursor)?.issue, "retire");
  assert.ok(journal.some((m) => m.includes(".vscode") && /still installed/.test(m)), journal.join("\n"));
});

test("sans connaître sa propre installation, tout dossier d'installation compte : l'éditeur est laissé tel quel", () => {
  const home = maison();
  const f = reglage(home, "darwin", "Cursor");
  ecrire(f, AVEC_NOTRE(home));
  dossierExt(home, ".cursor");
  const r = desinstaller({ home, plateforme: "darwin", xdg: null });
  assert.equal(fs.readFileSync(f, "utf8"), AVEC_NOTRE(home));
  assert.equal(r.find((x) => x.fichier === f)?.issue, "installee");
  // un dossier d'extensions vide, ou sans Twinseat, ne retient rien
  const propre = maison();
  const g = reglage(propre, "darwin", "Cursor");
  ecrire(g, AVEC_NOTRE(propre));
  dossierExt(propre, ".cursor", "anthropic.claude-code-2.1.319");
  dossierExt(propre, ".cursor", "alexdmrx.twinseatx-1.0.0"); // un autre identifiant
  dossierExt(propre, ".cursor", "alexdmrx.twinseat"); // pas de version : pas une installation
  fs.writeFileSync(path.join(propre, ".cursor", "extensions", EXT), "un fichier, pas un dossier");
  desinstaller({ home: propre, plateforme: "darwin", xdg: null });
  assert.ok(!fs.readFileSync(g, "utf8").includes(CLE_REGLAGE));
});

test("une autre version de Twinseat à côté de la mienne compte ; une installation que VS Code a marquée supprimée (.obsolete), non", () => {
  const home = maison();
  const f = reglage(home, "linux", "Code");
  ecrire(f, AVEC_NOTRE(home));
  const moi = dossierExt(home, ".vscode");
  dossierExt(home, ".vscode", "alexdmrx.twinseat-0.2.0");
  assert.equal(desinstaller({ home, plateforme: "linux", xdg: null, dossierExtension: moi }).find((x) => x.fichier === f)?.issue, "installee");
  assert.equal(fs.readFileSync(f, "utf8"), AVEC_NOTRE(home));

  fs.writeFileSync(path.join(home, ".vscode", "extensions", ".obsolete"), JSON.stringify({ "alexdmrx.twinseat-0.2.0": true }));
  assert.equal(desinstaller({ home, plateforme: "linux", xdg: null, dossierExtension: moi }).find((x) => x.fichier === f)?.issue, "retire");
  assert.ok(!fs.readFileSync(f, "utf8").includes(CLE_REGLAGE));

  // un .obsolete illisible ne marque rien
  const autre = maison();
  const g = reglage(autre, "linux", "Code");
  ecrire(g, AVEC_NOTRE(autre));
  const m2 = dossierExt(autre, ".vscode");
  dossierExt(autre, ".vscode", "alexdmrx.twinseat-0.2.0");
  fs.writeFileSync(path.join(autre, ".vscode", "extensions", ".obsolete"), "{ pas du json");
  assert.equal(desinstaller({ home: autre, plateforme: "linux", xdg: null, dossierExtension: m2 }).find((x) => x.fichier === g)?.issue, "installee");
});

test("un lien vers l'installation de Twinseat (développement) compte comme une installation, sauf si c'est la mienne", () => {
  const home = maison();
  const f = reglage(home, "linux", "Code");
  ecrire(f, AVEC_NOTRE(home));
  const source = path.join(home, "depot", "twinseat");
  fs.mkdirSync(source, { recursive: true });
  fs.mkdirSync(path.join(home, ".vscode", "extensions"), { recursive: true });
  fs.symlinkSync(source, path.join(home, ".vscode", "extensions", EXT));
  assert.equal(desinstaller({ home, plateforme: "linux", xdg: null }).find((x) => x.fichier === f)?.issue, "installee");
  assert.equal(desinstaller({ home, plateforme: "linux", xdg: null, dossierExtension: source }).find((x) => x.fichier === f)?.issue, "retire");
});

test("VSCodium et Code - OSS partagent ~/.vscode-oss : si c'est la mienne, les deux sont nettoyés ; sinon, les deux restent", () => {
  const home = maison();
  const oss = reglage(home, "linux", "Code - OSS");
  const codium = reglage(home, "linux", "VSCodium");
  ecrire(oss, AVEC_NOTRE(home));
  ecrire(codium, AVEC_NOTRE(home));
  const dejaLa = dossierExt(home, ".vscode-oss");
  desinstaller({ home, plateforme: "linux", xdg: null });
  assert.equal(fs.readFileSync(oss, "utf8"), AVEC_NOTRE(home));
  assert.equal(fs.readFileSync(codium, "utf8"), AVEC_NOTRE(home));
  desinstaller({ home, plateforme: "linux", xdg: null, dossierExtension: dejaLa });
  assert.ok(!fs.readFileSync(oss, "utf8").includes(CLE_REGLAGE));
  assert.ok(!fs.readFileSync(codium, "utf8").includes(CLE_REGLAGE));
});

test("serveur distant : ~/.vscode-server/extensions garde les réglages Machine et User tant que Twinseat y est installé", () => {
  const home = maison();
  const machine = path.join(home, ".vscode-server", "data", "Machine", "settings.json");
  const utilisateur = path.join(home, ".vscode-server", "data", "User", "settings.json");
  const cursorServeur = path.join(home, ".cursor-server", "data", "Machine", "settings.json");
  for (const f of [machine, utilisateur, cursorServeur]) ecrire(f, AVEC_NOTRE(home));
  const dejaLa = dossierExt(home, ".vscode-server");
  const moi = dossierExt(home, ".cursor-server");
  desinstaller({ home, plateforme: "linux", xdg: null, dossierExtension: moi });
  assert.equal(fs.readFileSync(machine, "utf8"), AVEC_NOTRE(home));
  assert.equal(fs.readFileSync(utilisateur, "utf8"), AVEC_NOTRE(home));
  assert.ok(!fs.readFileSync(cursorServeur, "utf8").includes(CLE_REGLAGE));
  desinstaller({ home, plateforme: "linux", xdg: null, dossierExtension: dejaLa });
  assert.ok(!fs.readFileSync(machine, "utf8").includes(CLE_REGLAGE));
  assert.ok(!fs.readFileSync(utilisateur, "utf8").includes(CLE_REGLAGE));
});

test("dossier d'extensions qu'on ne peut pas lire : dans le doute, rien n'est touché", (t) => {
  if (process.getuid?.() === 0) {
    t.diagnostic("exécuté en root : l'essai du dossier illisible est sauté");
    return;
  }
  const home = maison();
  const f = reglage(home, "linux", "Cursor");
  ecrire(f, AVEC_NOTRE(home));
  const ext = path.join(home, ".cursor", "extensions");
  fs.mkdirSync(ext, { recursive: true });
  fs.chmodSync(ext, 0o000);
  try {
    const r = desinstaller({ home, plateforme: "linux", xdg: null });
    assert.equal(fs.readFileSync(f, "utf8"), AVEC_NOTRE(home));
    assert.equal(r.find((x) => x.fichier === f)?.issue, "installee");
  } finally {
    fs.chmodSync(ext, 0o700);
  }
});

// --- Fichiers qu'on ne réécrit pas sans risque ------------------------------------------------------------------

test("octets qui ne sont pas de l'UTF-8 (un « é » en latin-1 dans un commentaire) : le fichier n'est pas touché, octet pour octet", () => {
  const home = maison();
  const f = reglage(home, "darwin", "Code");
  const brut = Buffer.concat([
    Buffer.from(`// r`, "utf8"),
    Buffer.from([0xe9]), // « é » en latin-1 : invalide en UTF-8
    Buffer.from(`glages\n{\n  "editor.fontSize": 14,\n  ${ligne(cheminLanceur(home))},\n  "files.autoSave": "off"\n}\n`, "utf8"),
  ]);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, brut, { mode: 0o600 });
  const journal: string[] = [];
  const r = desinstaller({ home, plateforme: "darwin", xdg: null }, (m) => journal.push(m));
  assert.ok(fs.readFileSync(f).equals(brut), "les octets sont identiques");
  assert.equal(r.find((x) => x.fichier === f)?.issue, "abstention");
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ["settings.json"], "aucun fichier temporaire");
  assert.ok(journal.some((m) => /UTF-8/.test(m)), journal.join("\n"));
  assert.ok(brut.includes(CLE_REGLAGE), "le lanceur y est toujours : c'est bien le choix d'un fichier qu'on n'ose pas réécrire");
});

test("UTF-8 valide (accents, BOM, émoji) : nettoyé, et chaque octet qui reste est celui d'origine", () => {
  const home = maison();
  const f = reglage(home, "darwin", "Code");
  const avant = `﻿// réglages de Zoé 🚀\r\n{\r\n  "editor.fontFamily": "Fira Code, 'Noto Émoji'",\r\n  ${ligne(cheminLanceur(home))},\r\n  "files.autoSave": "off"\r\n}\r\n`;
  const attendu = `﻿// réglages de Zoé 🚀\r\n{\r\n  "editor.fontFamily": "Fira Code, 'Noto Émoji'",\r\n  "files.autoSave": "off"\r\n}\r\n`;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, avant, { mode: 0o600 });
  assert.equal(desinstaller({ home, plateforme: "darwin", xdg: null }).find((x) => x.fichier === f)?.issue, "retire");
  assert.ok(fs.readFileSync(f).equals(Buffer.from(attendu, "utf8")));
});

test("fichier non modifiable par son propriétaire (mode 0444) : intact, et son mode aussi", () => {
  const home = maison();
  const f = reglage(home, "darwin", "Code");
  ecrire(f, AVEC_NOTRE(home), 0o444);
  const journal: string[] = [];
  const r = desinstaller({ home, plateforme: "darwin", xdg: null }, (m) => journal.push(m));
  assert.equal(fs.readFileSync(f, "utf8"), AVEC_NOTRE(home));
  assert.equal(fs.statSync(f).mode & 0o777, 0o444);
  assert.equal(r.find((x) => x.fichier === f)?.issue, "abstention");
  assert.deepEqual(fs.readdirSync(path.dirname(f)), ["settings.json"]);
  assert.ok(journal.some((m) => /not writable/.test(m)), journal.join("\n"));
  // seul le bit d'écriture du propriétaire compte : 0400 (lecture seule), 0440, 0404…
  for (const mode of [0o400, 0o440, 0o404]) {
    fs.chmodSync(f, mode);
    assert.equal(desinstaller({ home, plateforme: "darwin", xdg: null }).find((x) => x.fichier === f)?.issue, "abstention", mode.toString(8));
  }
  // un fichier modifiable (0200, écriture seule pour le propriétaire) l'est : c'est la lecture qui manquerait, pas l'écriture
  fs.chmodSync(f, 0o600);
  assert.equal(desinstaller({ home, plateforme: "darwin", xdg: null }).find((x) => x.fichier === f)?.issue, "retire");
});

test("fichier à plusieurs liens physiques : intact (le renommage en ferait deux fichiers), les deux noms gardent le même contenu", () => {
  const home = maison();
  const f = reglage(home, "darwin", "Code");
  ecrire(f, AVEC_NOTRE(home));
  const jumeau = path.join(home, "settings-jumeau.json");
  fs.linkSync(f, jumeau);
  const journal: string[] = [];
  const r = desinstaller({ home, plateforme: "darwin", xdg: null }, (m) => journal.push(m));
  assert.equal(fs.readFileSync(f, "utf8"), AVEC_NOTRE(home));
  assert.equal(fs.readFileSync(jumeau, "utf8"), AVEC_NOTRE(home));
  assert.equal(fs.statSync(f).nlink, 2, "le lien physique existe toujours");
  assert.equal(fs.statSync(f).ino, fs.statSync(jumeau).ino);
  assert.equal(r.find((x) => x.fichier === f)?.issue, "abstention");
  assert.ok(journal.some((m) => /hard links/.test(m)), journal.join("\n"));
  // le jumeau retiré, il n'y a plus qu'un lien : le fichier est nettoyé
  fs.rmSync(jumeau);
  assert.equal(desinstaller({ home, plateforme: "darwin", xdg: null }).find((x) => x.fichier === f)?.issue, "retire");
});

test("settings.json lien symbolique vers un fichier à lien physique ou en lecture seule : la cible n'est pas réécrite non plus", () => {
  const home = maison();
  const cible = path.join(home, "dotfiles", "settings.json");
  ecrire(cible, AVEC_NOTRE(home), 0o444);
  const lien = reglage(home, "darwin", "Code");
  fs.mkdirSync(path.dirname(lien), { recursive: true });
  fs.symlinkSync(cible, lien);
  desinstaller({ home, plateforme: "darwin", xdg: null });
  assert.ok(fs.lstatSync(lien).isSymbolicLink());
  assert.equal(fs.readFileSync(cible, "utf8"), AVEC_NOTRE(home));
});

// --- Le point d'entrée de VS Code : node ./out/desinstallation.js -------------------------------

const SCRIPT = path.resolve(__dirname, "../desinstallation.js");

test("le script lancé par VS Code (node out/desinstallation.js) nettoie les réglages du HOME courant et sort avec 0", () => {
  const home = maison();
  const plateforme = process.platform === "darwin" ? "darwin" : "linux";
  const f = reglage(home, plateforme, "Code");
  const g = reglage(home, plateforme, "Cursor");
  ecrire(f, AVEC_NOTRE(home));
  ecrire(g, `{ ${ligne("/opt/autre")} }`);
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!fs.readFileSync(f, "utf8").includes(CLE_REGLAGE));
  assert.equal(fs.readFileSync(g, "utf8"), `{ ${ligne("/opt/autre")} }`);
  assert.equal(r.stdout, "", "rien sur la sortie standard");
});

test("le script sort avec 0 même sans aucun fichier de réglages", () => {
  const home = path.join(maison(), "vide");
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, HOME: home, XDG_CONFIG_HOME: "" }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

test("le script n'a besoin ni de vscode ni d'autre chose que node et jsonc-parser", () => {
  const exigences = (fichier: string) => [...fs.readFileSync(fichier, "utf8").matchAll(/require\("([^"]+)"\)/g)].map((m) => m[1]);
  const dir = path.dirname(SCRIPT);
  const vus = new Set<string>();
  const parcourir = (fichier: string): void => {
    for (const r of exigences(fichier)) {
      if (r.startsWith(".")) {
        const suivant = path.join(path.dirname(fichier), `${r}.js`);
        if (!vus.has(suivant)) {
          vus.add(suivant);
          parcourir(suivant);
        }
      } else {
        assert.ok(r.startsWith("node:") || r === "jsonc-parser", `${path.basename(fichier)} exige « ${r} »`);
      }
    }
  };
  parcourir(SCRIPT);
  assert.ok([...vus].every((f) => f.startsWith(dir)));
});

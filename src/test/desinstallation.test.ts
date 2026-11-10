import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createScanner, parse, ParseError } from "jsonc-parser";
import { cheminLanceur } from "../chemins";
import { CLE_REGLAGE, desinstaller, fichiersReglages, retirerLanceur, PRODUITS } from "../desinstallation";

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

const PRODUITS_ATTENDUS = ["Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf"];

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

test("les cinq éditeurs, sous macOS et sous Linux", () => {
  assert.deepEqual([...PRODUITS], PRODUITS_ATTENDUS);
  const h = "/home/jane";
  assert.deepEqual(
    fichiersReglages({ home: h, plateforme: "darwin", xdg: null }).sort(),
    PRODUITS_ATTENDUS.map((p) => `${h}/Library/Application Support/${p}/User/settings.json`).sort(),
  );
  assert.deepEqual(
    fichiersReglages({ home: h, plateforme: "linux", xdg: null }).sort(),
    PRODUITS_ATTENDUS.map((p) => `${h}/.config/${p}/User/settings.json`).sort(),
  );
  // XDG_CONFIG_HOME, quand il est défini et absolu, s'ajoute (sans doublon) ; sinon il est ignoré.
  const avecXdg = fichiersReglages({ home: h, plateforme: "linux", xdg: "/srv/conf" });
  assert.equal(avecXdg.length, PRODUITS_ATTENDUS.length * 2);
  assert.ok(avecXdg.includes("/srv/conf/Code/User/settings.json"));
  assert.equal(fichiersReglages({ home: h, plateforme: "linux", xdg: `${h}/.config` }).length, PRODUITS_ATTENDUS.length);
  assert.equal(fichiersReglages({ home: h, plateforme: "linux", xdg: "relatif/conf" }).length, PRODUITS_ATTENDUS.length);
  assert.equal(fichiersReglages({ home: h, plateforme: "linux", xdg: "" }).length, PRODUITS_ATTENDUS.length);
  assert.equal(fichiersReglages({ home: h, plateforme: "darwin", xdg: "/srv/conf" }).length, PRODUITS_ATTENDUS.length);
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

// Désinstallation propre. VS Code lance `node ./out/desinstallation.js` (scripts.vscode:uninstall
// du package.json) une fois l'extension désinstallée, en Node simple : AUCUNE API vscode ici, et
// pas plus d'imports que node, jsonc-parser (livré dans le .vsix) et ./chemins.
//
// Ce qu'il fait : dans les réglages des éditeurs fondés sur VS Code (Code, Code - Insiders, Code - OSS,
// VSCodium, Cursor, Windsurf, y compris leurs profils ; et, sur une machine distante, les dossiers
// ~/.vscode-server, ~/.cursor-server… : réglages Machine et User), retire `claudeCode.claudeProcessWrapper`
// SEULEMENT si sa valeur est exactement le lanceur de Twinseat (~/.claude/comptes/bin/lanceur,
// développé). Toute autre valeur, un fichier absent, illisible ou invalide : rien ne bouge. Le reste du
// fichier (commentaires, mise en forme, autres réglages) est gardé octet pour octet.
//
// Ce qu'il ne fait JAMAIS :
// - nettoyer un éditeur où Twinseat est encore installé (une désinstallation dans Cursor ne retire pas
//   le réglage de VS Code tant que Twinseat y est). VS Code lance ce script depuis le dossier de
//   l'installation qu'on retire : ce dossier-là, et ceux que VS Code a marqués supprimés (.obsolete), ne
//   comptent pas ;
// - réécrire un fichier dont les octets ne sont pas de l'UTF-8 valide, qui n'est pas modifiable par son
//   propriétaire, ou qui a plusieurs liens physiques (le renommage final casserait le lien).
//
// Ne lève jamais : seul stderr reçoit des lignes de journal, techniques et en anglais (ce n'est pas
// l'interface de l'extension).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { applyEdits, createScanner, Edit, Node, parse, parseTree, ParseError, ParseOptions, SyntaxKind } from "jsonc-parser";
import { cheminLanceur } from "./chemins";

/** Le réglage de Claude Code qui désigne le lanceur, tel qu'écrit dans settings.json. */
export const CLE_REGLAGE = "claudeCode.claudeProcessWrapper";

/** Les noms de dossier de réglages des éditeurs pris en charge (ordinateur de bureau). */
export const PRODUITS = ["Code", "Code - Insiders", "Code - OSS", "VSCodium", "Cursor", "Windsurf"] as const;

/** Les dossiers que les éditeurs distants (Remote - SSH, tunnels…) posent sous le dossier personnel de la machine distante. */
export const SERVEURS = [".vscode-server", ".vscode-server-insiders", ".cursor-server", ".windsurf-server", ".vscodium-server"] as const;

/** Le dossier des extensions de chaque éditeur, sous le dossier personnel. VSCodium et Code - OSS partagent ~/.vscode-oss. */
const DOSSIER_EXTENSIONS: Record<(typeof PRODUITS)[number], string> = {
  "Code": ".vscode",
  "Code - Insiders": ".vscode-insiders",
  "Code - OSS": ".vscode-oss",
  "VSCodium": ".vscode-oss",
  "Cursor": ".cursor",
  "Windsurf": ".windsurf",
};

/** L'identifiant de Twinseat : le dossier de son installation s'appelle `alexdmrx.twinseat-<version>`. */
export const ID_EXTENSION = "alexdmrx.twinseat";

// settings.json est du JSON avec commentaires et virgules finales.
const OPTIONS: ParseOptions = { allowTrailingComma: true, disallowComments: false, allowEmptyContent: false };

// --- Le cœur : texte → nouveau texte -----------------------------------------------------------

function commentaires(texte: string): string[] {
  const s = createScanner(texte, false);
  const trouves: string[] = [];
  for (let k = s.scan(); k !== SyntaxKind.EOF; k = s.scan()) {
    if (k === SyntaxKind.LineCommentTrivia || k === SyntaxKind.BlockCommentTrivia) {
      trouves.push(texte.slice(s.getTokenOffset(), s.getTokenOffset() + s.getTokenLength()));
    }
  }
  return trouves;
}

/** Le premier jeton qui compte (ni espace, ni saut de ligne, ni commentaire) à partir de `depuis`. */
function prochainJeton(texte: string, depuis: number): { kind: SyntaxKind; offset: number } | undefined {
  const s = createScanner(texte, false);
  s.setPosition(depuis);
  for (;;) {
    const k = s.scan();
    if (k === SyntaxKind.Trivia || k === SyntaxKind.LineBreakTrivia || k === SyntaxKind.LineCommentTrivia || k === SyntaxKind.BlockCommentTrivia) continue;
    return k === SyntaxKind.EOF ? undefined : { kind: k, offset: s.getTokenOffset() };
  }
}

const horizontal = (c: string | undefined): boolean => c === " " || c === "\t";
const finDeLigne = (c: string | undefined): boolean => c === undefined || c === "\n" || c === "\r";

/**
 * Les modifications qui retirent UNE propriété. Elles ne touchent qu'à la propriété, à sa virgule
 * (ou à celle de la propriété d'avant, si elle est la dernière sans virgule) et, quand elle occupe
 * seule sa ligne, à la ligne entière. Les commentaires, même voisins, restent : `modify` de
 * jsonc-parser, lui, emporte avec la propriété les commentaires qui l'entourent.
 */
function retraits(texte: string, proprietes: Node[], cible: Node): Edit[] {
  const edits: Edit[] = [];
  const idx = proprietes.indexOf(cible);
  const finValeur = cible.offset + cible.length;
  let fin = finValeur;
  const apres = prochainJeton(texte, finValeur);
  if (apres?.kind === SyntaxKind.CommaToken) {
    fin = apres.offset + 1;
  } else if (idx > 0) {
    // Dernière propriété sans virgule : la virgule de la précédente doit partir avec elle.
    const prec = proprietes[idx - 1];
    const v = prochainJeton(texte, prec.offset + prec.length);
    if (v?.kind === SyntaxKind.CommaToken) edits.push({ offset: v.offset, length: 1, content: "" });
  }
  let debutLigne = cible.offset;
  while (debutLigne > 0 && horizontal(texte[debutLigne - 1])) debutLigne--;
  let finBlancs = fin;
  while (horizontal(texte[finBlancs])) finBlancs++;
  if ((debutLigne === 0 || finDeLigne(texte[debutLigne - 1])) && finDeLigne(texte[finBlancs])) {
    // Seule sur sa ligne : la ligne entière part, saut de ligne compris.
    const saut = texte[finBlancs] === "\r" && texte[finBlancs + 1] === "\n" ? 2 : texte[finBlancs] === undefined ? 0 : 1;
    edits.push({ offset: debutLigne, length: finBlancs + saut - debutLigne, content: "" });
  } else {
    // Avec autre chose sur la ligne (un commentaire, une autre propriété) : la propriété seule.
    edits.push({ offset: cible.offset, length: finBlancs - cible.offset, content: "" });
  }
  return edits;
}

/**
 * Le texte de settings.json sans notre lanceur, ou `null` quand il n'y a rien à changer : texte
 * invalide, racine qui n'est pas un objet, réglage absent ou en double, valeur qui n'est pas
 * exactement `lanceur`. Un résultat qui ne se relirait pas comme l'original moins ce réglage, ou
 * qui aurait perdu un commentaire, est refusé (`null`) : mieux vaut ne rien faire qu'abîmer le fichier.
 */
export function retirerLanceur(texte: string, lanceur: string): string | null {
  const bom = texte.startsWith("﻿") ? "﻿" : "";
  const t = bom ? texte.slice(1) : texte;
  const erreurs: ParseError[] = [];
  const racine = parseTree(t, erreurs, OPTIONS);
  if (erreurs.length || !racine || racine.type !== "object") return null;
  const proprietes = (racine.children ?? []).filter((n) => n.type === "property");
  const cibles = proprietes.filter((p) => p.children?.[0]?.value === CLE_REGLAGE);
  if (cibles.length !== 1) return null; // absent, ou en double : on ne devine pas lequel est le bon
  const valeur = cibles[0].children?.[1];
  if (valeur?.type !== "string" || valeur.value !== lanceur) return null;

  const apres = applyEdits(t, retraits(t, proprietes, cibles[0]));

  const erreursApres: ParseError[] = [];
  const objetApres: unknown = parse(apres, erreursApres, OPTIONS);
  const attendu = parse(t, [], OPTIONS) as Record<string, unknown>;
  delete attendu[CLE_REGLAGE];
  if (erreursApres.length || !isDeepStrictEqual(objetApres, attendu)) return null;
  if (!isDeepStrictEqual(commentaires(apres), commentaires(t))) return null;
  return bom + apres;
}

// --- Les fichiers --------------------------------------------------------------------------------

export interface EntreesDesinstallation {
  home: string;
  /** `process.platform` : seuls « darwin » et « linux » ont des éditeurs connus. */
  plateforme: string;
  /** XDG_CONFIG_HOME (Linux), ou null. Ignoré s'il n'est pas un chemin absolu. */
  xdg?: string | null;
  /**
   * Le dossier de l'installation de Twinseat qui lance ce script (…/extensions/alexdmrx.twinseat-<version>).
   * VS Code lance le script depuis le dossier de l'installation qu'on désinstalle : ce dossier ne prouve donc
   * pas que Twinseat est encore là, et il est ignoré. Sans lui (essais), tout dossier d'installation compte.
   */
  dossierExtension?: string | null;
}

/** Un éditeur : où sont ses réglages, et où sont ses extensions. */
export interface Editeur {
  nom: string;
  /** Les dossiers qui contiennent un settings.json : `User` (avec ses profils) ; `Machine` aussi pour un serveur. */
  reglages: string[];
  /** Le dossier des extensions installées. */
  extensions: string;
}

/**
 * Les éditeurs connus : ~/Library/Application Support/<éditeur>/User (macOS) ou ~/.config/<éditeur>/User (Linux),
 * et, sur les deux systèmes, les dossiers de serveur distant (~/.vscode-server/data/Machine et /User…).
 * Une autre plateforme n'en a aucun.
 */
export function editeurs(e: EntreesDesinstallation): Editeur[] {
  if (e.plateforme !== "darwin" && e.plateforme !== "linux") return [];
  const racines = new Set<string>();
  if (e.plateforme === "darwin") racines.add(path.join(e.home, "Library", "Application Support"));
  if (e.plateforme === "linux") {
    racines.add(path.join(e.home, ".config"));
    if (e.xdg && path.isAbsolute(e.xdg)) racines.add(path.resolve(e.xdg));
  }
  const bureau = [...racines].flatMap((r) =>
    PRODUITS.map((p): Editeur => ({ nom: p, reglages: [path.join(r, p, "User")], extensions: path.join(e.home, DOSSIER_EXTENSIONS[p], "extensions") })),
  );
  const serveurs = SERVEURS.map(
    (s): Editeur => ({
      nom: s,
      reglages: [path.join(e.home, s, "data", "Machine"), path.join(e.home, s, "data", "User")],
      extensions: path.join(e.home, s, "extensions"),
    }),
  );
  return [...bureau, ...serveurs];
}

/** Les settings.json des éditeurs connus (le profil par défaut ; Machine et User pour un serveur). */
export function fichiersReglages(e: EntreesDesinstallation): string[] {
  return editeurs(e).flatMap((ed) => ed.reglages.map((d) => path.join(d, "settings.json")));
}

// --- Twinseat est-il encore installé quelque part ? ----------------------------------------------

/** Les dossiers d'extensions que VS Code a marqués supprimés (fichier .obsolete : { "<dossier>": true }). */
function marquesSupprimes(dossierExtensions: string): Set<string> {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(path.join(dossierExtensions, ".obsolete"), "utf8"));
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return new Set(Object.entries(v).filter(([, x]) => x === true).map(([nom]) => nom));
    }
  } catch {
    /* pas de fichier, ou illisible : rien n'est marqué */
  }
  return new Set();
}

function memeDossier(a: string, b: string): boolean {
  try {
    return fs.realpathSync(a) === fs.realpathSync(b);
  } catch {
    return path.resolve(a) === path.resolve(b);
  }
}

/**
 * Ce dossier d'extensions contient-il une installation de Twinseat (`alexdmrx.twinseat-*`, un dossier ou un
 * lien vers un dossier), autre que `moi` (celle qui lance ce script) et que celles que VS Code a marquées
 * supprimées ? Un dossier absent : non. Un dossier qu'on ne peut pas lire : oui (dans le doute, on ne touche à rien).
 */
export function twinseatInstalle(dossierExtensions: string, moi?: string | null): boolean {
  let noms: string[];
  try {
    noms = fs.readdirSync(dossierExtensions);
  } catch (err) {
    return !["ENOENT", "ENOTDIR"].includes(codeErreur(err));
  }
  const supprimes = marquesSupprimes(dossierExtensions);
  return noms.some((nom) => {
    if (!nom.toLowerCase().startsWith(`${ID_EXTENSION}-`) || supprimes.has(nom)) return false;
    const chemin = path.join(dossierExtensions, nom);
    try {
      if (!fs.statSync(chemin).isDirectory()) return false;
    } catch {
      return false;
    }
    return !(moi && memeDossier(chemin, moi));
  });
}

/** Les settings.json des profils d'un éditeur (User/profiles/<id>/settings.json) : le réglage global d'un profil y est écrit. */
function fichiersProfils(dossierUtilisateur: string): string[] {
  try {
    return fs
      .readdirSync(path.join(dossierUtilisateur, "profiles"), { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dossierUtilisateur, "profiles", d.name, "settings.json"));
  } catch {
    return [];
  }
}

/**
 * retire : le lanceur est parti ; inchange : rien à changer ; absent : pas de fichier ; illisible : pas un fichier lisible ;
 * ecriture : écriture impossible, fichier intact ; installee : Twinseat est encore installé dans cet éditeur, fichier intact ;
 * abstention : le fichier ne se réécrit pas sans risque (octets non UTF-8, lecture seule, liens physiques), fichier intact.
 */
export type Issue = "retire" | "inchange" | "absent" | "illisible" | "ecriture" | "installee" | "abstention";
export interface ResultatFichier {
  fichier: string;
  issue: Issue;
}

const codeErreur = (e: unknown): string => String((e as NodeJS.ErrnoException)?.code ?? "error");

/**
 * Retire le lanceur d'un fichier de réglages. Écriture atomique (fichier temporaire à côté, puis
 * renommage), droits conservés ; un lien (dotfiles) reste un lien, c'est sa cible qui est mise à jour.
 * Si le fichier change pendant ce temps, rien n'est écrit. Abstention (fichier intact) quand le fichier
 * ne se réécrit pas sans risque : octets qui ne sont pas de l'UTF-8 valide (la relecture en texte les
 * changerait), pas modifiable par son propriétaire, ou plusieurs liens physiques (le renommage les séparerait).
 */
function nettoyerFichier(fichier: string, lanceur: string, log: (m: string) => void): Issue {
  let reel: string;
  try {
    reel = fs.realpathSync(fichier);
  } catch (e) {
    return ["ENOENT", "ENOTDIR"].includes(codeErreur(e)) ? "absent" : "illisible";
  }
  let brut: Buffer;
  let st: fs.Stats;
  try {
    st = fs.statSync(reel);
    if (!st.isFile()) return "illisible";
    brut = fs.readFileSync(reel);
  } catch {
    return "illisible";
  }
  const mode = st.mode & 0o777;
  const texte = brut.toString("utf8");
  const nouveau = retirerLanceur(texte, lanceur);
  if (nouveau === null) return "inchange";
  // Il y a quelque chose à retirer ; est-ce sans risque ?
  if (!Buffer.from(texte, "utf8").equals(brut)) {
    log(`${fichier} is not valid UTF-8: left as it was`);
    return "abstention";
  }
  if (!(st.mode & 0o200)) {
    log(`${fichier} is not writable by its owner: left as it was`);
    return "abstention";
  }
  if (st.nlink > 1) {
    log(`${fichier} has several hard links: left as it was`);
    return "abstention";
  }

  const tmp = path.join(path.dirname(reel), `.${path.basename(reel)}.${process.pid}.twinseat.tmp`);
  try {
    fs.writeFileSync(tmp, nouveau, { mode, flag: "wx" });
    fs.chmodSync(tmp, mode);
    if (!fs.readFileSync(reel).equals(brut)) throw Object.assign(new Error("changed meanwhile"), { code: "ECHANGE" });
    fs.renameSync(tmp, reel);
    return "retire";
  } catch (e) {
    log(`could not update ${fichier} (${codeErreur(e)}): left as it was`);
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* rien de plus à faire */
    }
    return "ecriture";
  }
}

/** Nettoie tous les réglages utilisateur connus. Ne lève jamais. */
export function desinstaller(e: EntreesDesinstallation, log: (m: string) => void = () => undefined): ResultatFichier[] {
  const lanceur = cheminLanceur(e.home);
  const resultats: ResultatFichier[] = [];
  for (const editeur of editeurs(e)) {
    const fichiers = editeur.reglages.flatMap((d) => [path.join(d, "settings.json"), ...fichiersProfils(d)]);
    // Twinseat est encore installé dans cet éditeur : ses réglages gardent le lanceur.
    let installe = false;
    try {
      installe = twinseatInstalle(editeur.extensions, e.dossierExtension);
    } catch {
      installe = true; // dans le doute, on ne touche à rien
    }
    let signale = false;
    for (const fichier of fichiers) {
      let issue: Issue;
      try {
        if (installe && fs.existsSync(fichier)) {
          if (!signale) log(`Twinseat is still installed in ${editeur.extensions}: the ${editeur.nom} settings are left as they are`);
          signale = true;
          issue = "installee";
        } else {
          issue = nettoyerFichier(fichier, lanceur, log);
        }
      } catch (err) {
        log(`could not process ${fichier} (${codeErreur(err)})`);
        issue = "illisible";
      }
      if (issue === "retire") log(`removed the launcher setting from ${fichier}`);
      resultats.push({ fichier, issue });
    }
  }
  return resultats;
}

function executer(): void {
  const ecrire = (m: string): void => {
    process.stderr.write(`Twinseat: ${m}\n`);
  };
  try {
    // out/desinstallation.js : le dossier de l'installation est le parent du dossier out.
    const dossierExtension = path.resolve(__dirname, "..");
    desinstaller({ home: os.homedir(), plateforme: process.platform, xdg: process.env.XDG_CONFIG_HOME || null, dossierExtension }, ecrire);
  } catch (e) {
    ecrire(`uninstall cleanup failed (${codeErreur(e)})`);
  }
}

// Lancé par VS Code (`node ./out/desinstallation.js`) : on agit. Importé (par les essais) : rien ne se passe.
if (require.main === module) executer();

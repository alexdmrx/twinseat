// Désinstallation propre. VS Code lance `node ./out/desinstallation.js` (scripts.vscode:uninstall
// du package.json) une fois l'extension désinstallée, en Node simple : AUCUNE API vscode ici, et
// pas plus d'imports que node, jsonc-parser (livré dans le .vsix) et ./chemins.
//
// Ce qu'il fait : dans les réglages utilisateur des éditeurs fondés sur VS Code (Code, Code -
// Insiders, VSCodium, Cursor, Windsurf, y compris leurs profils), retire
// `claudeCode.claudeProcessWrapper` SEULEMENT si sa valeur est exactement le lanceur de Twinseat
// (~/.claude/comptes/bin/lanceur, développé). Toute autre valeur, un fichier absent, illisible ou
// invalide : rien ne bouge. Le reste du fichier (commentaires, mise en forme, autres réglages) est
// gardé octet pour octet. Ne lève jamais : seul stderr reçoit des lignes de journal, techniques et
// en anglais (ce n'est pas l'interface de l'extension).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { applyEdits, createScanner, Edit, Node, parse, parseTree, ParseError, ParseOptions, SyntaxKind } from "jsonc-parser";
import { cheminLanceur } from "./chemins";

/** Le réglage de Claude Code qui désigne le lanceur, tel qu'écrit dans settings.json. */
export const CLE_REGLAGE = "claudeCode.claudeProcessWrapper";

/** Les noms de dossier de réglages des éditeurs pris en charge. */
export const PRODUITS = ["Code", "Code - Insiders", "VSCodium", "Cursor", "Windsurf"] as const;

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
}

/** Les dossiers `User` des éditeurs connus : ~/Library/Application Support/<éditeur>/User (macOS), ~/.config/<éditeur>/User (Linux). */
export function dossiersUtilisateur(e: EntreesDesinstallation): string[] {
  const racines = new Set<string>();
  if (e.plateforme === "darwin") racines.add(path.join(e.home, "Library", "Application Support"));
  if (e.plateforme === "linux") {
    racines.add(path.join(e.home, ".config"));
    if (e.xdg && path.isAbsolute(e.xdg)) racines.add(path.resolve(e.xdg));
  }
  return [...racines].flatMap((r) => PRODUITS.map((p) => path.join(r, p, "User")));
}

/** Les settings.json des éditeurs connus (le profil par défaut). */
export function fichiersReglages(e: EntreesDesinstallation): string[] {
  return dossiersUtilisateur(e).map((d) => path.join(d, "settings.json"));
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

/** retire : le lanceur est parti ; inchange : rien à changer ; absent : pas de fichier ; illisible : pas un fichier lisible ; ecriture : écriture impossible, fichier intact. */
export type Issue = "retire" | "inchange" | "absent" | "illisible" | "ecriture";
export interface ResultatFichier {
  fichier: string;
  issue: Issue;
}

const codeErreur = (e: unknown): string => String((e as NodeJS.ErrnoException)?.code ?? "error");

/**
 * Retire le lanceur d'un fichier de réglages. Écriture atomique (fichier temporaire à côté, puis
 * renommage), droits conservés ; un lien (dotfiles) reste un lien, c'est sa cible qui est mise à jour.
 * Si le fichier change pendant ce temps, rien n'est écrit.
 */
function nettoyerFichier(fichier: string, lanceur: string, log: (m: string) => void): Issue {
  let reel: string;
  try {
    reel = fs.realpathSync(fichier);
  } catch (e) {
    return ["ENOENT", "ENOTDIR"].includes(codeErreur(e)) ? "absent" : "illisible";
  }
  let texte: string;
  let mode: number;
  try {
    const st = fs.statSync(reel);
    if (!st.isFile()) return "illisible";
    mode = st.mode & 0o777;
    texte = fs.readFileSync(reel, "utf8");
  } catch {
    return "illisible";
  }
  const nouveau = retirerLanceur(texte, lanceur);
  if (nouveau === null) return "inchange";

  const tmp = path.join(path.dirname(reel), `.${path.basename(reel)}.${process.pid}.twinseat.tmp`);
  try {
    fs.writeFileSync(tmp, nouveau, { mode, flag: "wx" });
    fs.chmodSync(tmp, mode);
    if (fs.readFileSync(reel, "utf8") !== texte) throw Object.assign(new Error("changed meanwhile"), { code: "ECHANGE" });
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
  for (const dossier of dossiersUtilisateur(e)) {
    for (const fichier of [path.join(dossier, "settings.json"), ...fichiersProfils(dossier)]) {
      let issue: Issue;
      try {
        issue = nettoyerFichier(fichier, lanceur, log);
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
    desinstaller({ home: os.homedir(), plateforme: process.platform, xdg: process.env.XDG_CONFIG_HOME || null }, ecrire);
  } catch (e) {
    ecrire(`uninstall cleanup failed (${codeErreur(e)})`);
  }
}

// Lancé par VS Code (`node ./out/desinstallation.js`) : on agit. Importé (par les essais) : rien ne se passe.
if (require.main === module) executer();

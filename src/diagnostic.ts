// Vérification et réparation de l'installation (commande « Check and Repair Setup »), et rapport
// de diagnostic à copier (commande « Copy Diagnostics »). Sans vscode : tout ce que VS Code sait
// (versions, réglage du lanceur) arrive par `EntreesDiagnostic`, et le dossier personnel, la
// plateforme et le lanceur livré sont injectés : testable avec node seul.
//
// Règles de la réparation :
// - elle ne répare que ce qui est marqué `reparable` : un lanceur absent, périmé ou non exécutable
//   (copie atomique), des dossiers ou des liens manquants (l'installateur, idempotent), des droits
//   de .claude.json (chmod 600) ;
// - elle ne supprime rien et n'écrase jamais un vrai fichier ou dossier : un vrai fichier à la place
//   d'un lien, un lien qui pointe ailleurs, un dossier à la place d'un fichier sont signalés comme
//   conflits et laissés tels quels ;
// - le réglage du lanceur dans VS Code (le nôtre, aucun, ou celui d'un autre programme) est
//   constaté, jamais modifié.
//
// Le rapport à copier ne contient ni adresse e-mail, ni nom de compte, ni titre ou numéro de
// conversation, ni jeton ; le dossier personnel y est écrit « ~ ». Il est toujours en anglais :
// il est fait pour être collé dans un ticket.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { base, cheminLanceur, Compte, COMPTES, dossierCompte, sousDossier } from "./chemins";
import { copierLanceur, DOSSIERS_PARTAGES, FICHIERS_PARTAGES, infosCompte, installer } from "./installation";
import { plateformeSupportee } from "./plateforme";
import { Cle, Langue, langue as langueCourante, traduire, Variables } from "./textes";

/** Identifiant de l'extension Claude Code dans VS Code. */
export const ID_EXTENSION_CLAUDE = "anthropic.claude-code";

export type Statut = "ok" | "warn" | "fail";

export interface Verification {
  /** « plateforme », « claude », « lanceur », « reglage », « compte.A.dossier »…, « registre ». */
  id: string;
  statut: Statut;
  /** Vrai seulement si `reparer` sait le corriger sans rien supprimer ni écraser. */
  reparable: boolean;
  /** Nom court de la vérification, dans la langue demandée. */
  nom: string;
  /** Ce qui a été constaté, dans la langue demandée. Jamais d'adresse, de nom de compte ni de jeton. */
  detail: string;
}

export interface EntreesDiagnostic {
  home: string;
  /** `process.platform` (« darwin », « linux »…). */
  plateforme: string;
  arch: string;
  /** `os.release()` : le numéro du noyau. */
  versionSysteme?: string;
  /** resources/lanceur.sh, livré avec l'extension. */
  lanceurInclus: string;
  /** Dossier de l'extension Claude Code, s'il est installé. */
  dossierExtensionClaude?: string;
  /** Valeur globale du réglage claudeCode.claudeProcessWrapper (instantané des réglages). */
  reglageLanceur?: string;
  versions: { twinseat: string; vscode: string; claudeCode?: string };
  /** Langue des textes de `verifier` ; la langue courante par défaut. Le rapport, lui, est toujours en anglais. */
  langue?: Langue;
}

// --- Petits outils ----------------------------------------------------------------------------

const lstatOuRien = (p: string): fs.Stats | undefined => {
  try {
    return fs.lstatSync(p);
  } catch {
    return undefined;
  }
};
const statOuRien = (p: string): fs.Stats | undefined => {
  try {
    return fs.statSync(p);
  } catch {
    return undefined;
  }
};
const sha256 = (b: Buffer): string => crypto.createHash("sha256").update(b).digest("hex");
const codeErreur = (e: unknown): string => String((e as NodeJS.ErrnoException)?.code ?? "error");
const nomSysteme = (plateforme: string): string => (plateforme === "darwin" ? "macOS" : plateforme === "linux" ? "Linux" : plateforme);
const liste = (noms: Iterable<string>): string => {
  const tous = [...noms];
  return tous.slice(0, 6).join(", ") + (tous.length > 6 ? ", …" : "");
};

/** « ~/.claude/… » : le dossier personnel écrit « ~ » (sur une frontière de nom, jamais au milieu d'un autre). */
function court(p: string, home: string): string {
  const h = home.replace(/\/+$/, "");
  if (h.length > 1 && (p === h || p.startsWith(`${h}/`))) return `~${p.slice(h.length)}`;
  return p;
}

// --- Nettoyage du rapport ---------------------------------------------------------------------

const MOTIF_EMAIL = /[^\s@<>()[\]"'`,;]+@[^\s@<>()[\]"'`,;]+/g;
const MOTIF_NUMERO = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

function dossiersPersonnels(home: string): string[] {
  const noms = new Set<string>();
  const h = home.replace(/\/+$/, "");
  if (h.length > 1) {
    noms.add(h);
    try {
      noms.add(fs.realpathSync(h));
    } catch {
      /* dossier absent : seul le nom donné compte */
    }
  }
  return [...noms].filter((n) => n.length > 1).sort((a, b) => b.length - a.length);
}

/**
 * Dernière barrière du rapport : même si un texte laissait passer une donnée personnelle, elle n'en
 * sort pas. Le dossier personnel devient « ~ », une adresse e-mail et un numéro de conversation
 * disparaissent, et aucun « @ » ne reste. Les vérifications n'écrivent déjà rien de tout cela.
 */
export function anonymiser(texte: string, home: string): string {
  let s = texte;
  for (const h of dossiersPersonnels(home)) {
    s = s.replace(new RegExp(`${h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9._-])`, "g"), "~");
  }
  return s.replace(MOTIF_EMAIL, "…").replace(MOTIF_NUMERO, "…").replace(/@/g, "(at)");
}

// --- Les vérifications ------------------------------------------------------------------------

/** Le programme claude : celui de l'extension Claude Code, sinon ~/.local/bin/claude. */
export function trouverBinaireClaude(
  dossierExtension: string | undefined,
  home: string,
  existe: (chemin: string) => boolean = fs.existsSync,
): string | undefined {
  const candidats = [
    dossierExtension ? path.join(dossierExtension, "resources", "native-binary", "claude") : undefined,
    path.join(home, ".local", "bin", "claude"),
  ];
  return candidats.find((c): c is string => Boolean(c) && existe(c as string));
}

export type EtatReglage = "notre" | "aucun" | "autre";

/** Le réglage claudeCode.claudeProcessWrapper : notre lanceur, rien, ou celui d'un autre programme. */
export function etatReglage(valeur: string | undefined, home: string): EtatReglage {
  if (!valeur) return "aucun";
  return valeur === cheminLanceur(home) ? "notre" : "autre";
}

interface Contexte {
  e: EntreesDiagnostic;
  l: Langue;
  tr: (cle: Cle, variables?: Variables) => string;
  court: (p: string) => string;
}

/** Nom court d'une vérification (« Launcher », « Account A: folder »…). */
export function nomVerification(id: string, l: Langue = langueCourante()): string {
  const m = /^compte\.([AB])\.(\w+)$/.exec(id);
  return traduire(l, `diag.nom.${m ? m[2] : id}` as Cle, m ? { compte: m[1] } : undefined);
}

function fait(c: Contexte, id: string, statut: Statut, reparable: boolean, detail: string): Verification {
  return { id, statut, reparable, nom: nomVerification(id, c.l), detail };
}

function verifierPlateforme(c: Contexte): Verification {
  const systeme = nomSysteme(c.e.plateforme);
  return plateformeSupportee(c.e.plateforme)
    ? fait(c, "plateforme", "ok", false, c.tr("diag.plateforme.ok", { systeme, arch: c.e.arch }))
    : fait(c, "plateforme", "fail", false, c.tr("diag.plateforme.non", { systeme }));
}

function verifierClaude(c: Contexte): Verification {
  return trouverBinaireClaude(c.e.dossierExtensionClaude, c.e.home)
    ? fait(c, "claude", "ok", false, c.tr("diag.claude.trouve"))
    : fait(c, "claude", "warn", false, c.tr("diag.claude.absent"));
}

function verifierLanceur(c: Contexte): Verification {
  const dest = cheminLanceur(c.e.home);
  const chemin = c.court(dest);
  let source: Buffer;
  try {
    source = fs.readFileSync(c.e.lanceurInclus);
  } catch {
    return fait(c, "lanceur", "fail", false, c.tr("diag.lanceur.source"));
  }
  const st = lstatOuRien(dest);
  if (!st) return fait(c, "lanceur", "fail", true, c.tr("diag.lanceur.absent", { chemin }));
  let actuel: Buffer | undefined;
  if (st.isFile()) {
    try {
      actuel = fs.readFileSync(dest);
    } catch {
      actuel = undefined;
    }
  }
  // Un dossier, un lien, un fichier illisible : pas à nous de le remplacer.
  if (!actuel) return fait(c, "lanceur", "fail", false, c.tr("diag.lanceur.autre", { chemin }));
  let executable = true;
  try {
    fs.accessSync(dest, fs.constants.X_OK);
  } catch {
    executable = false;
  }
  if (!executable) return fait(c, "lanceur", "fail", true, c.tr("diag.lanceur.droits", { chemin }));
  if (sha256(actuel) !== sha256(source)) return fait(c, "lanceur", "warn", true, c.tr("diag.lanceur.different"));
  return fait(c, "lanceur", "ok", false, c.tr("diag.lanceur.ok"));
}

function verifierReglage(c: Contexte): Verification {
  const etat = etatReglage(c.e.reglageLanceur, c.e.home);
  // Jamais « réparé » : le réglage d'un autre programme n'est pas à nous, et activer Twinseat est un choix.
  if (etat === "notre") return fait(c, "reglage", "ok", false, c.tr("diag.reglage.notre"));
  return fait(c, "reglage", "warn", false, c.tr(etat === "aucun" ? "diag.reglage.aucun" : "diag.reglage.autre"));
}

function verifierDossier(c: Contexte, compte: Compte): Verification {
  const id = `compte.${compte}.dossier`;
  const d = dossierCompte(compte, c.e.home);
  const chemin = c.court(d);
  const l = lstatOuRien(d);
  if (!l) return fait(c, id, "fail", true, c.tr("diag.dossier.absent", { chemin }));
  // Un lien vers un dossier (gestionnaire de dotfiles) convient.
  const s = l.isSymbolicLink() ? statOuRien(d) : l;
  if (!s?.isDirectory()) return fait(c, id, "fail", false, c.tr("diag.dossier.autre", { chemin }));
  return fait(c, id, "ok", false, c.tr("diag.dossier.ok", { chemin }));
}

function verifierFiche(c: Contexte, compte: Compte): Verification {
  const id = `compte.${compte}.fiche`;
  const st = lstatOuRien(path.join(dossierCompte(compte, c.e.home), ".claude.json"));
  if (!st) return fait(c, id, "warn", false, c.tr("diag.fiche.absente"));
  // Un lien : chmod suivrait le lien et changerait les droits d'un autre fichier. On n'y touche pas.
  if (!st.isFile()) return fait(c, id, "fail", false, c.tr("diag.fiche.autre"));
  const mode = st.mode & 0o777;
  if (mode !== 0o600) return fait(c, id, "warn", true, c.tr("diag.fiche.droits", { mode: mode.toString(8) }));
  return fait(c, id, "ok", false, c.tr("diag.fiche.ok"));
}

function verifierConnecte(c: Contexte, compte: Compte): Verification {
  const id = `compte.${compte}.connecte`;
  // Un booléen, rien d'autre : l'adresse que `infosCompte` sait lire n'est pas utilisée ici.
  return infosCompte(compte, c.e.home).connecte
    ? fait(c, id, "ok", false, c.tr("diag.connecte.oui"))
    : fait(c, id, "warn", false, c.tr("diag.connecte.non"));
}

function verifierLiens(c: Contexte, compte: Compte): Verification {
  const id = `compte.${compte}.liens`;
  const dc = dossierCompte(compte, c.e.home);
  const b = base(c.e.home);
  const tous = [...FICHIERS_PARTAGES, ...DOSSIERS_PARTAGES];

  // Un dossier de compte absent se recrée avec ses liens ; autre chose qu'un dossier, on n'y touche pas.
  if (lstatOuRien(dc) && !statOuRien(dc)?.isDirectory()) return fait(c, id, "warn", false, c.tr("diag.liens.dossier"));

  const manquants: string[] = [];
  const conflits = new Set<string>();
  const cibles: string[] = [];
  for (const nom of tous) {
    const lien = path.join(dc, nom);
    const st = lstatOuRien(lien);
    if (!st) manquants.push(nom);
    else if (!st.isSymbolicLink() || fs.readlinkSync(lien) !== path.join(b, nom)) conflits.add(nom);
  }
  // Un lien vers un dossier commun disparu ferait échouer les écritures de Claude : l'installateur le recrée.
  for (const nom of DOSSIERS_PARTAGES) {
    const s = statOuRien(path.join(b, nom));
    if (!s) cibles.push(nom);
    else if (!s.isDirectory()) conflits.add(nom);
  }
  if (!manquants.length && !cibles.length && !conflits.size) return fait(c, id, "ok", false, c.tr("diag.liens.ok", { n: tous.length }));
  const parties: string[] = [];
  if (manquants.length) parties.push(c.tr("diag.liens.manquants", { n: manquants.length, liste: liste(manquants) }));
  if (cibles.length) parties.push(c.tr("diag.liens.cibles", { n: cibles.length, liste: liste(cibles) }));
  if (conflits.size) parties.push(c.tr("diag.liens.conflits", { n: conflits.size, liste: liste(conflits) }));
  return fait(c, id, "warn", manquants.length + cibles.length > 0, parties.join(" "));
}

function verifierRegistre(c: Contexte): Verification {
  const d = sousDossier.registre(c.e.home);
  const chemin = c.court(d);
  const l = lstatOuRien(d);
  if (!l) return fait(c, "registre", "fail", true, c.tr("diag.registre.absent", { chemin }));
  const s = l.isSymbolicLink() ? statOuRien(d) : l;
  if (!s?.isDirectory()) return fait(c, "registre", "fail", false, c.tr("diag.registre.autre", { chemin }));
  try {
    fs.accessSync(d, fs.constants.W_OK);
  } catch {
    return fait(c, "registre", "fail", false, c.tr("diag.registre.ecriture", { chemin }));
  }
  return fait(c, "registre", "ok", false, c.tr("diag.registre.ok", { chemin }));
}

/**
 * Toutes les vérifications, dans l'ordre. Ne modifie rien et ne lève jamais : une vérification qui
 * ne peut pas s'exécuter devient un constat « fail ». Sur une plateforme non prise en charge, la
 * seule vérification est la plateforme (le reste ne s'applique pas).
 */
export function verifier(e: EntreesDiagnostic): Verification[] {
  const l = e.langue ?? langueCourante();
  const c: Contexte = { e, l, tr: (cle, variables) => traduire(l, cle, variables), court: (p) => court(p, e.home) };
  const proteger = (id: string, f: () => Verification): Verification => {
    try {
      return f();
    } catch (err) {
      return fait(c, id, "fail", false, c.tr("diag.erreur", { code: codeErreur(err) }));
    }
  };
  const plateforme = proteger("plateforme", () => verifierPlateforme(c));
  if (!plateformeSupportee(e.plateforme)) return [plateforme];
  return [
    plateforme,
    proteger("claude", () => verifierClaude(c)),
    proteger("lanceur", () => verifierLanceur(c)),
    proteger("reglage", () => verifierReglage(c)),
    ...COMPTES.flatMap((compte) => [
      proteger(`compte.${compte}.dossier`, () => verifierDossier(c, compte)),
      proteger(`compte.${compte}.fiche`, () => verifierFiche(c, compte)),
      proteger(`compte.${compte}.connecte`, () => verifierConnecte(c, compte)),
      proteger(`compte.${compte}.liens`, () => verifierLiens(c, compte)),
    ]),
    proteger("registre", () => verifierRegistre(c)),
  ];
}

export const reparables = (verifs: readonly Verification[]): Verification[] => verifs.filter((v) => v.reparable);

export interface Bilan {
  ok: number;
  warn: number;
  fail: number;
  reparables: number;
}

export function bilan(verifs: readonly Verification[]): Bilan {
  const n = (s: Statut) => verifs.filter((v) => v.statut === s).length;
  return { ok: n("ok"), warn: n("warn"), fail: n("fail"), reparables: reparables(verifs).length };
}

const GLYPHES: Record<Statut, string> = { ok: "✔", warn: "⚠", fail: "✘" };

/** Une ligne par vérification : « ⚠ Account A: .claude.json — Present, but mode 644… [can be repaired] ». */
export function resumeTexte(verifs: readonly Verification[], l: Langue = langueCourante()): string {
  return verifs
    .map((v) => `${GLYPHES[v.statut]} ${v.nom} — ${v.detail}${v.reparable ? ` [${traduire(l, "diag.reparable")}]` : ""}`)
    .join("\n");
}

// --- La réparation ----------------------------------------------------------------------------

export type ActionReparation = "lanceur" | "installation" | `droits-${Compte}`;

export interface ResultatReparation {
  /** Ce qui a été fait. */
  actions: ActionReparation[];
  /** Ce qui a échoué (code d'erreur système seulement). */
  erreurs: { action: ActionReparation; code: string }[];
  /** Les vérifications refaites après la réparation. */
  apres: Verification[];
}

/**
 * Répare ce qui est `reparable`, rien d'autre, puis refait les vérifications. Ne supprime rien,
 * n'écrase jamais un vrai fichier ou dossier, ne touche jamais au réglage de VS Code. Ne lève jamais.
 */
export function reparer(e: EntreesDiagnostic): ResultatReparation {
  const aFaire = new Set(reparables(verifier(e)).map((v) => v.id));
  const actions: ActionReparation[] = [];
  const erreurs: ResultatReparation["erreurs"] = [];
  const essayer = (action: ActionReparation, f: () => boolean | void): void => {
    try {
      if (f() !== false) actions.push(action);
    } catch (err) {
      erreurs.push({ action, code: codeErreur(err) });
    }
  };

  // Le lanceur : la même copie atomique que l'installateur.
  if (aFaire.has("lanceur")) essayer("lanceur", () => copierLanceur(e.lanceurInclus, e.home, { crees: [], conflits: [] }));

  // Dossiers et liens manquants : l'installateur, idempotent. `lier` laisse en l'état tout ce qui
  // gêne (vrai fichier, lien ailleurs) ; le lanceur a déjà été traité ci-dessus.
  const installation = [...aFaire].some((id) => /^compte\.[AB]\.(dossier|liens)$/.test(id) || id === "registre");
  if (installation) essayer("installation", () => void installer(e.lanceurInclus, e.home, { lanceur: false }));

  // Droits de .claude.json, relus juste avant : seulement un fichier ordinaire (chmod suivrait un lien).
  for (const compte of COMPTES) {
    if (!aFaire.has(`compte.${compte}.fiche`)) continue;
    essayer(`droits-${compte}`, () => {
      const f = path.join(dossierCompte(compte, e.home), ".claude.json");
      if (!lstatOuRien(f)?.isFile()) return false;
      fs.chmodSync(f, 0o600);
      return true;
    });
  }
  return { actions, erreurs, apres: verifier(e) };
}

// --- Le rapport à copier ----------------------------------------------------------------------

/**
 * Rapport en Markdown, en anglais : versions, système, état du réglage du lanceur, résultat de
 * chaque vérification. Aucune adresse e-mail, aucun nom de compte, aucune conversation, aucun
 * jeton, et le dossier personnel écrit « ~ » (voir `anonymiser`, qui passe sur tout le texte).
 */
export function construireRapport(e: EntreesDiagnostic): string {
  const l: Langue = "en";
  const tr = (cle: Cle, variables?: Variables): string => traduire(l, cle, variables);
  const verifs = verifier({ ...e, langue: l });
  const b = bilan(verifs);
  const systeme = `${nomSysteme(e.plateforme)} (${e.plateforme}${e.versionSysteme ? ` ${e.versionSysteme}` : ""}), ${e.arch}`;
  const lignes = [
    `# ${tr("rapport.titre")}`,
    "",
    `- ${tr("rapport.ligne.twinseat", { valeur: e.versions.twinseat })}`,
    `- ${tr("rapport.ligne.vscode", { valeur: e.versions.vscode })}`,
    `- ${tr("rapport.ligne.claudeCode", { valeur: e.versions.claudeCode ?? tr("rapport.absente") })}`,
    `- ${tr("rapport.ligne.systeme", { valeur: systeme })}`,
    `- ${tr("rapport.ligne.reglage", { valeur: tr(`rapport.reglage.${etatReglage(e.reglageLanceur, e.home)}` as Cle) })}`,
    `- ${tr("rapport.ligne.bilan", { ok: b.ok, warn: b.warn, fail: b.fail })}`,
    "",
    `## ${tr("rapport.verifications")}`,
    "",
    ...verifs.map((v) => `- ${v.statut} · ${v.nom} — ${v.detail}${v.reparable ? ` (${tr("diag.reparable")})` : ""}`),
    "",
    `_${tr("rapport.pied")}_`,
    "",
  ];
  return anonymiser(lignes.join("\n"), e.home);
}

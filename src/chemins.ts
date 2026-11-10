// Chemins de la base commune et des comptes. Aucun import de vscode :
// ce module est testable avec node seul.
import * as os from "node:os";
import * as path from "node:path";

export type Compte = "A" | "B";
export const COMPTES: readonly Compte[] = ["A", "B"];

export function estCompte(v: unknown): v is Compte {
  return v === "A" || v === "B";
}

export function autreCompte(c: Compte): Compte {
  return c === "A" ? "B" : "A";
}

/** Base commune = le ~/.claude actuel (rien n'est déplacé). */
export function base(home = os.homedir()): string {
  return path.join(home, ".claude");
}

export function racineComptes(home = os.homedir()): string {
  return path.join(base(home), "comptes");
}

/**
 * Dossier de configuration d'un compte. La chaîne doit être EXACTEMENT celle
 * du lanceur ("$HOME/.claude/comptes/A", sans barre finale) : sur macOS, Claude Code
 * range la connexion dans le trousseau sous une empreinte de cette chaîne.
 */
export function dossierCompte(c: Compte, home = os.homedir()): string {
  return `${home}/.claude/comptes/${c}`;
}

export const sousDossier = {
  registre: (home?: string) => path.join(racineComptes(home), "registre"),
  projets: (home?: string) => path.join(racineComptes(home), "projets"),
  quotas: (home?: string) => path.join(racineComptes(home), "quotas"),
  bin: (home?: string) => path.join(racineComptes(home), "bin"),
};

export function cheminLanceur(home = os.homedir()): string {
  return path.join(sousDossier.bin(home), "lanceur");
}

/**
 * Nom de fichier du projet tel que le lanceur le calcule :
 * `printf '%s' "$PWD" | tr -c 'A-Za-z0-9' '-'` — octet par octet (UTF-8).
 */
export function cleProjetLanceur(dossier: string): string {
  const octets = Buffer.from(dossier, "utf8");
  let s = "";
  for (const o of octets) {
    const alnum = (o >= 48 && o <= 57) || (o >= 65 && o <= 90) || (o >= 97 && o <= 122);
    s += alnum ? String.fromCharCode(o) : "-";
  }
  return s;
}

/** Dossier d'historique de Claude Code pour un projet (projects/<nom>). */
export function cleProjetClaude(dossier: string): string {
  return dossier.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Un numéro de conversation, rien d'autre (jamais un chemin). */
export function estNumeroConversation(id: unknown): id is string {
  return typeof id === "string" && /^[0-9a-fA-F-]{8,64}$/.test(id);
}

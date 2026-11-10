// Mise en place de la base commune : dossiers A et B faits de LIENS vers
// ~/.claude. Idempotent, n'écrase rien, ne déplace rien. Sans vscode.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { base, COMPTES, dossierCompte, racineComptes, sousDossier, cheminLanceur } from "./chemins";

/** Fichiers partagés (lien même si la cible n'existe pas encore). */
export const FICHIERS_PARTAGES = ["settings.json", "CLAUDE.md", "history.jsonl", "launch.json"] as const;

/**
 * Dossiers partagés. Une cible absente est créée vide dans la base : un lien
 * vers un dossier inexistant ferait échouer les écritures de Claude.
 * NON partagés (propres à chaque compte, écrits par Claude) : .claude.json,
 * backups, cache, debug, ide, statsig, telemetry, stats-cache.json,
 * mcp-needs-auth-cache.json, policy-limits.json, remote-settings.json.
 */
export const DOSSIERS_PARTAGES = [
  "agents", "skills", "hooks", "commands", "output-styles", "plugins",
  "projects", "file-history", "shell-snapshots", "session-env", "sessions",
  "todos", "plans", "tasks", "teams", "paste-cache", "uploads", "downloads",
  "chrome", "security", "state",
] as const;

/**
 * Clés de ~/.claude.json recopiées dans la fiche d'un compte neuf : réglages
 * d'interface, projets autorisés, serveurs MCP personnels, et SURTOUT les
 * drapeaux de migration (sans eux, Claude rejouerait des migrations sur le
 * settings.json commun). Jamais l'identité ni les caches liés au compte.
 */
const CLES_RECOPIEES =
  /MigrationComplete$|^migrationVersion$|^unpin.*Effort$|^hasCompleted|^hasSeen|^hasShown|^hasIde|^hasReset|Dismissed$|^lastOnboardingVersion$|^lastReleaseNotesSeen$|^installMethod$|^autoUpdates|^shiftEnterKeyBindingInstalled$|^mcpServers$|^projects$|^githubRepoPaths$|^tipsHistory|^showSpinnerTree$|^claudeInChromeDefaultEnabled$|^officialMarketplaceAutoInstall/;
const CLES_INTERDITES = /^oauthAccount$|^userID$|^anonymousId$|^machineID$|[Cc]ache|^cached|^bridgeOauth/;

export function ficheDeDepart(globale: Record<string, unknown>): Record<string, unknown> {
  const fiche: Record<string, unknown> = {};
  for (const [cle, valeur] of Object.entries(globale)) {
    if (CLES_RECOPIEES.test(cle) && !CLES_INTERDITES.test(cle)) fiche[cle] = valeur;
  }
  return fiche;
}

export interface Rapport {
  crees: string[];
  conflits: string[];
}

function existe(p: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(p);
  } catch {
    return undefined;
  }
}

function lier(cible: string, lien: string, rapport: Rapport): void {
  const st = existe(lien);
  if (!st) {
    fs.symlinkSync(cible, lien);
    rapport.crees.push(lien);
    return;
  }
  if (st.isSymbolicLink()) {
    if (fs.readlinkSync(lien) !== cible) rapport.conflits.push(`${lien} → ${fs.readlinkSync(lien)}`);
    return;
  }
  // Un vrai fichier/dossier : Claude l'a créé avant le lien. On n'y touche pas.
  rapport.conflits.push(lien);
}

/**
 * Installe (ou complète) la base commune. `lanceurSource` = script à copier.
 * `options.lanceur: false` : ne touche pas au lanceur installé (la réparation le traite à part).
 */
export function installer(lanceurSource: string, home = os.homedir(), options: { lanceur?: boolean } = {}): Rapport {
  const rapport: Rapport = { crees: [], conflits: [] };
  const b = base(home);
  for (const d of [racineComptes(home), sousDossier.registre(home), sousDossier.projets(home), sousDossier.quotas(home), sousDossier.bin(home)]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (const nom of DOSSIERS_PARTAGES) fs.mkdirSync(path.join(b, nom), { recursive: true });

  const globale = lireJson(path.join(home, ".claude.json"));
  for (const c of COMPTES) {
    const dc = dossierCompte(c, home);
    fs.mkdirSync(dc, { recursive: true });
    for (const nom of [...FICHIERS_PARTAGES, ...DOSSIERS_PARTAGES]) lier(path.join(b, nom), path.join(dc, nom), rapport);
    const fiche = path.join(dc, ".claude.json");
    if (!existe(fiche) && globale) {
      fs.writeFileSync(fiche, JSON.stringify(ficheDeDepart(globale), null, 2), { mode: 0o600 });
      rapport.crees.push(fiche);
    }
  }
  if (options.lanceur !== false) copierLanceur(lanceurSource, home, rapport);
  return rapport;
}

/** Copie le lanceur à jour dans ~/.claude/comptes/bin (écriture atomique) et le rend exécutable. */
export function copierLanceur(source: string, home: string, rapport: Rapport): void {
  const dest = cheminLanceur(home);
  const neuf = fs.readFileSync(source);
  const actuel = existe(dest) ? fs.readFileSync(dest) : undefined;
  if (!actuel || !actuel.equals(neuf)) {
    // Écriture atomique : Claude peut lancer le lanceur à tout instant.
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, neuf, { mode: 0o755 });
    fs.renameSync(tmp, dest);
    rapport.crees.push(dest);
  }
  fs.chmodSync(dest, 0o755);
}

export function lireJson(fichier: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(fichier, "utf8"));
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** Le compte est-il connecté ? (fiche avec un oauthAccount) */
export function infosCompte(c: "A" | "B", home = os.homedir()): { connecte: boolean; email?: string } {
  const fiche = lireJson(path.join(dossierCompte(c, home), ".claude.json"));
  const oauth = fiche?.oauthAccount as { emailAddress?: unknown } | undefined;
  const email = typeof oauth?.emailAddress === "string" ? oauth.emailAddress : undefined;
  return { connecte: Boolean(oauth), email };
}

// --- Alias de shell (claude-a / claude-b) : seulement sur demande -----------------
// Rien ici n'est appelé à l'activation : la commande « Add shell aliases » le fait,
// après une confirmation qui nomme le fichier.

export type Shell = "zsh" | "bash";

const DEBUT_ALIAS = "# >>> Twinseat (claude-a / claude-b) >>>";
const FIN_ALIAS = "# <<< Twinseat <<<";
// Le bloc écrit par la version 0.2 (avant le nom Twinseat) compte comme déjà présent.
const ANCIEN_DEBUT_ALIAS = /^# >>> Comptes\sClaude \(claude-a \/ claude-b\) >>>$/m;

export const LIGNES_ALIAS: readonly string[] = [
  `alias claude-a='CLAUDE_CONFIG_DIR="$HOME/.claude/comptes/A" claude'`,
  `alias claude-b='CLAUDE_CONFIG_DIR="$HOME/.claude/comptes/B" claude'`,
];

/** Shell d'après $SHELL (le nom du programme, pas le chemin) ; undefined si ni zsh ni bash. */
export function detecterShell(valeurShell: string | undefined): Shell | undefined {
  const nom = path.basename(valeurShell ?? "");
  return nom === "zsh" || nom === "bash" ? nom : undefined;
}

/**
 * Fichier de démarrage où le bloc d'alias s'écrit.
 * - zsh : ~/.zshrc, partout ;
 * - bash sous Linux : ~/.bashrc ;
 * - bash sous macOS (les terminaux y sont des shells de connexion, qui lisent ~/.bash_profile, sinon
 *   ~/.bash_login, sinon ~/.profile) : ~/.bash_profile SEULEMENT s'il existe déjà. Le créer pourrait
 *   masquer un ~/.profile existant, et ~/.bashrc n'est pas lu par un shell de connexion : sans
 *   ~/.bash_profile, rien n'est écrit (`undefined`) et l'appelant montre les lignes (voir `fichierConseille`).
 * Ne crée ni ne modifie rien. `plateforme` = `process.platform` (injectée dans les essais).
 */
export function fichierShell(shell: "zsh", home?: string, plateforme?: string): string;
export function fichierShell(shell: Shell, home?: string, plateforme?: string): string | undefined;
export function fichierShell(shell: Shell, home = os.homedir(), plateforme: string = process.platform): string | undefined {
  if (shell === "zsh") return path.join(home, ".zshrc");
  if (plateforme !== "darwin") return path.join(home, ".bashrc");
  const profil = path.join(home, ".bash_profile");
  return fs.existsSync(profil) ? profil : undefined;
}

/**
 * Sous macOS, le fichier où coller les deux lignes quand `fichierShell` ne donne rien : celui que
 * bash lit à l'ouverture d'un terminal (le premier qui existe parmi ~/.bash_profile, ~/.bash_login,
 * ~/.profile), sinon ~/.bash_profile (à créer à la main). Écrit avec « ~ », pour l'affichage.
 * Ne crée rien.
 */
export function fichierConseille(home = os.homedir()): string {
  const lu = [".bash_profile", ".bash_login", ".profile"].find((nom) => fs.existsSync(path.join(home, nom)));
  return `~/${lu ?? ".bash_profile"}`;
}

/** Le bloc d'alias est-il déjà dans ce fichier ? (absent = non) */
export function aliasPresents(fichier: string): boolean {
  try {
    const actuel = fs.readFileSync(fichier, "utf8");
    return actuel.includes(DEBUT_ALIAS) || ANCIEN_DEBUT_ALIAS.test(actuel);
  } catch {
    return false;
  }
}

/** Ajoute claude-a / claude-b à ce fichier (créé s'il manque), une seule fois. false = déjà là. */
export function ajouterAlias(fichier: string): boolean {
  if (aliasPresents(fichier)) return false;
  const bloc = ["", DEBUT_ALIAS, ...LIGNES_ALIAS, FIN_ALIAS, ""].join("\n");
  fs.appendFileSync(fichier, bloc);
  return true;
}

/**
 * `copier` : rien n'est écrit, l'appelant copie les lignes. `fichierConseille` (bash sous macOS sans
 * ~/.bash_profile) dit dans quel fichier les coller ; absent, le shell est tout simplement inconnu.
 */
export type PlanAlias =
  | { action: "ecrire"; shell: Shell; fichier: string; dejaFait: boolean }
  | { action: "copier"; lignes: readonly string[]; fichierConseille?: string };

/** Que faire pour ce shell ? N'écrit jamais : l'appelant demande confirmation, puis appelle ajouterAlias. */
export function planAlias(valeurShell: string | undefined, home = os.homedir(), plateforme: string = process.platform): PlanAlias {
  const shell = detecterShell(valeurShell);
  if (!shell) return { action: "copier", lignes: LIGNES_ALIAS };
  const fichier = fichierShell(shell, home, plateforme);
  if (!fichier) return { action: "copier", lignes: LIGNES_ALIAS, fichierConseille: fichierConseille(home) };
  return { action: "ecrire", shell, fichier, dejaFait: aliasPresents(fichier) };
}

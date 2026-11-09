// Compte de la fenêtre VS Code : variable d'environnement de l'hôte
// d'extensions (une par fenêtre), mémoire par projet, terminaux, menu.
import * as os from "node:os";
import * as vscode from "vscode";
import { cheminLanceur, Compte, COMPTES, dossierCompte } from "./chemins";
import { libelleQuota } from "./format";
import { infosCompte } from "./installation";
import { journal } from "./journal";
import { derniersQuotas } from "./quotas";
import { ecrireCompteProjet, lireCompteProjet } from "./registre";

export const REGLAGE_LANCEUR = "claudeCode.claudeProcessWrapper";

let contexte: vscode.ExtensionContext | undefined;
let courant: Compte = "A";
let actif = false;
const evenement = new vscode.EventEmitter<Compte>();
export const quandCompteChange = evenement.event;

export function compteFenetre(): Compte {
  return courant;
}

export function dossiersProjet(): string[] {
  const dossiers = (vscode.workspace.workspaceFolders ?? []).map((d) => d.uri.fsPath);
  return dossiers.length ? dossiers : [os.homedir()];
}

/** Synchrone : mémoire du premier dossier (ou du dossier personnel), sinon A. */
export function compteInitial(): Compte {
  try {
    return lireCompteProjet(dossiersProjet()[0]) ?? "A";
  } catch {
    return "A";
  }
}

/** "actif" = notre lanceur est réglé ; "autre" = un autre lanceur occupe le réglage. */
export function etatLanceur(): "actif" | "libre" | "autre" {
  const v = vscode.workspace.getConfiguration().inspect<string>(REGLAGE_LANCEUR)?.globalValue;
  if (!v) return "libre";
  return v === cheminLanceur() ? "actif" : "autre";
}

export function lanceurActif(): boolean {
  return etatLanceur() === "actif";
}

export function initFenetre(context: vscode.ExtensionContext): void {
  contexte = context;
  courant = process.env.CLAUDE_COMPTE_FENETRE === "B" ? "B" : "A";
  majActivation();
  definirCompte(courant, { initial: true });
}

/** À rappeler quand le réglage du lanceur change. */
export function majActivation(): void {
  actif = lanceurActif();
  appliquerTerminal();
}

function appliquerTerminal(): void {
  const collection = contexte?.environmentVariableCollection;
  if (!collection) return;
  if (actif) {
    collection.persistent = false;
    collection.description = "Comptes Claude : les terminaux suivent le compte de cette fenêtre.";
    collection.replace("CLAUDE_CONFIG_DIR", dossierCompte(courant));
  } else {
    collection.delete("CLAUDE_CONFIG_DIR");
  }
}

export function definirCompte(c: Compte, options: { initial: boolean }): void {
  const change = c !== courant;
  courant = c;
  process.env.CLAUDE_COMPTE_FENETRE = c;
  for (const dossier of dossiersProjet()) {
    try {
      ecrireCompteProjet(dossier, c);
    } catch (e) {
      journal(`mémoire du projet non écrite (${(e as Error).message})`);
    }
  }
  appliquerTerminal();
  void vscode.commands.executeCommand("setContext", "claudeComptes.compteFenetre", c);
  evenement.fire(c);
  journal(`fenêtre sur le compte ${c}${options.initial ? " (ouverture)" : ""}`);
  if (!options.initial && change) {
    void vscode.window.showInformationMessage(`Cette fenêtre passe sur le compte ${c}. Les conversations déjà ouvertes gardent leur compte.`);
  }
}

/** Retire tout ce que la fenêtre avait posé (commande « tout désactiver »). */
export function oublierFenetre(): void {
  delete process.env.CLAUDE_COMPTE_FENETRE;
  contexte?.environmentVariableCollection.clear();
  actif = false;
  void vscode.commands.executeCommand("setContext", "claudeComptes.compteFenetre", "");
  void vscode.commands.executeCommand("setContext", "claudeComptes.ongletCompte", "");
  evenement.fire(courant);
}

interface Choix extends vscode.QuickPickItem {
  compte: Compte;
}

/** Menu « Compte Claude pour cette fenêtre ». Fermer le menu = rien ne change. */
export async function demanderCompte(): Promise<void> {
  const items: Choix[] = COMPTES.map((c) => ({
    label: `${c === courant ? "$(check) " : ""}Compte ${c}`,
    description: infosCompte(c).email,
    detail: libelleQuota(derniersQuotas(c)),
    compte: c,
  }));
  const choisi = await new Promise<Compte | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<Choix>();
    qp.title = "Compte Claude pour cette fenêtre";
    qp.placeholder = `Compte actuel : ${courant}`;
    qp.ignoreFocusOut = false;
    qp.items = items;
    qp.activeItems = items.filter((i) => i.compte === courant);
    let pris: Compte | undefined;
    qp.onDidAccept(() => {
      pris = qp.selectedItems[0]?.compte;
      qp.hide();
    });
    qp.onDidHide(() => {
      qp.dispose();
      resolve(pris);
    });
    qp.show();
  });
  if (choisi) definirCompte(choisi, { initial: false });
}

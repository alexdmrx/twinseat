// Compte de la fenêtre VS Code : variable d'environnement de l'hôte
// d'extensions (une par fenêtre), mémoire par projet, terminaux, menu.
import * as os from "node:os";
import * as vscode from "vscode";
import { cheminLanceur, Compte, COMPTES, dossierCompte } from "./chemins";
import { ResolutionCompte, resoudreCompte } from "./compteProjet";
import { libelle, titreCompte } from "./etiquettes";
import { libelleQuota } from "./format";
import { infosCompte } from "./installation";
import { journal } from "./journal";
import { derniersQuotas } from "./quotas";
import { ecrireCompteProjet, lireCompteProjet } from "./registre";
import { etiquettesActuelles, reglageProjet } from "./reglages";
import { t, tSur } from "./textes";
import { texteSurOptionnel } from "./texteSur";

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

/**
 * Le compte du projet, tel que les réglages et la mémoire le disent en ce moment :
 * réglage `twinseat.account` du premier dossier, sinon compte mémorisé pour ce
 * dossier (ou le dossier personnel), sinon A. Synchrone.
 */
export function resolutionProjet(): ResolutionCompte {
  let memoire: Compte | undefined;
  try {
    memoire = lireCompteProjet(dossiersProjet()[0]);
  } catch {
    memoire = undefined;
  }
  return resoudreCompte(reglageProjet(), etiquettesActuelles(), memoire);
}

const PAR_DEFAUT: ResolutionCompte = { compte: "A", source: "default" };
let initiale: ResolutionCompte = PAR_DEFAUT;

/**
 * Synchrone (il pose CLAUDE_COMPTE_FENETRE avant le démarrage des onglets Claude
 * restaurés) : le compte de la fenêtre à l'ouverture, et d'où il vient.
 */
export function compteInitial(): Compte {
  try {
    initiale = resolutionProjet();
  } catch {
    initiale = PAR_DEFAUT;
  }
  return initiale.compte;
}

/** Comment le compte de l'ouverture a été trouvé (réglage, mémoire ou défaut). */
export function resolutionInitiale(): ResolutionCompte {
  return initiale;
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
  // Ni réglage ni mémoire : le compte par défaut n'est pas un choix, on ne le mémorise pas
  // (c'est le menu d'ouverture qui demandera, puis mémorisera la réponse).
  definirCompte(courant, { initial: true, memoriser: initiale.source !== "default" });
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
    collection.description = t("fenetre.terminal");
    collection.replace("CLAUDE_CONFIG_DIR", dossierCompte(courant));
  } else {
    collection.delete("CLAUDE_CONFIG_DIR");
  }
}

/** Le message « les réglages du projet disent autre chose » ne s'affiche qu'une fois par fenêtre. */
let reglageExplique = false;

export function definirCompte(c: Compte, options: { initial: boolean; memoriser?: boolean }): void {
  const change = c !== courant;
  courant = c;
  process.env.CLAUDE_COMPTE_FENETRE = c;
  if (options.memoriser ?? true) {
    for (const dossier of dossiersProjet()) {
      try {
        ecrireCompteProjet(dossier, c);
      } catch (e) {
        journal(`mémoire du projet non écrite (${(e as Error).message})`);
      }
    }
  }
  appliquerTerminal();
  void vscode.commands.executeCommand("setContext", "claudeComptes.compteFenetre", c);
  evenement.fire(c);
  journal(`fenêtre sur le compte ${c}${options.initial ? " (ouverture)" : ""}`);
  if (!options.initial && change) annoncerChangement(c);
}

/**
 * Dit que la fenêtre a changé de compte. Si les réglages du projet imposent un autre
 * compte, le choix ne vaut que pour cette session : on l'explique une fois, avec un
 * bouton qui met le réglage du projet à jour.
 */
function annoncerChangement(c: Compte): void {
  const e = etiquettesActuelles();
  const r = resolutionProjet();
  if (r.source === "project-setting" && r.compte !== c && !reglageExplique) {
    reglageExplique = true;
    const changer = t("fenetre.changerReglage");
    const message = tSur("fenetre.changeProjet", { compte: libelle(c, e), projet: libelle(r.compte, e) });
    void vscode.window.showInformationMessage(message, changer).then((choix) => {
      if (choix === changer) void vscode.commands.executeCommand("claudeComptes.epinglerProjet");
    });
    return;
  }
  void vscode.window.showInformationMessage(tSur("fenetre.change", { compte: libelle(c, e) }));
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

/** Menu du compte de cette fenêtre. Fermer le menu = rien ne change. */
export async function demanderCompte(): Promise<void> {
  const e = etiquettesActuelles();
  const items: Choix[] = COMPTES.map((c) => ({
    label: `${c === courant ? "$(check) " : ""}${titreCompte(c, e)}`,
    description: texteSurOptionnel(infosCompte(c).email, 100),
    detail: libelleQuota(derniersQuotas(c)),
    compte: c,
  }));
  const choisi = await new Promise<Compte | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<Choix>();
    qp.title = t("menu.titre");
    qp.placeholder = tSur("menu.placeholder", { compte: libelle(courant, e) });
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

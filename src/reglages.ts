// Réglages Twinseat lus et écrits dans VS Code : noms des comptes
// (`twinseat.accountLabels`, utilisateur) et compte du projet (`twinseat.account`,
// dossier). Toute la logique (validation, résolution) est dans etiquettes.ts et
// compteProjet.ts, sans vscode ; ici, seulement l'accès aux réglages.
import * as vscode from "vscode";
import { Compte } from "./chemins";
import { Etiquettes, etiquettesValides, libelle, titreCompte } from "./etiquettes";

/** Nom du réglage des noms de comptes, tel qu'écrit dans settings.json. */
export const REGLAGE_ETIQUETTES = "twinseat.accountLabels";
/** Nom du réglage « le compte de ce projet ». */
export const REGLAGE_COMPTE = "twinseat.account";

/** Les noms valides en ce moment (un nom invalide ou absent n'y figure pas). */
export function etiquettesActuelles(): Etiquettes {
  return etiquettesValides(vscode.workspace.getConfiguration("twinseat").get<unknown>("accountLabels"));
}

/** « work » ou « A » : pour les phrases, les boutons et la barre d'état. */
export function libelleCompte(c: Compte): string {
  return libelle(c, etiquettesActuelles());
}

/** « work » ou « Account A » : pour les titres de cartes et de menus. */
export function titreDuCompte(c: Compte): string {
  return titreCompte(c, etiquettesActuelles());
}

/** Le premier dossier de la fenêtre : celui dont dépend le compte du projet. */
export function dossierPrincipal(): vscode.WorkspaceFolder | undefined {
  return vscode.workspace.workspaceFolders?.[0];
}

/** Valeur brute de `twinseat.account` pour le premier dossier (n'importe quoi : c'est du JSON de l'utilisateur). */
export function reglageProjet(): unknown {
  return vscode.workspace.getConfiguration("twinseat", dossierPrincipal()?.uri).get<unknown>("account");
}

/** Écrit (ou, avec `undefined`, retire) le nom d'un compte dans les réglages de l'utilisateur. */
export async function ecrireEtiquette(c: Compte, nom: string | undefined): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("twinseat");
  const actuel = cfg.inspect<unknown>("accountLabels")?.globalValue;
  const objet: Record<string, unknown> =
    actuel && typeof actuel === "object" && !Array.isArray(actuel) ? { ...(actuel as Record<string, unknown>) } : {};
  if (nom === undefined) delete objet[c];
  else objet[c] = nom;
  await cfg.update("accountLabels", Object.keys(objet).length ? objet : undefined, vscode.ConfigurationTarget.Global);
}

/**
 * Écrit `twinseat.account` dans les réglages du premier dossier (.vscode/settings.json).
 * Faux, sans rien écrire, si aucun dossier n'est ouvert.
 */
export async function ecrireReglageProjet(valeur: string): Promise<boolean> {
  const dossier = dossierPrincipal();
  if (!dossier) return false;
  await vscode.workspace.getConfiguration("twinseat", dossier.uri).update("account", valeur, vscode.ConfigurationTarget.WorkspaceFolder);
  return true;
}

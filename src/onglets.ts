// Bulle A/B sur l'onglet Claude actif : clé de contexte claudeComptes.ongletCompte.
import * as vscode from "vscode";
import { Compte } from "./chemins";
import { compteDepuisOnglet } from "./format";
import { conversationsOuvertes, conversationsVivantes, lireCompte, trouverHistorique } from "./registre";

function ongletClaudeActif(): vscode.Tab | undefined {
  const tab = vscode.window.tabGroups.activeTabGroup?.activeTab;
  if (!tab) return undefined;
  const entree = tab.input;
  if (entree instanceof vscode.TabInputWebview && entree.viewType.includes("claudeVSCodePanel")) return tab;
  return undefined;
}

export function demarrerOnglets(
  context: vscode.ExtensionContext,
  compteFenetre: () => Compte,
  quandCompteChange: vscode.Event<unknown>,
): void {
  let dernier: string | undefined;
  let numero = 0;

  const poser = (valeur: string) => {
    if (valeur === dernier) return;
    dernier = valeur;
    void vscode.commands.executeCommand("setContext", "claudeComptes.ongletCompte", valeur);
  };

  const maj = async () => {
    const mon = ++numero;
    const tab = ongletClaudeActif();
    if (!tab) return poser("");
    // Jamais de compte deviné : « ? » plutôt qu'une bulle fausse.
    let compte: Compte | "?";
    const vivantes = await conversationsVivantes();
    if (tab.label.trim() === "Claude Code") {
      // Onglet neuf : son processus est lancé mais n'a pas encore d'historique.
      const neuves = new Set<Compte | "?">();
      for (const id of vivantes.keys()) {
        if (!trouverHistorique(id)) neuves.add(lireCompte(id) ?? "?");
      }
      // Aucun processus encore : il partira sur le compte de la fenêtre.
      compte = neuves.size === 0 ? compteFenetre() : neuves.size === 1 ? [...neuves][0] : "?";
    } else {
      compte = compteDepuisOnglet(tab.label, conversationsOuvertes(vivantes)) ?? "?";
    }
    if (mon !== numero) return; // une mise à jour plus récente a pris le relais
    poser(compte);
  };

  const declencher = () => void maj();
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(declencher),
    vscode.window.tabGroups.onDidChangeTabGroups(declencher),
    quandCompteChange(declencher),
  );
  const minuteur = setInterval(() => {
    if (vscode.window.state.focused) declencher();
  }, 15_000);
  context.subscriptions.push({ dispose: () => clearInterval(minuteur) });
  declencher();
}

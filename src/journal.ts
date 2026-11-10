// Journal « Twinseat » (OutputChannel). Jamais d'e-mail, de jeton,
// de titre ni de contenu de conversation : des numéros et des états seulement.
import * as vscode from "vscode";

let canal: vscode.OutputChannel | undefined;

export function ouvrirJournal(): vscode.OutputChannel {
  canal ??= vscode.window.createOutputChannel("Twinseat");
  return canal;
}

export function journal(message: string): void {
  canal?.appendLine(`${new Date().toISOString()} ${message}`);
}

// Commande « Twinseat: Add claude-a / claude-b shell aliases ».
// Rien n'est écrit sans accord : le fichier visé est nommé dans une confirmation
// qui montre aussi les deux lignes. Zsh et bash seulement (le fichier dépend du shell et du
// système : voir fichierShell) ; pour un autre shell, les deux lignes sont copiées et rien
// n'est écrit.
import * as vscode from "vscode";
import { ajouterAlias, LIGNES_ALIAS, planAlias } from "./installation";
import { journal } from "./journal";
import { t } from "./textes";

export async function proposerAlias(): Promise<void> {
  const detail = LIGNES_ALIAS.join("\n");
  const plan = planAlias(process.env.SHELL);

  if (plan.action === "copier") {
    await vscode.env.clipboard.writeText(detail);
    void vscode.window.showInformationMessage(t("alias.shellInconnu"), { modal: true, detail });
    return;
  }

  const { fichier } = plan;
  if (plan.dejaFait) {
    void vscode.window.showInformationMessage(t("alias.dejaLa", { fichier }));
    return;
  }
  const ajouter = t("alias.ajouter");
  const choix = await vscode.window.showInformationMessage(t("alias.confirmer", { fichier }), { modal: true, detail }, ajouter);
  if (choix !== ajouter) {
    void vscode.window.showInformationMessage(t("rienChange"));
    return;
  }
  try {
    const ecrit = ajouterAlias(fichier);
    journal(ecrit ? `alias ajoutés à ${fichier}` : `alias déjà présents dans ${fichier}`);
    void vscode.window.showInformationMessage(t(ecrit ? "alias.ajoutes" : "alias.dejaLa", { fichier }));
  } catch (e) {
    journal(`alias : ${(e as Error).message}`);
    void vscode.window.showWarningMessage(t("alias.echec", { fichier }));
  }
}

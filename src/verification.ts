// Commandes « Twinseat: Check and Repair Setup » et « Twinseat: Copy Diagnostics ».
// Ici, seulement ce qui touche à vscode : rassembler ce que VS Code sait (versions, réglage du
// lanceur), montrer le résumé, proposer le bouton « Réparer ». Toute la logique (vérifications,
// réparation, rapport sans donnée personnelle) est dans diagnostic.ts, testée sans vscode.
import * as os from "node:os";
import * as vscode from "vscode";
import {
  bilan, construireRapport, EntreesDiagnostic, ID_EXTENSION_CLAUDE, reparer, resumeTexte, verifier, Verification, ActionReparation,
} from "./diagnostic";
import { REGLAGE_LANCEUR } from "./fenetre";
import { afficherJournal, journal, journalBrut } from "./journal";
import { t } from "./textes";

/** Ce que VS Code sait, rassemblé pour le cœur (lanceur livré, version, réglage global du lanceur). */
function entrees(context: vscode.ExtensionContext): EntreesDiagnostic {
  const claude = vscode.extensions.getExtension(ID_EXTENSION_CLAUDE);
  const version = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
  return {
    home: os.homedir(),
    plateforme: process.platform,
    arch: process.arch,
    versionSysteme: os.release(),
    lanceurInclus: context.asAbsolutePath("resources/lanceur.sh"),
    dossierExtensionClaude: claude?.extensionPath,
    reglageLanceur: vscode.workspace.getConfiguration().inspect<string>(REGLAGE_LANCEUR)?.globalValue,
    versions: {
      twinseat: version(context.extension.packageJSON?.version) ?? "?",
      vscode: vscode.version,
      claudeCode: version(claude?.packageJSON?.version),
    },
  };
}

/** Écrit le résumé dans la sortie « Twinseat » et la montre, sans prendre le focus. */
function montrerResume(verifs: readonly Verification[]): void {
  journalBrut(`\n${t("verifier.titre")}\n${resumeTexte(verifs)}`);
  afficherJournal();
}

function phraseAction(action: ActionReparation): string {
  if (action === "lanceur" || action === "installation") return t(action === "lanceur" ? "reparation.lanceur" : "reparation.installation");
  return t("reparation.droits", { compte: action.slice("droits-".length) });
}

let enCours = false;

export async function verifierEtReparer(context: vscode.ExtensionContext): Promise<void> {
  if (enCours) return;
  enCours = true;
  try {
    const e = entrees(context);
    const avant = verifier(e);
    montrerResume(avant);
    const b = bilan(avant);
    journal(`vérification : ${b.ok} ok, ${b.warn} avertissement(s), ${b.fail} échec(s), ${b.reparables} réparable(s)`);
    if (!b.warn && !b.fail) {
      void vscode.window.showInformationMessage(t("verifier.toutBon", { n: avant.length }));
      return;
    }
    const resume = t("verifier.bilan", { ok: b.ok, warn: b.warn, fail: b.fail });
    if (!b.reparables) {
      void vscode.window.showWarningMessage(t("verifier.aLire", { bilan: resume }));
      return;
    }
    const reparerTexte = t("verifier.reparer");
    const choix = await vscode.window.showWarningMessage(t("verifier.reparables", { bilan: resume, n: b.reparables }), reparerTexte);
    if (choix !== reparerTexte) return;

    const r = reparer(e);
    for (const a of r.actions) journal(`réparation : ${a}`);
    for (const x of r.erreurs) journal(`réparation impossible : ${x.action} (${x.code})`);
    journalBrut(`\n${t("verifier.reparer")}\n${r.actions.map((a) => `- ${phraseAction(a)}`).join("\n")}`);
    montrerResume(r.apres);
    const apres = bilan(r.apres);
    if (r.erreurs.length) void vscode.window.showWarningMessage(t("verifier.echecs"));
    else if (!apres.warn && !apres.fail) void vscode.window.showInformationMessage(t("verifier.repareToutBon"));
    else {
      const bilanApres = t("verifier.bilan", { ok: apres.ok, warn: apres.warn, fail: apres.fail });
      void vscode.window.showWarningMessage(`${t("verifier.repare", { bilan: bilanApres })} ${t("verifier.reste")}`);
    }
  } catch (err) {
    journal(`vérification : ${(err as Error).message}`);
  } finally {
    enCours = false;
  }
}

/** Copie le rapport de diagnostic (sans adresse, nom de compte, conversation ni jeton) dans le presse-papiers. */
export async function copierDiagnostic(context: vscode.ExtensionContext): Promise<void> {
  try {
    await vscode.env.clipboard.writeText(construireRapport(entrees(context)));
    void vscode.window.showInformationMessage(t("diagnostic.copie"));
  } catch (err) {
    journal(`diagnostic : ${(err as Error).message}`);
  }
}

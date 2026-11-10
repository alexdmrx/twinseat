import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import { proposerAlias } from "./alias";
import { cheminLanceur, Compte, COMPTES, autreCompte, dossierCompte, estCompte, estNumeroConversation, sousDossier } from "./chemins";
import { libelleQuota, phraseAlerte } from "./format";
import { infosCompte, installer } from "./installation";
import { journal, ouvrirJournal } from "./journal";
import { demarrerOnglets } from "./onglets";
import { Panneau } from "./panneau";
import { auSeuil, demanderQuotas, derniersQuotas, enregistrerQuotas, prendreVerrou, rendreVerrou } from "./quotas";
import { conversationsVivantes, ecrireCompte, nettoyerRegistre, titreConversation, trouverHistorique } from "./registre";
import { estNomNote, jetonsContexte, jetonsTexte, lireFin, marquerAlerteContexte, nettoyerAlertesContexte, SEUIL_CONTEXTE } from "./relais";
import { definirLangue, t } from "./textes";
import {
  compteFenetre, compteInitial, definirCompte, demanderCompte, etatLanceur, initFenetre,
  majActivation, oublierFenetre, quandCompteChange, REGLAGE_LANCEUR,
} from "./fenetre";

const CINQ_MIN = 5 * 60_000;

function binaireClaude(): string | undefined {
  const ext = vscode.extensions.getExtension("anthropic.claude-code");
  const candidats = [
    ext ? path.join(ext.extensionPath, "resources", "native-binary", "claude") : undefined,
    path.join(os.homedir(), ".local", "bin", "claude"),
  ];
  return candidats.find((c): c is string => Boolean(c) && fs.existsSync(c as string));
}

const entreGuillemets = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const deuxConnectes = () => COMPTES.every((c) => infosCompte(c).connecte);

export function activate(context: vscode.ExtensionContext): void {
  // Avant tout texte visible : la langue de VS Code choisit l'anglais ou le français.
  definirLangue(vscode.env.language);
  // Synchrone, avant tout le reste : les onglets Claude restaurés démarrent tôt.
  process.env.CLAUDE_COMPTE_FENETRE = compteInitial();

  context.subscriptions.push(ouvrirJournal());
  initFenetre(context);

  try {
    const r = installer(context.asAbsolutePath("resources/lanceur.sh"));
    journal(`installation : ${r.crees.length} créé(s), ${r.conflits.length} conflit(s)`);
    for (const c of r.conflits) journal(`conflit : ${c}`);
  } catch (e) {
    journal(`installation impossible : ${(e as Error).message}`);
  }
  const gs = context.globalState;

  // Nettoyage du registre : une fois par jour, bien après le démarrage.
  const nettoyage = setTimeout(() => {
    const jour = new Date().toISOString().slice(0, 10);
    if (gs.get<string>("registre-nettoye") === jour) return;
    void gs.update("registre-nettoye", jour);
    try {
      const n = nettoyerRegistre();
      if (n) journal(`registre : ${n} entrée(s) retirée(s)`);
      const m = nettoyerAlertesContexte();
      if (m) journal(`alertes de contexte : ${m} marqueur(s) retiré(s)`);
    } catch (e) {
      journal(`nettoyage du registre : ${(e as Error).message}`);
    }
  }, 120_000);
  context.subscriptions.push({ dispose: () => clearTimeout(nettoyage) });

  // --- Barre d'état ---------------------------------------------------------
  const barre = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  barre.command = "claudeComptes.choisirCompte";
  context.subscriptions.push(barre);
  const majBarre = () => {
    if (etatLanceur() !== "actif") return barre.hide();
    barre.text = t("barre.texte", { compte: compteFenetre() });
    barre.tooltip = [
      ...COMPTES.map((c) => `${t("compte.nom", { compte: c })} — ${libelleQuota(derniersQuotas(c))}`),
      t("barre.infobulle"),
    ].join("\n");
    barre.show();
  };

  // --- Panneau --------------------------------------------------------------
  const panneau = new Panneau({
    compteFenetre,
    etatLanceur,
    quandCompteChange,
    dossierProjet: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(Panneau.id, panneau));

  demarrerOnglets(context, compteFenetre, quandCompteChange);

  // --- Activation du lanceur ------------------------------------------------
  const activerLanceur = async (manuel: boolean): Promise<void> => {
    const reglage = vscode.workspace.getConfiguration();
    const present = reglage.inspect<string>(REGLAGE_LANCEUR)?.globalValue;
    if (present && present !== cheminLanceur()) {
      if (gs.get<string>("avertissement-lanceur") !== present || manuel) {
        void gs.update("avertissement-lanceur", present);
        void vscode.window.showWarningMessage(t("lanceur.autre"));
      }
      return;
    }
    if (present === cheminLanceur()) return;
    if (!deuxConnectes()) {
      if (manuel) void vscode.window.showInformationMessage(t("activer.connecterDabord"));
      return;
    }
    try {
      await reglage.update(REGLAGE_LANCEUR, cheminLanceur(), vscode.ConfigurationTarget.Global);
      await gs.update("desactive", false);
      journal("lanceur activé");
      void vscode.window.showInformationMessage(t("activer.ok"));
    } catch (e) {
      journal(`réglage du lanceur impossible : ${(e as Error).message}`);
      void vscode.window.showWarningMessage(t("activer.echec"));
    }
  };

  // --- Quotas et alerte -----------------------------------------------------
  let releveEnCours = false;
  const dernierEchec: Record<Compte, number> = { A: 0, B: 0 };
  const alertes = new Set<string>();

  const COPIER_RELAIS = t("relais.copier");
  const copierRelais = async (): Promise<void> => {
    await vscode.env.clipboard.writeText("/relais");
    void vscode.window.showInformationMessage(t("relais.copie"));
  };

  const verifierAlerte = () => {
    if (etatLanceur() !== "actif") return;
    const c = compteFenetre();
    const q = derniersQuotas(c);
    const s = auSeuil(q);
    if (!s) return;
    const cle = `${c}|${s.limite}|${s.reset ?? ""}`;
    if (alertes.has(cle)) return;
    alertes.add(cle);
    const autre = autreCompte(c);
    const bascule = t("alerte.basculer", { compte: autre });
    const voir = t("alerte.voir");
    void vscode.window.showWarningMessage(phraseAlerte(c, s.pct, s.limite, s.reset), bascule, voir, COPIER_RELAIS).then((choix) => {
      if (choix === bascule) definirCompte(autre, { initial: false });
      else if (choix === COPIER_RELAIS) void copierRelais();
      else if (choix === voir) void vscode.commands.executeCommand("claudeComptes.panneau.focus");
    });
  };

  const relever = async (force: boolean): Promise<void> => {
    if (releveEnCours) return;
    const comptes = COMPTES.filter((c) => infosCompte(c).connecte);
    if (!comptes.length) return;
    const maintenant = Date.now();
    if (!force) {
      const aFaire = comptes.some((c) => {
        const q = derniersQuotas(c);
        const perime = !q || maintenant - q.majLe > CINQ_MIN;
        return perime && maintenant - dernierEchec[c] > CINQ_MIN;
      });
      if (!aFaire) return;
    }
    const binaire = binaireClaude();
    if (!binaire) {
      journal("quotas : binaire de Claude introuvable");
      if (force) void vscode.window.showWarningMessage(t("releve.introuvable"));
      return;
    }
    let verrou = false;
    try {
      verrou = prendreVerrou();
    } catch (e) {
      journal(`verrou : ${(e as Error).message}`);
    }
    if (!verrou) {
      if (force) void vscode.window.showInformationMessage(t("releve.enCours"));
      return;
    }
    releveEnCours = true;
    try {
      for (const c of comptes) {
        const q = await demanderQuotas(c, binaire);
        if (!q.erreur && (q.cinqHeures || q.semaine)) {
          enregistrerQuotas(q);
          dernierEchec[c] = 0;
        } else {
          dernierEchec[c] = Date.now();
          journal(`quotas ${c} : échec (${q.erreur ?? "aucun chiffre"})`);
        }
      }
    } catch (e) {
      journal(`quotas : ${(e as Error).message}`);
    } finally {
      rendreVerrou();
      releveEnCours = false;
    }
    majBarre();
    verifierAlerte();
    void panneau.rafraichir();
  };

  // Les relevés des autres fenêtres arrivent par les fichiers de quotas.
  try {
    let attente: NodeJS.Timeout | undefined;
    const w = fs.watch(sousDossier.quotas(), (_evt, nom) => {
      if (nom && !String(nom).endsWith(".json")) return; // verrou, fichiers temporaires
      clearTimeout(attente);
      attente = setTimeout(() => {
        majBarre();
        verifierAlerte();
      }, 700);
    });
    w.on("error", () => undefined);
    context.subscriptions.push({ dispose: () => w.close() });
  } catch {
    journal("surveillance des quotas indisponible");
  }
  const sondage = setInterval(() => void relever(false), 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(sondage) });
  setTimeout(() => void relever(false), 3000);

  // --- Conversations longues : une alerte par conversation, toutes fenêtres ---
  let contexteEnCours = false;
  const verifierContexte = async (): Promise<void> => {
    if (contexteEnCours) return;
    contexteEnCours = true;
    try {
      for (const id of (await conversationsVivantes()).keys()) {
        const f = trouverHistorique(id);
        const fin = f ? lireFin(f) : undefined;
        const jetons = fin === undefined ? undefined : jetonsContexte(fin);
        if (jetons === undefined || jetons < SEUIL_CONTEXTE) continue;
        if (!marquerAlerteContexte(id)) continue; // déjà signalée (cette fenêtre ou une autre)
        const titre = (f && titreConversation(f)) ?? t("contexte.sansTitre");
        void vscode.window
          .showWarningMessage(
            t("contexte.longue", { titre, jetons: jetonsTexte(jetons) }),
            COPIER_RELAIS,
          )
          .then((choix) => {
            if (choix === COPIER_RELAIS) void copierRelais();
          });
      }
    } catch (e) {
      journal(`conversations longues : ${(e as Error).message}`);
    } finally {
      contexteEnCours = false;
    }
  };
  const sondageContexte = setInterval(() => void verifierContexte(), 60_000);
  context.subscriptions.push({ dispose: () => clearInterval(sondageContexte) });

  context.subscriptions.push(
    quandCompteChange(() => {
      majBarre();
      verifierAlerte();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration(REGLAGE_LANCEUR)) return;
      majActivation();
      majBarre();
      void panneau.rafraichir();
    }),
  );

  // --- Commandes ------------------------------------------------------------
  const cmd = (nom: string, f: (...args: unknown[]) => unknown) =>
    context.subscriptions.push(vscode.commands.registerCommand(`claudeComptes.${nom}`, f));

  cmd("choisirCompte", async (arg) => {
    if (etatLanceur() !== "actif") {
      void vscode.window.showInformationMessage(t("choisir.inactif"));
      return;
    }
    if (estCompte(arg)) definirCompte(arg, { initial: false });
    else await demanderCompte();
  });
  cmd("actualiser", () => relever(true));
  cmd("activer", async () => {
    await activerLanceur(true);
    majActivation();
    majBarre();
    void panneau.rafraichir();
  });
  cmd("desactiver", async () => {
    const reglage = vscode.workspace.getConfiguration();
    if (reglage.inspect<string>(REGLAGE_LANCEUR)?.globalValue === cheminLanceur()) {
      await reglage.update(REGLAGE_LANCEUR, undefined, vscode.ConfigurationTarget.Global);
    }
    await gs.update("desactive", true);
    oublierFenetre();
    majActivation();
    barre.hide();
    journal("tout désactivé");
    void panneau.rafraichir();
    void vscode.window.showInformationMessage(t("desactiver.ok"));
  });
  cmd("seConnecter", async (arg) => {
    let c: Compte | undefined = estCompte(arg) ? arg : undefined;
    if (!c) {
      const p = await vscode.window.showQuickPick(
        COMPTES.map((x) => ({ label: t("compte.nom", { compte: x }), compte: x })),
        { title: t("connecter.titre") },
      );
      c = p?.compte;
    }
    if (!c) return;
    const binaire = binaireClaude();
    if (!binaire) {
      void vscode.window.showWarningMessage(t("connecter.introuvable"));
      return;
    }
    const dossier = dossierCompte(c);
    const terminal = vscode.window.createTerminal({ name: t("connecter.terminal", { compte: c }), env: { CLAUDE_CONFIG_DIR: dossier } });
    terminal.show();
    // Le dossier est aussi posé en tête de commande : la variable des terminaux
    // de la fenêtre (compte de la fenêtre) ne doit pas prendre le dessus.
    terminal.sendText(`CLAUDE_CONFIG_DIR=${entreGuillemets(dossier)} ${entreGuillemets(binaire)} auth login`);
    void vscode.window.showInformationMessage(t("connecter.navigateur"));
  });
  cmd("reprendre", async (id, compte) => {
    if (!estNumeroConversation(id) || !estCompte(compte)) return;
    const ouverte = async () => (await conversationsVivantes()).has(id);
    let essais = 0;
    while (await ouverte()) {
      if (essais >= 3) {
        void vscode.window.showWarningMessage(t("reprendre.toujours"));
        return;
      }
      essais++;
      const ok = t("reprendre.fait");
      const r = await vscode.window.showWarningMessage(t("reprendre.fermer"), { modal: true }, ok);
      if (r !== ok) {
        void vscode.window.showInformationMessage(t("rienChange"));
        return;
      }
      await new Promise((r2) => setTimeout(r2, 1200)); // le temps que le processus s'arrête
    }
    ecrireCompte(id, compte);
    journal(`reprise de ${id} sur ${compte}`);
    await vscode.commands.executeCommand("claude-vscode.editor.open", id);
    void vscode.window.showInformationMessage(t("reprendre.ok", { compte }));
  });
  cmd("reprendreRelais", async (compte, note) => {
    if (!estCompte(compte)) return;
    if (compte !== compteFenetre()) definirCompte(compte, { initial: false });
    // Une note précise (bouton d'une note ancienne), sinon la plus récente.
    const texte = estNomNote(note) ? `/reprendre ${note}` : "/reprendre";
    await vscode.env.clipboard.writeText(texte);
    try {
      await vscode.commands.executeCommand("claude-vscode.editor.open", undefined, texte);
    } catch (e) {
      journal(`relais : ouverture impossible (${(e as Error).message})`);
    }
    void vscode.window.showInformationMessage(t("relais.reprise", { compte, texte }));
  });
  cmd("ajouterAlias", proposerAlias);
  const focus = () => vscode.commands.executeCommand("claudeComptes.panneau.focus");
  cmd("bulleA", focus);
  cmd("bulleB", focus);
  cmd("bulleInconnu", focus);

  // --- Démarrage : activation du lanceur, puis menu d'ouverture --------------
  void (async () => {
    if (!gs.get<boolean>("desactive")) await activerLanceur(false);
    majActivation();
    majBarre();
    void panneau.rafraichir();
    if (etatLanceur() === "actif" && deuxConnectes()) await demanderCompte();
  })().catch((e: unknown) => journal(`démarrage : ${(e as Error).message}`));
}

export function deactivate(): void {
  // Rien à défaire : les minuteurs et surveillants sont dans context.subscriptions.
}

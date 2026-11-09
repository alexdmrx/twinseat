// Panneau « Comptes Claude » (vue webview de la barre d'activité).
// Flux : le panneau envoie {action, …} → on valide (liste fermée) → on lance
// la commande correspondante. On lui renvoie {type:"etat", etat} avec des
// textes déjà prêts ; il les affiche avec textContent (jamais innerHTML).
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as vscode from "vscode";
import { Compte, COMPTES, estCompte, estNumeroConversation, sousDossier } from "./chemins";
import { ageTexte, niveau, Niveau, phraseMaj, phraseRetour, pourcent } from "./format";
import { infosCompte } from "./installation";
import { journal } from "./journal";
import { derniersQuotas, Fenetre } from "./quotas";
import { cheminNote, estNomNote, listerNotes, NoteRelais } from "./relais";
import { conversationsOuvertes, conversationsRecentes, conversationsVivantes } from "./registre";

export interface Dependances {
  compteFenetre(): Compte;
  etatLanceur(): "actif" | "libre" | "autre";
  quandCompteChange: vscode.Event<unknown>;
  dossierProjet(): string | undefined;
}

interface Barre {
  nom: string;
  pct: number;
  niveau: Niveau;
  texte: string;
}
interface CarteCompte {
  compte: Compte;
  email?: string;
  connecte: boolean;
  plan?: string;
  fenetre: boolean;
  barres: Barre[];
  maj?: string;
  indisponible: boolean;
}
interface LigneConversation {
  id: string;
  titre: string;
  compte?: Compte;
  age: string;
  ouverte: boolean;
}
export interface Etat {
  banniere?: string;
  peutActiver: boolean;
  comptes: CarteCompte[];
  ouvertes: LigneConversation[];
  recentes: LigneConversation[];
  aDossier: boolean;
  relais: NoteRelais[];
}

function barre(nom: string, f: Fenetre): Barre {
  const retour = phraseRetour(f.reset);
  return { nom, pct: Math.max(0, Math.min(100, f.pct)), niveau: niveau(f.pct), texte: retour ? `${pourcent(f.pct)} · ${retour}` : pourcent(f.pct) };
}

export class Panneau implements vscode.WebviewViewProvider {
  static readonly id = "claudeComptes.panneau";
  private vue: vscode.WebviewView | undefined;
  private enCours = false;
  private encore = false;
  private surveillant: fs.FSWatcher | undefined;
  private minuteurs: NodeJS.Timeout[] = [];
  private abonnements: vscode.Disposable[] = [];

  constructor(private readonly deps: Dependances) {}

  resolveWebviewView(vue: vscode.WebviewView): void {
    this.vue = vue;
    vue.webview.options = { enableScripts: true };
    vue.webview.html = this.html(vue.webview);
    this.abonnements.push(
      vue.webview.onDidReceiveMessage((m: unknown) => this.surMessage(m)),
      vue.onDidChangeVisibility(() => {
        if (vue.visible) void this.rafraichir();
      }),
      this.deps.quandCompteChange(() => void this.rafraichir()),
      vue.onDidDispose(() => this.arreter()),
    );
    this.minuteurs.push(setInterval(() => void this.rafraichir(), 20_000));
    try {
      let attente: NodeJS.Timeout | undefined;
      this.surveillant = fs.watch(sousDossier.quotas(), (_evt, nom) => {
        if (nom && !String(nom).endsWith(".json")) return; // verrou, fichiers temporaires
        clearTimeout(attente);
        attente = setTimeout(() => void this.rafraichir(), 500);
      });
      this.surveillant.on("error", () => undefined);
    } catch {
      journal("surveillance des quotas indisponible (20 s suffisent)");
    }
  }

  private arreter(): void {
    this.minuteurs.forEach(clearInterval);
    this.minuteurs = [];
    this.surveillant?.close();
    this.surveillant = undefined;
    this.abonnements.forEach((a) => a.dispose());
    this.abonnements = [];
    this.vue = undefined;
  }

  private surMessage(m: unknown): void {
    if (!m || typeof m !== "object") return;
    const o = m as { action?: unknown; compte?: unknown; id?: unknown; note?: unknown };
    switch (o.action) {
      case "pret":
        void this.rafraichir(true);
        return;
      case "actualiser":
        void vscode.commands.executeCommand("claudeComptes.actualiser");
        return;
      case "activer":
        void vscode.commands.executeCommand("claudeComptes.activer");
        return;
      case "utiliser":
        if (estCompte(o.compte)) void vscode.commands.executeCommand("claudeComptes.choisirCompte", o.compte);
        return;
      case "connecter":
        if (estCompte(o.compte)) void vscode.commands.executeCommand("claudeComptes.seConnecter", o.compte);
        return;
      case "reprendre":
        if (estNumeroConversation(o.id) && estCompte(o.compte)) {
          void vscode.commands.executeCommand("claudeComptes.reprendre", o.id, o.compte);
        }
        return;
      case "ouvrirRelais":
        void this.ouvrirNote(o.note);
        return;
      case "reprendreRelais":
        // Le nom de la note n'est transmis que s'il a la forme exacte d'une note.
        if (estCompte(o.compte)) {
          void vscode.commands.executeCommand("claudeComptes.reprendreRelais", o.compte, estNomNote(o.note) ? o.note : undefined);
        }
        return;
      default:
        return;
    }
  }

  /** Ouvre une note du projet ; le nom vient du webview, le chemin est refait ici. */
  private async ouvrirNote(nom: unknown): Promise<void> {
    const dossier = this.deps.dossierProjet();
    const chemin = dossier ? cheminNote(dossier, nom) : undefined;
    if (!chemin) return;
    try {
      await vscode.window.showTextDocument(vscode.Uri.file(chemin), { preview: true });
    } catch (e) {
      journal(`relais : note illisible (${(e as Error).message})`);
      void vscode.window.showWarningMessage("Cette note de relais est introuvable.");
    }
  }

  async rafraichir(force = false): Promise<void> {
    if (!this.vue || (!force && !this.vue.visible)) return;
    if (this.enCours) {
      this.encore = true;
      return;
    }
    this.enCours = true;
    try {
      do {
        this.encore = false;
        const etat = await this.etat();
        void this.vue?.webview.postMessage({ type: "etat", etat });
      } while (this.encore);
    } catch (e) {
      journal(`panneau : ${(e as Error).message}`);
    } finally {
      this.enCours = false;
    }
  }

  private async etat(): Promise<Etat> {
    const maintenant = Date.now();
    const etatLanceur = this.deps.etatLanceur();
    const infos = COMPTES.map((c) => ({ c, i: infosCompte(c) }));
    const tousConnectes = infos.every((x) => x.i.connecte);
    let banniere: string | undefined;
    if (etatLanceur === "autre") {
      banniere = "Un autre lanceur est déjà réglé dans Claude Code (réglage « claudeProcessWrapper »). Rien n'a été changé : les comptes par fenêtre sont en pause.";
    } else if (etatLanceur === "libre") {
      banniere = tousConnectes
        ? "Comptes Claude est désactivé : Claude utilise la connexion d'origine."
        : "Pas encore actif : il faut d'abord connecter les deux comptes (bouton « Se connecter » ci-dessous). Tant que ce n'est pas fait, Claude garde sa connexion d'origine.";
    }
    const comptes: CarteCompte[] = infos.map(({ c, i }) => {
      const q = i.connecte ? derniersQuotas(c) : undefined;
      const barres: Barre[] = [];
      if (q?.cinqHeures) barres.push(barre("5 h", q.cinqHeures));
      if (q?.semaine) barres.push(barre("Semaine", q.semaine));
      return {
        compte: c,
        email: i.email,
        connecte: i.connecte,
        plan: q?.plan,
        fenetre: etatLanceur === "actif" && c === this.deps.compteFenetre(),
        barres,
        maj: q && barres.length ? phraseMaj(q, maintenant) : undefined,
        indisponible: i.connecte && barres.length === 0,
      };
    });
    const vivantes = await conversationsVivantes();
    const ligne = (c: { id: string; titre: string; compte?: Compte; maj: number; ouverte: boolean }): LigneConversation => ({
      id: c.id,
      titre: c.titre,
      compte: c.compte,
      age: ageTexte(c.maj, maintenant),
      ouverte: c.ouverte,
    });
    const dossier = this.deps.dossierProjet();
    return {
      banniere,
      peutActiver: etatLanceur === "libre" && tousConnectes,
      comptes,
      ouvertes: conversationsOuvertes(vivantes).map(ligne),
      recentes: dossier ? conversationsRecentes(dossier, vivantes).map(ligne) : [],
      aDossier: Boolean(dossier),
      relais: dossier ? listerNotes(dossier, 3) : [],
    };
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString("base64");
    const csp = `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'`;
    return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:8px 10px;}
h2{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--vscode-descriptionForeground);margin:18px 0 6px;font-weight:600;}
.carte{border:1px solid var(--vscode-panel-border,var(--vscode-widget-border,#8884));border-radius:6px;padding:8px 10px;margin-bottom:8px;background:var(--vscode-sideBar-background);}
.carte.ici{border-color:var(--vscode-focusBorder);}
.tete{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;}
.nom{font-weight:600;}
.petit{font-size:11px;color:var(--vscode-descriptionForeground);word-break:break-all;}
.badge{font-size:10px;padding:1px 6px;border-radius:8px;background:var(--vscode-badge-background);color:var(--vscode-badge-foreground);}
.barre{margin-top:8px;}
.ligne{display:flex;justify-content:space-between;gap:8px;font-size:12px;}
.piste{height:6px;border-radius:3px;background:var(--vscode-progressBar-background,#8883);background:color-mix(in srgb,var(--vscode-foreground) 15%,transparent);margin-top:3px;overflow:hidden;}
.rempli{height:100%;border-radius:3px;}
.normal{background:var(--vscode-charts-blue);}.attention{background:var(--vscode-charts-yellow);}.critique{background:var(--vscode-charts-red);}
.actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;}
button{font-family:inherit;font-size:12px;padding:3px 9px;border:none;border-radius:3px;cursor:pointer;color:var(--vscode-button-foreground);background:var(--vscode-button-background);}
button:hover{background:var(--vscode-button-hoverBackground);}
button.second{color:var(--vscode-button-secondaryForeground);background:var(--vscode-button-secondaryBackground);}
button.second:hover{background:var(--vscode-button-secondaryHoverBackground);}
button:focus-visible{outline:1px solid var(--vscode-focusBorder);outline-offset:1px;}
.banniere{border-left:3px solid var(--vscode-charts-yellow);padding:6px 8px;background:var(--vscode-textBlockQuote-background);font-size:12px;margin-bottom:8px;}
.conv{padding:6px 0;border-bottom:1px solid var(--vscode-panel-border,#8883);}
.conv .titre{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.pastille{display:inline-block;min-width:16px;text-align:center;font-size:10px;font-weight:700;border-radius:8px;padding:1px 5px;margin-right:6px;color:#fff;background:#6b7280;}
.pastille.A{background:#3b82f6;}.pastille.B{background:#a855f7;}
.vide{font-size:12px;color:var(--vscode-descriptionForeground);}
</style></head>
<body><div id="racine"><p class="vide">Chargement…</p></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const racine = document.getElementById('racine');
function el(tag, cls, texte) { const e = document.createElement(tag); if (cls) e.className = cls; if (texte !== undefined) e.textContent = texte; return e; }
function bouton(texte, msg, second) {
  const b = el('button', second ? 'second' : '', texte);
  b.addEventListener('click', () => vscode.postMessage(msg));
  return b;
}
function carte(c) {
  const d = el('div', 'carte' + (c.fenetre ? ' ici' : ''));
  const tete = el('div', 'tete');
  tete.appendChild(el('span', 'nom', 'Compte ' + c.compte));
  if (c.fenetre) tete.appendChild(el('span', 'badge', 'cette fenêtre'));
  if (c.plan) tete.appendChild(el('span', 'petit', c.plan));
  d.appendChild(tete);
  if (c.email) d.appendChild(el('div', 'petit', c.email));
  if (!c.connecte) d.appendChild(el('div', 'vide', 'Pas encore connecté.'));
  for (const b of c.barres) {
    const x = el('div', 'barre');
    const l = el('div', 'ligne');
    l.appendChild(el('span', '', b.nom));
    l.appendChild(el('span', '', b.texte));
    x.appendChild(l);
    const p = el('div', 'piste');
    p.setAttribute('role', 'progressbar');
    p.setAttribute('aria-label', b.nom + ' : ' + b.texte);
    p.setAttribute('aria-valuenow', String(Math.round(b.pct)));
    const r = el('div', 'rempli ' + b.niveau);
    r.style.width = b.pct + '%';
    p.appendChild(r);
    x.appendChild(p);
    d.appendChild(x);
  }
  if (c.maj) d.appendChild(el('div', 'petit', c.maj));
  if (c.indisponible) d.appendChild(el('div', 'vide', 'Quotas indisponibles'));
  const a = el('div', 'actions');
  if (c.connecte && !c.fenetre) a.appendChild(bouton('Utiliser dans cette fenêtre', { action: 'utiliser', compte: c.compte }));
  if (!c.connecte) a.appendChild(bouton('Se connecter', { action: 'connecter', compte: c.compte }));
  if (a.childNodes.length) d.appendChild(a);
  return d;
}
function pastille(compte) { return el('span', 'pastille ' + (compte || ''), compte || '?'); }
function conv(c, avecBoutons) {
  const d = el('div', 'conv');
  const t = el('div', 'titre');
  t.title = c.titre;
  t.appendChild(pastille(c.compte));
  t.appendChild(document.createTextNode(c.titre));
  d.appendChild(t);
  d.appendChild(el('div', 'petit', c.age + (avecBoutons && c.ouverte ? ' · ouverte' : '')));
  if (avecBoutons) {
    const a = el('div', 'actions');
    for (const k of ['A', 'B']) {
      const ici = c.compte === k;
      a.appendChild(bouton(ici ? 'Rouvrir' : 'Reprendre sur ' + k, { action: 'reprendre', id: c.id, compte: k }, ici));
    }
    d.appendChild(a);
  }
  return d;
}
function note(n) {
  const d = el('div', 'conv');
  const t = el('div', 'titre', n.titre);
  t.title = n.titre;
  d.appendChild(t);
  d.appendChild(el('div', 'petit', n.date));
  const a = el('div', 'actions');
  a.appendChild(bouton('Ouvrir', { action: 'ouvrirRelais', note: n.nom }, true));
  for (const k of ['A', 'B']) a.appendChild(bouton('Reprendre sur ' + k, { action: 'reprendreRelais', compte: k, note: n.nom }));
  d.appendChild(a);
  return d;
}
function rendre(e) {
  racine.textContent = '';
  if (e.banniere) {
    const b = el('div', 'banniere', e.banniere);
    if (e.peutActiver) { const a = el('div', 'actions'); a.appendChild(bouton('Activer', { action: 'activer' })); b.appendChild(a); }
    racine.appendChild(b);
  }
  for (const c of e.comptes) racine.appendChild(carte(c));
  const g = el('div', 'actions');
  g.appendChild(bouton('Actualiser les quotas', { action: 'actualiser' }, true));
  racine.appendChild(g);
  racine.appendChild(el('h2', '', 'Conversations ouvertes'));
  if (!e.ouvertes.length) racine.appendChild(el('div', 'vide', 'Aucune conversation ouverte.'));
  for (const c of e.ouvertes) racine.appendChild(conv(c, false));
  racine.appendChild(el('h2', '', 'Conversations récentes de ce projet'));
  if (!e.aDossier) racine.appendChild(el('div', 'vide', 'Aucun dossier ouvert dans cette fenêtre.'));
  else if (!e.recentes.length) racine.appendChild(el('div', 'vide', 'Aucune conversation pour ce projet.'));
  for (const c of e.recentes) racine.appendChild(conv(c, true));
  racine.appendChild(el('h2', '', 'Relais'));
  if (!e.relais.length) racine.appendChild(el('div', 'vide', 'Aucune note de relais pour ce projet. Tapez /relais dans une conversation pour en écrire une.'));
  for (const n of e.relais) racine.appendChild(note(n));
}
window.addEventListener('message', (ev) => { if (ev.data && ev.data.type === 'etat') rendre(ev.data.etat); });
vscode.postMessage({ action: 'pret' });
</script></body></html>`;
  }
}

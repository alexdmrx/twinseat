// Registre « conversation → compte » (écrit par le lanceur et par
// « Reprendre sur… »), conversations ouvertes et récentes. Sans vscode.
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { base, cleProjetClaude, cleProjetLanceur, Compte, estCompte, estNumeroConversation, sousDossier } from "./chemins";

export function lireCompte(id: string, home = os.homedir()): Compte | undefined {
  if (!estNumeroConversation(id)) return undefined;
  try {
    const v = fs.readFileSync(path.join(sousDossier.registre(home), id), "utf8").trim();
    return estCompte(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function ecrireCompte(id: string, c: Compte, home = os.homedir()): void {
  if (!estNumeroConversation(id)) throw new Error("numéro de conversation invalide");
  const dossier = sousDossier.registre(home);
  fs.mkdirSync(dossier, { recursive: true });
  const tmp = path.join(dossier, `.${id}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${c}\n`);
  fs.renameSync(tmp, path.join(dossier, id));
}

/** Numéros des conversations dont un processus Claude tourne : id → pid. */
export function conversationsVivantes(): Promise<Map<string, number>> {
  return new Promise((resolve) => {
    execFile("/bin/ps", ["-axo", "pid=,args="], { maxBuffer: 8 * 1024 * 1024 }, (err, sortie) => {
      const vivantes = new Map<string, number>();
      if (err) return resolve(vivantes);
      for (const ligne of sortie.split("\n")) {
        if (!ligne.includes("stream-json")) continue;
        const m = /--(?:session-id|resume)[= ]([0-9a-fA-F-]{8,64})/.exec(ligne);
        const pid = Number.parseInt(ligne.trim(), 10);
        if (m && Number.isFinite(pid)) vivantes.set(m[1], pid);
      }
      resolve(vivantes);
    });
  });
}

/** Fichier d'historique d'une conversation, où qu'il soit (mis en cache). */
const historiques = new Map<string, string>();
export function trouverHistorique(id: string, home = os.homedir()): string | undefined {
  if (!estNumeroConversation(id)) return undefined;
  const connu = historiques.get(id);
  if (connu && fs.existsSync(connu)) return connu;
  const racine = path.join(base(home), "projects");
  let dossiers: string[];
  try {
    dossiers = fs.readdirSync(racine);
  } catch {
    return undefined;
  }
  for (const d of dossiers) {
    const f = path.join(racine, d, `${id}.jsonl`);
    if (fs.existsSync(f)) {
      historiques.set(id, f);
      return f;
    }
  }
  return undefined;
}

/** Tous les numéros qui ont un historique, en une seule passe. */
export function numerosAvecHistorique(home = os.homedir()): Set<string> {
  const ids = new Set<string>();
  const racine = path.join(base(home), "projects");
  let dossiers: string[] = [];
  try {
    dossiers = fs.readdirSync(racine);
  } catch {
    return ids;
  }
  for (const d of dossiers) {
    try {
      for (const f of fs.readdirSync(path.join(racine, d))) if (f.endsWith(".jsonl")) ids.add(f.slice(0, -6));
    } catch {
      // pas un dossier
    }
  }
  return ids;
}

/** Titre d'une conversation : dernier titre choisi, sinon dernier titre auto. */
export function titreConversation(fichier: string): string | undefined {
  let texte: string;
  try {
    const fd = fs.openSync(fichier, "r");
    try {
      const taille = fs.fstatSync(fd).size;
      const lu = Math.min(taille, 256 * 1024);
      const buf = Buffer.alloc(lu);
      fs.readSync(fd, buf, 0, lu, taille - lu);
      texte = buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
  let auto: string | undefined;
  let choisi: string | undefined;
  for (const ligne of texte.split("\n")) {
    if (!ligne.includes("title")) continue;
    try {
      const o = JSON.parse(ligne) as { type?: string; aiTitle?: unknown; customTitle?: unknown };
      if (o.type === "ai-title" && typeof o.aiTitle === "string") auto = o.aiTitle;
      if (o.type === "custom-title" && typeof o.customTitle === "string") choisi = o.customTitle;
    } catch {
      // ligne tronquée en tête de lecture : ignorée
    }
  }
  return choisi ?? auto;
}

export interface Conversation {
  id: string;
  titre: string;
  maj: number;
  compte?: Compte;
  ouverte: boolean;
}

/** Les n conversations les plus récentes d'un projet. */
export function conversationsRecentes(
  dossierProjet: string,
  vivantes: Map<string, number>,
  n = 5,
  home = os.homedir(),
): Conversation[] {
  const dossier = path.join(base(home), "projects", cleProjetClaude(dossierProjet));
  let fichiers: { id: string; f: string; maj: number }[];
  try {
    fichiers = fs
      .readdirSync(dossier)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const p = path.join(dossier, f);
        return { id: f.slice(0, -6), f: p, maj: fs.statSync(p).mtimeMs };
      });
  } catch {
    return [];
  }
  return fichiers
    .filter((x) => estNumeroConversation(x.id))
    .sort((a, b) => b.maj - a.maj)
    .slice(0, n)
    .map((x) => ({
      id: x.id,
      titre: titreConversation(x.f) ?? "Conversation sans titre",
      maj: x.maj,
      compte: lireCompte(x.id, home),
      ouverte: vivantes.has(x.id),
    }));
}

/** Conversations ouvertes (processus vivant), tous projets confondus. */
export function conversationsOuvertes(vivantes: Map<string, number>, home = os.homedir()): Conversation[] {
  const liste: Conversation[] = [];
  for (const id of vivantes.keys()) {
    const f = trouverHistorique(id, home);
    if (!f) continue; // onglet neuf sans message : pas encore d'historique
    liste.push({
      id,
      titre: titreConversation(f) ?? "Conversation sans titre",
      maj: fs.statSync(f).mtimeMs,
      compte: lireCompte(id, home),
      ouverte: true,
    });
  }
  return liste.sort((a, b) => b.maj - a.maj);
}

/** Retire du registre les numéros sans historique de plus de 2 jours. */
export function nettoyerRegistre(home = os.homedir()): number {
  const dossier = sousDossier.registre(home);
  let noms: string[];
  try {
    noms = fs.readdirSync(dossier);
  } catch {
    return 0;
  }
  const limite = Date.now() - 2 * 24 * 3600 * 1000;
  const vieux = noms.filter((id) => {
    if (!estNumeroConversation(id)) return false;
    try {
      return fs.statSync(path.join(dossier, id)).mtimeMs < limite;
    } catch {
      return false;
    }
  });
  if (!vieux.length) return 0;
  const avecHistorique = numerosAvecHistorique(home);
  let retires = 0;
  for (const id of vieux) {
    if (avecHistorique.has(id)) continue;
    try {
      fs.unlinkSync(path.join(dossier, id));
      retires++;
    } catch {
      // déjà retiré par une autre fenêtre
    }
  }
  return retires;
}

/** Titre tel qu'affiché par l'onglet Claude (25 caractères + « … »). */
export function titreOnglet(titre: string): string {
  return titre.length > 25 ? `${titre.slice(0, 25)}…` : titre;
}

/** Compte mémorisé pour un projet (fichier lu par le lanceur). */
export function lireCompteProjet(dossier: string, home = os.homedir()): Compte | undefined {
  try {
    const v = fs.readFileSync(path.join(sousDossier.projets(home), cleProjetLanceur(dossier)), "utf8").trim();
    return estCompte(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function ecrireCompteProjet(dossier: string, c: Compte, home = os.homedir()): void {
  const rep = sousDossier.projets(home);
  fs.mkdirSync(rep, { recursive: true });
  const cle = cleProjetLanceur(dossier);
  const tmp = path.join(rep, `.${cle.slice(-60)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${c}\n`);
  fs.renameSync(tmp, path.join(rep, cle));
}

// Notes de relais (/relais) et longueur de conversation. Sans vscode : testable.
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { base, cleProjetClaude } from "./chemins";

export const SEUIL_CONTEXTE = 160_000;
const LECTURE_MAX = 256 * 1024;

/**
 * Racine du dépôt PRINCIPAL, même depuis un sous-dossier ou un dossier de travail
 * git (worktree) : la même que celle de bin/dossier-relais, qui écrit les notes.
 * Hors dépôt git : le dossier tel quel. Calculée une fois par dossier.
 */
const racines = new Map<string, string>();
export function racineProjet(dossier: string): string {
  const connue = racines.get(dossier);
  if (connue) return connue;
  let racine = dossier;
  try {
    const sortie = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], {
      cwd: dossier,
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (sortie.endsWith("/.git")) racine = sortie.slice(0, -5);
  } catch {
    // pas un dépôt git (ou git absent) : le dossier lui-même
  }
  racines.set(dossier, racine);
  return racine;
}

/** Dossier des notes d'un projet : ~/.claude/relais/<slug de la racine>/. */
export function dossierRelais(dossierProjet: string, home = os.homedir()): string {
  return path.join(base(home), "relais", cleProjetClaude(racineProjet(dossierProjet)));
}

/** Nom de note accepté, rien d'autre (jamais un chemin). */
export function estNomNote(nom: unknown): nom is string {
  return typeof nom === "string" && /^\d{4}-\d{2}-\d{2}-\d{4}\.md$/.test(nom);
}

const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « 2026-10-07-1405.md » → « 7 oct. 14 h 05 » (undefined si le nom est invalide). */
export function dateNote(nom: string): string | undefined {
  const m = /^\d{4}-(\d{2})-(\d{2})-(\d{2})(\d{2})\.md$/.exec(nom);
  if (!m) return undefined;
  const mois = Number(m[1]);
  if (mois < 1 || mois > 12) return undefined;
  return `${Number(m[2])} ${MOIS[mois - 1]} ${Number(m[3])} h ${m[4]}`;
}

/** « # Relais — <titre> — <date> » → « <titre> » ; repli : le nom de fichier. */
export function titreNote(premiereLigne: string | undefined, nom: string): string {
  let t = (premiereLigne ?? "").replace(/^﻿/, "").trim();
  if (!t.startsWith("# Relais")) return nom;
  t = t.replace(/^#\s*Relais\s*[—-]\s*/, "");
  const i = t.lastIndexOf(" — ");
  if (i > 0 && /^\d/.test(t.slice(i + 3).trim())) t = t.slice(0, i);
  t = t.trim();
  return t && t !== "# Relais" ? t : nom;
}

export interface NoteRelais {
  nom: string;
  titre: string;
  date: string;
}

/** Les n notes les plus récentes (nom décroissant). Dossier absent = liste vide. */
export function listerNotes(dossierProjet: string, n = 3, home = os.homedir()): NoteRelais[] {
  const dossier = dossierRelais(dossierProjet, home);
  let noms: string[];
  try {
    noms = fs.readdirSync(dossier).filter(estNomNote).sort().reverse().slice(0, n);
  } catch {
    return [];
  }
  return noms.map((nom) => {
    let premiere: string | undefined;
    try {
      const fd = fs.openSync(path.join(dossier, nom), "r");
      try {
        const buf = Buffer.alloc(2048);
        const lu = fs.readSync(fd, buf, 0, buf.length, 0);
        premiere = buf.toString("utf8", 0, lu).split("\n", 1)[0];
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      // illisible : repli sur le nom
    }
    return { nom, titre: titreNote(premiere, nom), date: dateNote(nom) ?? nom };
  });
}

/** Chemin d'une note, seulement si le nom est valide. */
export function cheminNote(dossierProjet: string, nom: unknown, home = os.homedir()): string | undefined {
  return estNomNote(nom) ? path.join(dossierRelais(dossierProjet, home), nom) : undefined;
}

/**
 * Jetons de contexte du DERNIER message d'assistant qui a un `usage` dans la fin
 * d'un historique (input + cache lu + cache créé). La première ligne peut être
 * tronquée : ignorée. undefined si aucun.
 */
export function jetonsContexte(texteFin: string): number | undefined {
  const lignes = texteFin.split("\n");
  for (let i = lignes.length - 1; i >= 0; i--) {
    const l = lignes[i];
    if (!l.includes('"usage"')) continue;
    try {
      const o = JSON.parse(l) as { type?: unknown; message?: { usage?: Record<string, unknown> } };
      const u = o.message?.usage;
      if (o.type !== "assistant" || !u || typeof u !== "object") continue;
      const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
      return n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens);
    } catch {
      // ligne tronquée ou illisible : on remonte
    }
  }
  return undefined;
}

/** Fin d'un fichier (≤ 256 Ko). */
export function lireFin(fichier: string): string | undefined {
  try {
    const fd = fs.openSync(fichier, "r");
    try {
      const taille = fs.fstatSync(fd).size;
      const lu = Math.min(taille, LECTURE_MAX);
      const buf = Buffer.alloc(lu);
      fs.readSync(fd, buf, 0, lu, taille - lu);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

export function dossierAlertesContexte(home = os.homedir()): string {
  return path.join(base(home), "comptes", "alertes-contexte");
}

/** true = première fois (marqueur créé), false = déjà signalée ou erreur. */
export function marquerAlerteContexte(id: string, home = os.homedir()): boolean {
  if (!/^[0-9a-fA-F-]{8,64}$/.test(id)) return false;
  const dossier = dossierAlertesContexte(home);
  try {
    fs.mkdirSync(dossier, { recursive: true });
    fs.writeFileSync(path.join(dossier, id), `${new Date().toISOString()}\n`, { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

/** Retire les marqueurs de plus de 7 jours. */
export function nettoyerAlertesContexte(home = os.homedir()): number {
  const dossier = dossierAlertesContexte(home);
  let noms: string[];
  try {
    noms = fs.readdirSync(dossier);
  } catch {
    return 0;
  }
  const limite = Date.now() - 7 * 24 * 3600 * 1000;
  let n = 0;
  for (const nom of noms) {
    try {
      const f = path.join(dossier, nom);
      if (fs.statSync(f).mtimeMs < limite) {
        fs.unlinkSync(f);
        n++;
      }
    } catch {
      // déjà retiré
    }
  }
  return n;
}

/** « 165 000 » (≈ arrondi au millier, espace insécable fine). */
export function jetonsTexte(n: number): string {
  return (Math.round(n / 1000) * 1000).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

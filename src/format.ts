// Mise en forme des quotas et appariement des onglets. Sans vscode : testable.
import { Compte } from "./chemins";
import { Quotas } from "./quotas";
import { titreOnglet } from "./registre";

export type Niveau = "normal" | "attention" | "critique";

/** < 70 % normal, 70–89 % attention, ≥ 90 % critique. */
export function niveau(pct: number): Niveau {
  return pct >= 90 ? "critique" : pct >= 70 ? "attention" : "normal";
}

export const VARIABLE_NIVEAU: Record<Niveau, string> = {
  normal: "--vscode-charts-blue",
  attention: "--vscode-charts-yellow",
  critique: "--vscode-charts-red",
};

export function pourcent(pct: number): string {
  return `${Math.round(pct)} %`;
}

const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

/** « à 16 h 39 », « demain à 9 h 05 », « lundi à 16 h 39 » (heure locale). Rien si passé. */
export function momentLocal(iso: string, maintenant = Date.now()): string | undefined {
  const t = Date.parse(iso);
  if (!Number.isFinite(t) || t <= maintenant) return undefined;
  const d = new Date(t);
  const n = new Date(maintenant);
  const h = `${d.getHours()} h ${String(d.getMinutes()).padStart(2, "0")}`;
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(d) - jour(n)) / 86_400_000);
  if (ecart <= 0) return `à ${h}`;
  if (ecart === 1) return `demain à ${h}`;
  if (ecart < 7) return `${JOURS[d.getDay()]} à ${h}`;
  return `le ${d.getDate()}/${d.getMonth() + 1} à ${h}`;
}

export function phraseRetour(iso: string | undefined, maintenant = Date.now()): string | undefined {
  const m = iso ? momentLocal(iso, maintenant) : undefined;
  return m ? `retour à zéro ${m}` : undefined;
}

/** « il y a 2 min » */
export function ageTexte(ms: number, maintenant = Date.now()): string {
  const s = Math.max(0, Math.round((maintenant - ms) / 1000));
  if (s < 60) return "à l'instant";
  const min = Math.round(s / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

export function phraseMaj(q: Quotas, maintenant = Date.now()): string {
  const age = ageTexte(q.majLe, maintenant);
  if (q.source === "cache") {
    return age === "à l'instant" ? "chiffres à l'instant (mémoire de Claude)" : `chiffres d'${age} (mémoire de Claude)`;
  }
  return `mis à jour ${age}`;
}

/** « 5 h : 62 % · semaine : 26 % » */
export function libelleQuota(q: Quotas | undefined): string {
  if (!q) return "quotas pas encore relevés";
  const morceaux: string[] = [];
  if (q.cinqHeures) morceaux.push(`5 h : ${pourcent(q.cinqHeures.pct)}`);
  if (q.semaine) morceaux.push(`semaine : ${pourcent(q.semaine.pct)}`);
  return morceaux.length ? morceaux.join(" · ") : "quotas indisponibles";
}

/** « Le compte A est à 92 % (limite de 5 h, retour à zéro à 16 h 39). » */
export function phraseAlerte(c: Compte, pct: number, limite: "5 h" | "semaine", reset?: string, maintenant = Date.now()): string {
  const nom = limite === "5 h" ? "limite de 5 h" : "limite de la semaine";
  const retour = phraseRetour(reset, maintenant);
  return `Le compte ${c} est à ${Math.round(pct)} % (${nom}${retour ? `, ${retour}` : ""}).`;
}

function normaliser(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Compte d'un onglet Claude d'après son titre. Seul un appariement sans
 * ambiguïté compte (une ou plusieurs conversations de même titre ET même
 * compte). Sinon : undefined → l'appelant prend le compte de la fenêtre.
 */
export function compteDepuisOnglet(label: string, conversations: { titre: string; compte?: Compte }[]): Compte | undefined {
  const l = normaliser(label);
  if (!l || l === "Claude Code") return undefined;
  const trouves = new Set<Compte | "?">();
  for (const c of conversations) {
    if (normaliser(titreOnglet(c.titre)) === l) trouves.add(c.compte ?? "?");
  }
  if (trouves.size !== 1) return undefined;
  const v = [...trouves][0];
  return v === "?" ? undefined : v;
}

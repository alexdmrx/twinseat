// Mise en forme des quotas et appariement des onglets. Sans vscode : testable.
import { Compte } from "./chemins";
import { Quotas } from "./quotas";
import { titreOnglet } from "./registre";
import { heure, liste, t } from "./textes";

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

/** « 62 % » (fr) ou « 62% » (en). */
export function pourcent(pct: number): string {
  return t("fmt.pourcent", { n: Math.round(pct) });
}

/** « at 16:39 », « tomorrow at 09:05 », « Monday at 16:39 » (en) ; « à 16 h 39 », « demain à 9 h 05 » (fr). Heure locale. Rien si passé. */
export function momentLocal(iso: string, maintenant = Date.now()): string | undefined {
  const instant = Date.parse(iso);
  if (!Number.isFinite(instant) || instant <= maintenant) return undefined;
  const d = new Date(instant);
  const n = new Date(maintenant);
  const h = heure(d.getHours(), d.getMinutes());
  const jour = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ecart = Math.round((jour(d) - jour(n)) / 86_400_000);
  if (ecart <= 0) return t("moment.aujourdhui", { heure: h });
  if (ecart === 1) return t("moment.demain", { heure: h });
  if (ecart < 7) return t("moment.jour", { jour: liste("jours")[d.getDay()], heure: h });
  return t("moment.date", { jour: d.getDate(), mois: liste("mois")[d.getMonth()], heure: h });
}

export function phraseRetour(iso: string | undefined, maintenant = Date.now()): string | undefined {
  const m = iso ? momentLocal(iso, maintenant) : undefined;
  return m ? t("retour", { moment: m }) : undefined;
}

/** Âge d'un instant : « just now », « 2 min ago » (en) ; « à l'instant », « il y a 2 min » (fr). */
function age(ms: number, maintenant: number): { texte: string; instant: boolean } {
  const s = Math.max(0, Math.round((maintenant - ms) / 1000));
  if (s < 60) return { texte: t("age.instant"), instant: true };
  const min = Math.round(s / 60);
  if (min < 60) return { texte: t("age.min", { n: min }), instant: false };
  const h = Math.round(min / 60);
  if (h < 24) return { texte: t("age.h", { n: h }), instant: false };
  return { texte: t("age.j", { n: Math.round(h / 24) }), instant: false };
}

export function ageTexte(ms: number, maintenant = Date.now()): string {
  return age(ms, maintenant).texte;
}

/** « updated 2 min ago » ; chiffres de la mémoire de Claude : « from Claude's cache, 3 h ago ». */
export function phraseMaj(q: Quotas, maintenant = Date.now()): string {
  const a = age(q.majLe, maintenant);
  if (q.source === "cache") return a.instant ? t("maj.cacheInstant") : t("maj.cache", { age: a.texte });
  return t("maj.direct", { age: a.texte });
}

/** « 5-hour: 62% · week: 26% » */
export function libelleQuota(q: Quotas | undefined): string {
  if (!q) return t("quota.absent");
  const morceaux: string[] = [];
  if (q.cinqHeures) morceaux.push(t("quota.cinqHeures", { pct: pourcent(q.cinqHeures.pct) }));
  if (q.semaine) morceaux.push(t("quota.semaine", { pct: pourcent(q.semaine.pct) }));
  return morceaux.length ? morceaux.join(" · ") : t("quota.indisponible");
}

/** « Account A is at 92% (5-hour limit, resets at 16:39). » `compte` = le libellé du compte : « A » ou son nom. */
export function phraseAlerte(compte: string, pct: number, limite: "5 h" | "semaine", reset?: string, maintenant = Date.now()): string {
  const nom = t(limite === "5 h" ? "alerte.limite5h" : "alerte.limiteSemaine");
  const retour = phraseRetour(reset, maintenant);
  return t("alerte.phrase", { compte, pct: pourcent(pct), limite: nom, retour: retour ? `, ${retour}` : "" });
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

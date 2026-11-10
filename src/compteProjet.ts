// Quel compte pour ce projet ? Sans vscode : testable avec node seul.
//
// Ordre : réglage `twinseat.account` du projet (s'il désigne un compte), puis le
// dernier compte mémorisé pour ce projet, puis A. Seul le troisième cas « n'a pas
// d'avis » : c'est lui, et lui seul, qui justifie d'ouvrir le menu des comptes.
import { Compte } from "./chemins";
import { compteDepuisNom, Etiquettes, libelle } from "./etiquettes";
import { t } from "./textes";

export type SourceCompte = "project-setting" | "remembered" | "default";

export interface ResolutionCompte {
  compte: Compte;
  source: SourceCompte;
  /** Valeur du réglage qui ne désigne aucun compte : ignorée, à signaler une fois. */
  valeurIgnoree?: string;
}

const LONGUEUR_VALEUR = 40;

/** Une valeur de réglage lisible dans un message : une ligne, 40 caractères au plus. */
function apercu(v: unknown): string {
  let texte: string;
  if (typeof v === "string") texte = v;
  else {
    try {
      texte = JSON.stringify(v) ?? String(v);
    } catch {
      texte = String(v);
    }
  }
  const plat = texte.replace(/\s+/g, " ").trim();
  const signes = [...plat];
  return signes.length > LONGUEUR_VALEUR ? `${signes.slice(0, LONGUEUR_VALEUR).join("")}…` : plat;
}

/**
 * @param reglage valeur brute de `twinseat.account` pour le dossier (n'importe quoi)
 * @param etiquettes étiquettes valides (voir `etiquettesValides`)
 * @param memoire compte mémorisé pour ce projet, s'il y en a un
 */
export function resoudreCompte(reglage: unknown, etiquettes: Etiquettes, memoire: Compte | undefined): ResolutionCompte {
  const absent = reglage === undefined || reglage === null || (typeof reglage === "string" && reglage.trim() === "");
  if (!absent) {
    const compte = compteDepuisNom(reglage, etiquettes);
    if (compte) return { compte, source: "project-setting" };
  }
  const base: ResolutionCompte = memoire ? { compte: memoire, source: "remembered" } : { compte: "A", source: "default" };
  return absent ? base : { ...base, valeurIgnoree: apercu(reglage) };
}

/**
 * Phrase qui dit d'où vient le compte de la fenêtre (infobulle de la barre d'état).
 * `courant` = le compte que la fenêtre utilise vraiment : s'il diffère de celui
 * du réglage, la fenêtre a été changée à la main pour cette session.
 */
export function texteOrigine(r: ResolutionCompte, courant: Compte, etiquettes: Etiquettes): string {
  if (r.source === "project-setting") {
    return r.compte === courant
      ? t("barre.origine.projet")
      : t("barre.origine.session", { compte: libelle(r.compte, etiquettes) });
  }
  return t(r.source === "remembered" ? "barre.origine.memoire" : "barre.origine.defaut");
}

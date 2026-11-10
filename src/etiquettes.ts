// Noms d'affichage des comptes (« work », « personal »…). Sans vscode : testable avec node seul.
//
// Un nom n'est qu'une ÉTIQUETTE posée sur l'emplacement « A » ou « B » : le lanceur,
// le registre, les chemins et les variables d'environnement ne voient jamais
// que la lettre. Un nom invalide ou absent retombe sur la lettre, sans erreur.
import { Compte, COMPTES, autreCompte } from "./chemins";
import { t } from "./textes";

/** Étiquettes valides seulement : un compte sans nom choisi n'a pas d'entrée. */
export type Etiquettes = Partial<Record<Compte, string>>;

export const LONGUEUR_MAX = 24;

export type ErreurEtiquette = "vide" | "longueur" | "caracteres" | "doublon";
export type Validation = { ok: true; etiquette: string } | { ok: false; erreur: ErreurEtiquette };

/** Lettres (et leurs accents combinants), chiffres, espace, « _ », « . », « - ». */
const CARACTERES_PERMIS = /^[\p{L}\p{M}\p{Nd} _.-]+$/u;

/** Forme de comparaison : accents composés, sans espaces autour. */
const nettoyer = (s: string): string => s.normalize("NFC").trim();

/** Même nom, sans tenir compte de la casse. */
function memeNom(a: string, b: string): boolean {
  return nettoyer(a).toLowerCase() === nettoyer(b).toLowerCase();
}

/**
 * Valide le nom proposé pour `compte`. `autre` = le nom choisi pour l'autre compte
 * (s'il en a un). Refus : vide, caractères interdits, plus de 24 caractères,
 * même nom (sans la casse) que l'autre compte ou que sa lettre.
 */
export function validerEtiquette(brut: unknown, compte: Compte, autre?: string): Validation {
  if (typeof brut !== "string") return { ok: false, erreur: "vide" };
  const nom = nettoyer(brut);
  if (!nom) return { ok: false, erreur: "vide" };
  if (!CARACTERES_PERMIS.test(nom)) return { ok: false, erreur: "caracteres" };
  if ([...nom].length > LONGUEUR_MAX) return { ok: false, erreur: "longueur" };
  if (memeNom(nom, autreCompte(compte)) || (autre !== undefined && memeNom(nom, autre))) {
    return { ok: false, erreur: "doublon" };
  }
  return { ok: true, etiquette: nom };
}

/**
 * Les étiquettes du réglage `twinseat.accountLabels`, sans rien de douteux :
 * tout ce qui n'est pas un objet donne {} ; un nom invalide est retiré ; si A et B
 * portent le même nom, A garde le sien et B retombe sur sa lettre.
 */
export function etiquettesValides(brut: unknown): Etiquettes {
  const resultat: Etiquettes = {};
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return resultat;
  for (const c of COMPTES) {
    const v = Object.prototype.hasOwnProperty.call(brut, c) ? (brut as Record<string, unknown>)[c] : undefined;
    const r = validerEtiquette(v, c, resultat[autreCompte(c)]);
    if (r.ok) resultat[c] = r.etiquette;
  }
  return resultat;
}

/** Ce que l'on écrit dans une phrase ou sur un bouton : le nom, sinon la lettre. */
export function libelle(c: Compte, etiquettes: Etiquettes): string {
  return etiquettes[c] ?? c;
}

/** Titre d'un compte (carte, menu) : le nom, sinon « Account A » / « Compte A ». */
export function titreCompte(c: Compte, etiquettes: Etiquettes): string {
  return etiquettes[c] ?? t("compte.nom", { compte: c });
}

/**
 * L'emplacement désigné par un nom (réglage du projet, par exemple) : une étiquette
 * (sans tenir compte de la casse) ou la lettre A / B. Rien si personne ne porte ce nom.
 */
export function compteDepuisNom(valeur: unknown, etiquettes: Etiquettes): Compte | undefined {
  if (typeof valeur !== "string") return undefined;
  const nom = nettoyer(valeur);
  if (!nom) return undefined;
  return COMPTES.find((c) => memeNom(nom, c) || (etiquettes[c] !== undefined && memeNom(nom, etiquettes[c] as string)));
}

/** Message d'erreur de saisie, dans la langue de VS Code. */
export function messageErreur(erreur: ErreurEtiquette): string {
  return t(`etiquette.erreur.${erreur}` as const);
}

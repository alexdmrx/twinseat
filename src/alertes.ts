// Les deux alertes de l'extension, composées sans vscode : le texte du message et les boutons proposés.
// extension.ts ne fait que les montrer et agir sur le bouton choisi. Les tests vérifient ici ce qui
// compte : aucun texte venu de l'extérieur n'entre tel quel dans un message (voir texteSur.ts), et le
// bouton « Copy /relais » n'est proposé que si l'utilisateur a la commande /relais.
import { Compte, autreCompte } from "./chemins";
import { Etiquettes, libelle } from "./etiquettes";
import { phraseAlerte } from "./format";
import { jetonsTexte } from "./relais";
import { t, tSur } from "./textes";
import { texteSur } from "./texteSur";

export type ActionAlerte = "basculer" | "voir" | "copierRelais";

export interface BoutonAlerte {
  action: ActionAlerte;
  texte: string;
}

export interface Alerte {
  message: string;
  boutons: BoutonAlerte[];
}

const LONGUEUR_TITRE = 80;

/**
 * Alerte « ce compte approche d'une limite ». `relais` : l'utilisateur a-t-il la commande /relais
 * (`commandesRelaisPresentes`) ? Sinon le bouton « Copy /relais » n'est pas proposé.
 */
export function alerteQuota(p: {
  compte: Compte;
  pct: number;
  limite: "5 h" | "semaine";
  reset?: string;
  etiquettes: Etiquettes;
  relais: boolean;
  maintenant?: number;
}): Alerte {
  const boutons: BoutonAlerte[] = [
    { action: "basculer", texte: tSur("alerte.basculer", { compte: libelle(autreCompte(p.compte), p.etiquettes) }) },
    { action: "voir", texte: t("alerte.voir") },
  ];
  if (p.relais) boutons.push({ action: "copierRelais", texte: t("relais.copier") });
  return { message: phraseAlerte(libelle(p.compte, p.etiquettes), p.pct, p.limite, p.reset, p.maintenant), boutons };
}

/**
 * Alerte « cette conversation est longue ». `titre` vient d'un fichier d'historique : texte sûr, 80
 * caractères au plus, « Untitled conversation » s'il ne reste rien. Le texte ne parle pas de /relais :
 * le bouton « Copy /relais » n'est là que si `relais` (l'utilisateur a la commande), sinon pas de bouton.
 */
export function alerteContexte(p: { titre?: string; jetons: number; relais: boolean }): Alerte {
  const titre = texteSur(p.titre, LONGUEUR_TITRE) || t("contexte.sansTitre");
  return {
    message: tSur("contexte.longue", { titre, jetons: jetonsTexte(p.jetons) }),
    boutons: p.relais ? [{ action: "copierRelais", texte: t("relais.copier") }] : [],
  };
}

// Texte « sûr » pour une notification ou un menu. Sans vscode, et sans aucun import : testable
// avec node seul, et utilisable par tous les modules (textes.ts compris).
//
// Pourquoi : VS Code transforme `[texte](command:…)`, `[texte](https://…)` et `[texte](file:…)`, écrits
// dans le texte d'une notification (showInformationMessage, showWarningMessage, showErrorMessage), en
// lien cliquable. Avec `command:`, un clic EXÉCUTE une commande de VS Code (par exemple envoyer du
// texte au terminal). Tout texte qui ne vient pas de nous (titre de conversation lu dans un
// historique, valeur d'un réglage, adresse lue dans un fichier) peut donc contenir un piège ; il passe
// par `texteSur` avant d'entrer dans un message, une étiquette, une description ou un détail de menu.
//
// Ce que fait `texteSur` :
//   1. les caractères de contrôle, sauts de ligne et tabulations deviennent des espaces ; les
//      caractères invisibles (zéro largeur, sens d'écriture) sont retirés, pour qu'ils ne cachent rien ;
//   2. « [ ] ( ) » deviennent leurs formes pleine chasse « ［ ］ （ ） » : presque identiques à
//      l'écran, mais plus du tout la syntaxe d'un lien (ni d'une icône `$(nom)`) ;
//   3. le « : » qui suit un schéma (`command`, `file`, `http`, `https`, `vscode`…) devient « ： », de
//      sorte que `command:`, `file:` ou `https://` n'apparaissent plus tels quels ;
//   4. le texte est coupé à `max` caractères (points de code, jamais au milieu d'un emoji), avec « … ».
// Un titre ordinaire reste lisible ; seuls les parenthèses et crochets changent de forme.

/** Longueur maximale par défaut, en caractères. */
export const LONGUEUR_TEXTE_SUR = 80;

const FORMES_SURES: Record<string, string> = { "[": "［", "]": "］", "(": "（", ")": "）" };

// Les schémas qu'un lien de notification saurait suivre (`command:`, `file:`, `http(s)://`), et ceux qui lancent
// quelque chose ailleurs (`vscode:`, `javascript:`). Un « : » collé à l'un d'eux, hors d'un mot plus long
// (« profile: » n'en est pas un), est remplacé. La liste est courte exprès : « Data: nettoyage » reste intact.
const SCHEMA = /(?<![\p{L}\p{N}_])(command|file|https?|vscode(?:-[a-z]+)?|javascript|vbscript)\s*:/giu;

/**
 * `valeur` rendue sûre pour un message, une étiquette, une description ou un détail.
 * `undefined` et `null` donnent « ». Idempotent : repasser le résultat dans `texteSur` ne le change pas.
 */
export function texteSur(valeur: unknown, max: number = LONGUEUR_TEXTE_SUR): string {
  if (valeur === undefined || valeur === null) return "";
  let s = typeof valeur === "string" ? valeur : String(valeur);
  s = s
    .replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, " ") // contrôles, sauts de ligne, tabulations, U+2028/2029
    .replace(/[\p{Cf}\p{Cs}]/gu, "") // invisibles (zéro largeur, sens d'écriture), demi-paires isolées
    .replace(/ {2,}/g, " ") // les espaces insécables (milliers en français) restent tels quels
    .trim()
    .replace(/[[\]()]/g, (c) => FORMES_SURES[c])
    .replace(SCHEMA, "$1：");
  const limite = Math.max(1, Math.floor(max));
  const signes = [...s];
  if (signes.length > limite) s = `${signes.slice(0, limite - 1).join("").trimEnd()}…`;
  return s;
}

/** Comme `texteSur`, mais `undefined` (ou un texte qui devient vide) reste `undefined` : pour les champs facultatifs d'un menu. */
export function texteSurOptionnel(valeur: string | undefined, max: number = LONGUEUR_TEXTE_SUR): string | undefined {
  const s = texteSur(valeur, max);
  return s === "" ? undefined : s;
}

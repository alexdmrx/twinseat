// Plateformes prises en charge par Twinseat. Aucun import de vscode : testable avec node seul.
//
// macOS et Linux : tout fonctionne. Partout ailleurs (Windows surtout), l'extension ne fait
// rien : elle montre un message et le même texte dans son panneau, sans toucher à ni fichier
// ni réglage. Le lanceur est un script POSIX qui s'appuie sur les outils du système : il n'a
// pas d'équivalent sous Windows.

export const PLATEFORMES_SUPPORTEES = ["darwin", "linux"] as const;
export type PlateformeSupportee = (typeof PLATEFORMES_SUPPORTEES)[number];

/** Twinseat fonctionne-t-il sur cette plateforme (valeur de `process.platform`) ? */
export function plateformeSupportee(plateforme: string = process.platform): plateforme is PlateformeSupportee {
  return (PLATEFORMES_SUPPORTEES as readonly string[]).includes(plateforme);
}

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Page du panneau sur une plateforme non prise en charge : le texte, rien d'autre
 * (ni script, ni bouton, ni lien). `langue` va dans l'attribut lang.
 */
export function pageNonSupportee(texte: string, langue: string): string {
  return `<!DOCTYPE html>
<html lang="${esc(langue)}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
body{font-family:var(--vscode-font-family);font-size:var(--vscode-font-size);color:var(--vscode-foreground);padding:8px 10px;}
.banniere{border-left:3px solid var(--vscode-charts-yellow);padding:6px 8px;background:var(--vscode-textBlockQuote-background);font-size:12px;}
</style></head>
<body><div class="banniere">${esc(texte)}</div></body></html>`;
}

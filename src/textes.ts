// Tous les textes visibles de Twinseat, en anglais (`en`) et en français (`fr`).
// Sans vscode : les modules du cœur (format, relais) et ceux de vscode s'en servent.
//
// - `en` définit les clés ; `fr` est un `Record<Cle, string>` : une clé qui manque
//   ou qui est en trop dans `fr` ne compile pas.
// - Les variables s'écrivent {nom} ; `t("clé", { nom: valeur })` les remplace.
// - Les listes (jours, mois) sont des textes séparés par « | » : `liste("clé")`.
// - Le nom du produit (« Twinseat ») ne se traduit pas.
// - Les textes de package.json (titres de commandes…) sont dans package.nls*.json.

export type Langue = "en" | "fr";
export type Variables = Record<string, string | number>;

export const en = {
  // --- Formats : nombres, heures, dates ---------------------------------------
  "fmt.pourcent": "{n}%",
  "fmt.heure": "{hh}:{mn}",
  "fmt.milliers": ",",
  "jours": "Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday",
  "mois": "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec",
  "moment.aujourdhui": "at {heure}",
  "moment.demain": "tomorrow at {heure}",
  "moment.jour": "{jour} at {heure}",
  "moment.date": "on {mois} {jour} at {heure}",
  "retour": "resets {moment}",
  "age.instant": "just now",
  "age.min": "{n} min ago",
  "age.h": "{n} h ago",
  "age.j": "{n} d ago",
  "maj.direct": "updated {age}",
  "maj.cache": "from Claude's cache, {age}",
  "maj.cacheInstant": "from Claude's cache, just now",
  "quota.cinqHeures": "5-hour: {pct}",
  "quota.semaine": "week: {pct}",
  "quota.indisponible": "usage unavailable",
  "quota.absent": "usage not read yet",
  "alerte.phrase": "Account “{compte}” is at {pct} ({limite}{retour}).",
  "alerte.limite5h": "5-hour limit",
  "alerte.limiteSemaine": "weekly limit",
  "note.date": "{mois} {jour}, {heure}",

  // --- Comptes, barre d'état, fenêtre -------------------------------------------
  "compte.nom": "Account {compte}",
  "barre.texte": "$(account) Claude: {compte}",
  "barre.infobulle": "Click to change this window's account",
  "barre.origine.projet": "Account: from this project's settings",
  "barre.origine.memoire": "Account: remembered for this project",
  "barre.origine.defaut": "Account: default",
  "barre.origine.session": "Account: chosen in this window (this project's settings say {compte})",
  "fenetre.terminal": "Twinseat: terminals follow this window's account.",
  "fenetre.change": "This window is now on account “{compte}”. Conversations that are already open keep their account.",
  "fenetre.changeProjet": "This window is now on account {compte} for this session. This project's settings say {projet}: that account applies again next time.",
  "fenetre.changerReglage": "Change project setting",
  "menu.titre": "Claude account for this window",
  "menu.placeholder": "Current account: {compte}",

  // --- Notifications -------------------------------------------------------------
  "rienChange": "Nothing was changed.",
  "lanceur.autre": "Another launcher is already set in Claude Code. Twinseat changed nothing.",
  "activer.connecterDabord": "Sign in to both accounts first (Twinseat panel).",
  "activer.ok": "Twinseat is on: each window now has its own account.",
  "activer.echec": "Couldn't set the launcher in VS Code settings.",
  "choisir.inactif": "Twinseat isn't on: sign in to both accounts, then click “Enable” in the panel.",
  "desactiver.ok": "Disabled: Claude uses its original sign-in again. The ~/.claude/comptes folders are left in place.",
  "relais.copier": "Copy /relais",
  "relais.copie": "“/relais” copied: paste it into the current conversation.",
  "alerte.basculer": "Switch this window to {compte}",
  "alerte.voir": "Show accounts",
  "releve.introuvable": "Claude Code not found: can't read usage.",
  "releve.enCours": "A usage read is already running in another window.",
  "contexte.longue": "The conversation “{titre}” is long (≈ {jetons} tokens). Consider /relais before it gets compacted.",
  "contexte.sansTitre": "Untitled conversation",
  "connecter.titre": "Which account do you want to sign in to?",
  "connecter.terminal": "Sign in to account “{compte}”",
  "connecter.introuvable": "Claude Code not found: can't start sign-in.",
  "connecter.navigateur": "Your browser will open: check that claude.ai is signed in to the right account (use a private window otherwise).",
  "reprendre.toujours": "Still open: nothing was changed.",
  "reprendre.fermer": "This conversation is still open in a tab. Close that tab, then click “Done”.",
  "reprendre.fait": "Done",
  "reprendre.ok": "Conversation reopened on account “{compte}”.",
  "relais.reprise": "New conversation on account “{compte}”: if “{texte}” isn't already typed, paste it (it's copied).",
  "relais.introuvable": "This handoff note can't be found.",

  // --- Noms des comptes et compte du projet ----------------------------------------
  "etiquette.erreur.vide": "Enter a name of 1 to 24 characters.",
  "etiquette.erreur.longueur": "Too long: 24 characters at most.",
  "etiquette.erreur.caracteres": "Use only letters, digits, spaces and the signs “_”, “.” and “-”.",
  "etiquette.erreur.doublon": "Already taken: that is the other account's name or letter.",
  "nommer.titre": "Name an account",
  "nommer.choisir": "Which account do you want to name?",
  "nommer.saisie": "Name for {compte}",
  "nommer.aide": "1 to 24 characters. Leave empty to go back to “{lettre}”.",
  "nommer.exemple": "work, personal…",
  "nommer.retour": "Empty: this account goes back to “{lettre}”.",
  "nommer.echec": "Couldn't save the name in your VS Code settings.",
  "projet.reglageInconnu": "The “twinseat.account” setting says “{valeur}”, which isn't the name of an account, so it is ignored. Use A, B, or a name given with “Twinseat: Name an account…”.",
  "projet.pasDeDossier": "Open a folder first: the project's account is saved in that folder's settings.",
  "projet.epingle": "This project now uses account “{compte}” (“twinseat.account” saved in .vscode/settings.json).",
  "projet.echec": "Couldn't write “twinseat.account” in this folder's settings.",

  // --- Plateforme non prise en charge (message et panneau) -----------------------------
  "plateforme.nonSupportee": "Twinseat supports macOS and Linux only. On this system it stays inactive and changes nothing.",

  // --- Alias de shell -------------------------------------------------------------
  "alias.confirmer": "Add the claude-a and claude-b aliases to {fichier}?",
  "alias.ajouter": "Add aliases",
  "alias.ajoutes": "Added the claude-a and claude-b aliases to {fichier}. Open a new terminal to use them.",
  "alias.dejaLa": "The claude-a and claude-b aliases are already in {fichier}. Nothing was changed.",
  "alias.shellInconnu": "Twinseat can only edit the startup file of zsh or bash. Your shell is neither, so nothing was written. The two alias lines are copied to your clipboard: paste them into your shell's startup file.",
  "alias.echec": "Couldn't write to {fichier}.",

  // --- Panneau : bannières et barres (construits côté extension) ------------------
  "barre.cinqHeures": "5-hour",
  "barre.semaine": "Week",
  "banniere.autre": "Another launcher is already set in Claude Code (the “claudeProcessWrapper” setting). Twinseat changed nothing: per-window accounts are paused.",
  "banniere.desactive": "Twinseat is off: Claude uses its original sign-in.",
  "banniere.pasActif": "Not active yet: sign in to both accounts first (“Sign in” button below). Until then, Claude keeps its original sign-in.",

  // --- Panneau : textes de la page (envoyés au webview, voir CLES_WEBVIEW) --------
  "web.chargement": "Loading…",
  "web.cetteFenetre": "this window",
  "web.pasConnecte": "Not signed in yet.",
  "web.indisponible": "Usage unavailable",
  "web.utiliser": "Use in this window",
  "web.connecter": "Sign in",
  "web.ouverte": "open",
  "web.rouvrir": "Reopen",
  "web.reprendreSur": "Resume on {compte}",
  "web.ouvrir": "Open",
  "web.activer": "Enable",
  "web.actualiser": "Refresh usage",
  "web.titreOuvertes": "Open conversations",
  "web.aucuneOuverte": "No open conversations.",
  "web.titreRecentes": "Recent conversations in this project",
  "web.aucunDossier": "No folder is open in this window.",
  "web.aucuneRecente": "No conversations for this project.",
  "web.titreRelais": "Handoff notes",
  "web.aucuneNote": "No handoff notes for this project. Type /relais in a conversation to write one.",
  "web.barreAria": "{nom}: {texte}",
  "web.renommer": "Rename",
};

export type Cle = keyof typeof en;

const ESPACE_FINE = String.fromCharCode(0x202f); // séparateur de milliers en français

export const fr: Record<Cle, string> = {
  "fmt.pourcent": "{n} %",
  "fmt.heure": "{h} h {mn}",
  "fmt.milliers": ESPACE_FINE,
  "jours": "dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi",
  "mois": "janv.|févr.|mars|avr.|mai|juin|juil.|août|sept.|oct.|nov.|déc.",
  "moment.aujourdhui": "à {heure}",
  "moment.demain": "demain à {heure}",
  "moment.jour": "{jour} à {heure}",
  "moment.date": "le {jour} {mois} à {heure}",
  "retour": "retour à zéro {moment}",
  "age.instant": "à l'instant",
  "age.min": "il y a {n} min",
  "age.h": "il y a {n} h",
  "age.j": "il y a {n} j",
  "maj.direct": "mis à jour {age}",
  "maj.cache": "chiffres d'{age} (mémoire de Claude)",
  "maj.cacheInstant": "chiffres à l'instant (mémoire de Claude)",
  "quota.cinqHeures": "5 h : {pct}",
  "quota.semaine": "semaine : {pct}",
  "quota.indisponible": "quotas indisponibles",
  "quota.absent": "quotas pas encore relevés",
  "alerte.phrase": "Le compte « {compte} » est à {pct} ({limite}{retour}).",
  "alerte.limite5h": "limite de 5 h",
  "alerte.limiteSemaine": "limite de la semaine",
  "note.date": "{jour} {mois} {heure}",

  "compte.nom": "Compte {compte}",
  "barre.texte": "$(account) Claude : {compte}",
  "barre.infobulle": "Cliquer pour changer le compte de cette fenêtre",
  "barre.origine.projet": "Compte : d'après les réglages de ce projet",
  "barre.origine.memoire": "Compte : mémorisé pour ce projet",
  "barre.origine.defaut": "Compte : par défaut",
  "barre.origine.session": "Compte : choisi dans cette fenêtre (les réglages du projet indiquent {compte})",
  "fenetre.terminal": "Twinseat : les terminaux suivent le compte de cette fenêtre.",
  "fenetre.change": "Cette fenêtre passe sur le compte « {compte} ». Les conversations déjà ouvertes gardent leur compte.",
  "fenetre.changeProjet": "Cette fenêtre passe sur le compte {compte} pour cette session. Les réglages du projet indiquent {projet} : ce compte s'appliquera de nouveau à la prochaine ouverture.",
  "fenetre.changerReglage": "Changer le réglage du projet",
  "menu.titre": "Compte Claude pour cette fenêtre",
  "menu.placeholder": "Compte actuel : {compte}",

  "rienChange": "Rien n'a été changé.",
  "lanceur.autre": "Un autre lanceur est déjà réglé dans Claude Code : Twinseat n'a rien changé.",
  "activer.connecterDabord": "Connectez d'abord les deux comptes (panneau « Twinseat »).",
  "activer.ok": "Twinseat est actif : chaque fenêtre a maintenant son compte.",
  "activer.echec": "Impossible de régler le lanceur dans les réglages VS Code.",
  "choisir.inactif": "Twinseat n'est pas actif : connectez les deux comptes, puis cliquez sur « Activer » dans le panneau.",
  "desactiver.ok": "Désactivé : Claude utilise de nouveau la connexion d'origine. Les dossiers ~/.claude/comptes restent en place.",
  "relais.copier": "Copier /relais",
  "relais.copie": "« /relais » copié : collez-le dans la conversation en cours.",
  "alerte.basculer": "Passer cette fenêtre sur {compte}",
  "alerte.voir": "Voir les comptes",
  "releve.introuvable": "Claude Code est introuvable : impossible de relever les quotas.",
  "releve.enCours": "Un relevé est déjà en cours dans une autre fenêtre.",
  "contexte.longue": "La conversation « {titre} » est longue (≈ {jetons} jetons). Pensez à /relais avant qu'elle ne soit compactée.",
  "contexte.sansTitre": "Conversation sans titre",
  "connecter.titre": "Quel compte connecter ?",
  "connecter.terminal": "Connexion du compte « {compte} »",
  "connecter.introuvable": "Claude Code est introuvable : impossible de lancer la connexion.",
  "connecter.navigateur": "Le navigateur va s'ouvrir : vérifiez que claude.ai y est connecté au bon compte (fenêtre privée sinon).",
  "reprendre.toujours": "Toujours ouverte : rien n'a été changé.",
  "reprendre.fermer": "Cette conversation est encore ouverte dans un onglet. Fermez cet onglet, puis cliquez sur « C'est fait ».",
  "reprendre.fait": "C'est fait",
  "reprendre.ok": "Conversation rouverte sur le compte « {compte} ».",
  "relais.reprise": "Nouvelle conversation sur le compte « {compte} » : si « {texte} » n'est pas déjà tapé, collez-le (il est copié).",
  "relais.introuvable": "Cette note de relais est introuvable.",

  "etiquette.erreur.vide": "Saisissez un nom de 1 à 24 caractères.",
  "etiquette.erreur.longueur": "Trop long : 24 caractères au maximum.",
  "etiquette.erreur.caracteres": "Seuls les lettres, les chiffres, les espaces et les signes « _ », « . » et « - » sont permis.",
  "etiquette.erreur.doublon": "Déjà pris : c'est le nom ou la lettre de l'autre compte.",
  "nommer.titre": "Nommer un compte",
  "nommer.choisir": "Quel compte nommer ?",
  "nommer.saisie": "Nom pour {compte}",
  "nommer.aide": "De 1 à 24 caractères. Laissez vide pour revenir à « {lettre} ».",
  "nommer.exemple": "travail, perso…",
  "nommer.retour": "Vide : ce compte reprend le nom « {lettre} ».",
  "nommer.echec": "Impossible d'enregistrer le nom dans les réglages VS Code.",
  "projet.reglageInconnu": "Le réglage « twinseat.account » indique « {valeur} », qui n'est le nom d'aucun compte : il est ignoré. Utilisez A, B ou un nom donné avec « Twinseat : nommer un compte… ».",
  "projet.pasDeDossier": "Ouvrez d'abord un dossier : le compte du projet s'enregistre dans les réglages de ce dossier.",
  "projet.epingle": "Ce projet utilise maintenant le compte « {compte} » (« twinseat.account » écrit dans .vscode/settings.json).",
  "projet.echec": "Impossible d'écrire « twinseat.account » dans les réglages de ce dossier.",

  "plateforme.nonSupportee": "Twinseat ne fonctionne que sur macOS et Linux. Sur ce système, il reste inactif et ne change rien.",

  "alias.confirmer": "Ajouter les alias claude-a et claude-b à {fichier} ?",
  "alias.ajouter": "Ajouter les alias",
  "alias.ajoutes": "Alias claude-a et claude-b ajoutés à {fichier}. Ouvrez un nouveau terminal pour les utiliser.",
  "alias.dejaLa": "Les alias claude-a et claude-b sont déjà dans {fichier}. Rien n'a été changé.",
  "alias.shellInconnu": "Twinseat ne sait modifier que le fichier de démarrage de zsh ou de bash. Votre shell n'est ni l'un ni l'autre : rien n'a été écrit. Les deux lignes d'alias sont copiées dans le presse-papiers : collez-les dans le fichier de démarrage de votre shell.",
  "alias.echec": "Impossible d'écrire dans {fichier}.",

  "barre.cinqHeures": "5 h",
  "barre.semaine": "Semaine",
  "banniere.autre": "Un autre lanceur est déjà réglé dans Claude Code (réglage « claudeProcessWrapper »). Twinseat n'a rien changé : les comptes par fenêtre sont en pause.",
  "banniere.desactive": "Twinseat est désactivé : Claude utilise la connexion d'origine.",
  "banniere.pasActif": "Pas encore actif : il faut d'abord connecter les deux comptes (bouton « Se connecter » ci-dessous). Tant que ce n'est pas fait, Claude garde sa connexion d'origine.",

  "web.chargement": "Chargement…",
  "web.cetteFenetre": "cette fenêtre",
  "web.pasConnecte": "Pas encore connecté.",
  "web.indisponible": "Quotas indisponibles",
  "web.utiliser": "Utiliser dans cette fenêtre",
  "web.connecter": "Se connecter",
  "web.ouverte": "ouverte",
  "web.rouvrir": "Rouvrir",
  "web.reprendreSur": "Reprendre sur {compte}",
  "web.ouvrir": "Ouvrir",
  "web.activer": "Activer",
  "web.actualiser": "Actualiser les quotas",
  "web.titreOuvertes": "Conversations ouvertes",
  "web.aucuneOuverte": "Aucune conversation ouverte.",
  "web.titreRecentes": "Conversations récentes de ce projet",
  "web.aucunDossier": "Aucun dossier ouvert dans cette fenêtre.",
  "web.aucuneRecente": "Aucune conversation pour ce projet.",
  "web.titreRelais": "Relais",
  "web.aucuneNote": "Aucune note de relais pour ce projet. Tapez /relais dans une conversation pour en écrire une.",
  "web.barreAria": "{nom} : {texte}",
  "web.renommer": "Renommer",
};

export const TABLES: Record<Langue, Record<Cle, string>> = { en, fr };

let courante: Langue = "en";

/** Français si la langue d'affichage de VS Code est « fr » ou « fr-XX » ; anglais sinon. */
export function definirLangue(l: string): Langue {
  courante = /^fr($|[-_])/i.test(l.trim()) ? "fr" : "en";
  return courante;
}

export function langue(): Langue {
  return courante;
}

/** Texte de la langue choisie ; les {variables} sans valeur restent telles quelles. */
export function t(cle: Cle, variables?: Variables): string {
  const modele = TABLES[courante][cle];
  if (!variables) return modele;
  return modele.replace(/\{(\w+)\}/g, (brut, nom: string) => (nom in variables ? String(variables[nom]) : brut));
}

/** Liste de la langue choisie (jours, mois). */
export function liste(cle: Cle): string[] {
  return TABLES[courante][cle].split("|");
}

/** « 16:05 » (en) ou « 16 h 05 » (fr). Les minutes ont toujours 2 chiffres. */
export function heure(h: number, mn: number): string {
  return t("fmt.heure", { h, hh: String(h).padStart(2, "0"), mn: String(mn).padStart(2, "0") });
}

/** Les textes dont la page du panneau a besoin (le reste est construit côté extension). */
export const CLES_WEBVIEW: readonly Cle[] = [
  "web.chargement", "web.cetteFenetre", "web.pasConnecte", "web.indisponible", "web.utiliser", "web.connecter",
  "web.ouverte", "web.rouvrir", "web.reprendreSur", "web.ouvrir", "web.activer", "web.actualiser",
  "web.titreOuvertes", "web.aucuneOuverte", "web.titreRecentes", "web.aucunDossier", "web.aucuneRecente",
  "web.titreRelais", "web.aucuneNote", "web.barreAria", "web.renommer",
];

export function textesWebview(): Record<string, string> {
  return Object.fromEntries(CLES_WEBVIEW.map((c) => [c, TABLES[courante][c]]));
}

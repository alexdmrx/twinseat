#!/bin/sh
# Lanceur Twinseat.
# L'extension Claude Code l'appelle à chaque démarrage de Claude :
#   lanceur <binaire-claude> <arguments...>
# Il choisit le compte (A ou B), puis lance Claude avec CLAUDE_CONFIG_DIR.
#
# Ordre de choix :
#   1. conversation reprise (--resume=<id>) déjà notée au registre → son compte ;
#   2. compte de la fenêtre (CLAUDE_COMPTE_FENETRE, posé par l'extension) ;
#   3. dernier compte choisi pour ce projet (comptes/projets/<dossier>) ;
#   4. A.
# Règle absolue : en cas de doute, lancer Claude quand même. Le seul refus :
# une conversation déjà ouverte ailleurs (deux processus écriraient le même
# historique).

BASE="$HOME/.claude/comptes"
BIN="$1"
[ -n "$BIN" ] || exit 127
shift

journal() {
  # Une ligne par lancement : heure, compte, mode, numéro. Jamais de contenu.
  f="$BASE/journal.log"
  if [ -f "$f" ] && [ "$(wc -c < "$f" 2>/dev/null || echo 0)" -gt 200000 ]; then
    mv -f "$f" "$f.1" 2>/dev/null
  fi
  printf '%s %s %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" "$2" "$3" >> "$f" 2>/dev/null
}

# Sans dossier des comptes (extension retirée) : Claude tel quel.
[ -d "$BASE" ] || exec "$BIN" "$@"

# --- Lecture des arguments ----------------------------------------------
id_reprise=""     # conversation reprise (--resume)
id_neuf=""        # numéro imposé (--session-id)
mode="cmd"        # cmd = sous-commande ou --version ; session ; sonde
copie=0           # --fork-session : nouvelle conversation copiée d'une autre
sans_trace=0      # --continue / --no-session-persistence : rien à noter
flux=0            # --output-format / --input-format : une vraie conversation
precedent=""
for a in "$@"; do
  case "$a" in
    --resume=*) id_reprise="${a#--resume=}" ;;
    --session-id=*) id_neuf="${a#--session-id=}" ;;
    --fork-session) copie=1 ;;
    --continue|-c|--no-session-persistence) sans_trace=1 ;;
    --output-format|--output-format=*|--input-format|--input-format=*) flux=1 ;;
  esac
  case "$precedent" in
    --resume|-r) id_reprise="$a" ;;
    --session-id) id_neuf="$a" ;;
  esac
  precedent="$a"
done
case "$id_reprise" in *[!0-9A-Fa-f-]*) id_reprise="" ;; esac   # un numéro, rien d'autre
case "$id_neuf" in *[!0-9A-Fa-f-]*) id_neuf="" ;; esac
case "${1:-}" in -*) [ "$flux" = 1 ] && mode="session" ;; esac
[ "${CLAUDE_CODE_CONFIG_PROBE:-}" = "1" ] && mode="sonde"

# --- Choix du compte ----------------------------------------------------
lire_registre() {
  [ -n "$1" ] && [ -f "$BASE/registre/$1" ] && head -c 1 "$BASE/registre/$1" 2>/dev/null
}
# La conversation reprise (ou copiée) d'abord : une copie garde le compte de
# l'originale.
compte=$(lire_registre "$id_reprise")
case "$compte" in A|B) ;; *) compte=$(lire_registre "$id_neuf") ;; esac
case "$compte" in A|B) ;; *) compte="${CLAUDE_COMPTE_FENETRE:-}" ;; esac
case "$compte" in
  A|B) ;;
  *)
    dossier=$(printf '%s' "$PWD" | LC_ALL=C tr -c 'A-Za-z0-9' '-')
    [ -f "$BASE/projets/$dossier" ] && compte=$(head -c 1 "$BASE/projets/$dossier" 2>/dev/null)
    ;;
esac
case "$compte" in A|B) ;; *) compte="A" ;; esac

# Dossier du compte absent : Claude tel quel plutôt que rien.
if [ ! -d "$BASE/$compte" ]; then
  journal "-" "$mode" "dossier-$compte-absent"
  exec "$BIN" "$@"
fi

# --- Conversation déjà ouverte ailleurs ? --------------------------------
ouverte_ailleurs() {
  # Un processus CLAUDE (pas un autre lanceur) dont les arguments portent ce
  # numéro. pgrep seul dans $(...) : il ne se voit pas lui-même.
  pids=$(pgrep -f -- "-(resume|session-id)[= ]$1" 2>/dev/null)
  for p in $pids; do
    [ "$p" = "$$" ] && continue
    nom=$(ps -o comm= -p "$p" 2>/dev/null)
    case "$nom" in *sh|"") continue ;; esac   # un lanceur en cours, ou déjà fini
    return 0
  done
  return 1
}
# Une copie (--fork-session) ne touche pas à l'originale : pas de garde.
if [ "$mode" = "session" ] && [ -n "$id_reprise" ] && [ "$copie" = 0 ]; then
  essais=0
  while ouverte_ailleurs "$id_reprise"; do
    # Un redémarrage demandé par Claude laisse l'ancien processus finir.
    essais=$((essais + 1))
    if [ "$essais" -gt 6 ]; then
      journal "$compte" "refus" "$id_reprise"
      echo "Twinseat: this conversation is already open in another tab. Close that tab, then reopen it." >&2
      exit 1
    fi
    sleep 0.5
  done
fi

# --- Nouvelle conversation (ou copie) : on lui donne son numéro -----------
if [ "$mode" = "session" ] && [ -z "$id_neuf" ] && [ "$sans_trace" = 0 ]; then
  if [ -z "$id_reprise" ] || [ "$copie" = 1 ]; then
    id_neuf=$(uuidgen 2>/dev/null | tr 'A-F' 'a-f')
    [ -n "$id_neuf" ] && set -- "$@" "--session-id=$id_neuf"
  fi
fi

# Au registre : le compte de chaque conversation (sauf sondes et commandes).
noter() {
  [ -n "$1" ] && [ ! -f "$BASE/registre/$1" ] || return 0
  { mkdir -p "$BASE/registre" && printf '%s\n' "$compte" > "$BASE/registre/$1"; } 2>/dev/null
  return 0
}
if [ "$mode" = "session" ]; then
  noter "$id_reprise"   # conversation d'avant l'extension : elle prend ce compte
  noter "$id_neuf"      # nouvelle conversation, ou copie
fi

if [ "$copie" = 1 ]; then journal "$compte" "copie" "$id_reprise>$id_neuf"
elif [ -n "$id_reprise" ]; then journal "$compte" "reprise" "$id_reprise"
else journal "$compte" "$mode" "${id_neuf:--}"; fi

CLAUDE_CONFIG_DIR="$BASE/$compte"
CLAUDE_COMPTE="$compte"
export CLAUDE_CONFIG_DIR CLAUDE_COMPTE
exec "$BIN" "$@"

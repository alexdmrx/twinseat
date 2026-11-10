#!/bin/sh
# Essais du lanceur avec un faux Claude, dans un HOME jetable.
# Usage : sh tests/lanceur.test.sh
set -u
ICI=$(cd "$(dirname "$0")/.." && pwd)
LANCEUR="$ICI/resources/lanceur.sh"
T=$(mktemp -d)
export HOME="$T/home"
B="$HOME/.claude/comptes"
mkdir -p "$B/A" "$B/B" "$B/registre" "$B/projets" "$T/projet"
FAUX="$T/faux-claude"
cat > "$FAUX" <<'EOF'
#!/bin/sh
echo "DIR=${CLAUDE_CONFIG_DIR:-aucun} COMPTE=${CLAUDE_COMPTE:-aucun} ARGS=$*"
EOF
chmod +x "$FAUX"
echecs=0
verifie() { # nom, attendu (motif grep), sortie
  if printf '%s' "$3" | grep -q -- "$2"; then echo "ok   - $1"
  else echo "ÉCHEC - $1 : attendu « $2 », obtenu « $3 »"; echecs=$((echecs + 1)); fi
}
lance() { (cd "$T/projet" && env -u CLAUDE_COMPTE_FENETRE "$@") ; }

# 1. Nouvelle conversation, ni fenêtre ni projet connu → A, numéro imposé.
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json --verbose)
verifie "nouvelle → A" "DIR=$B/A COMPTE=A" "$s"
verifie "numéro imposé" "--session-id=" "$s"
id1=$(printf '%s' "$s" | sed -n 's/.*--session-id=\([0-9a-f-]*\).*/\1/p')
verifie "registre noté A" "A" "$(cat "$B/registre/$id1" 2>/dev/null)"

# 2. Fenêtre sur B → B.
s=$(lance CLAUDE_COMPTE_FENETRE=B sh "$LANCEUR" "$FAUX" --output-format stream-json)
verifie "fenêtre B → B" "COMPTE=B" "$s"

# 3. Reprise de la conversation de A depuis une fenêtre B → reste sur A.
s=$(lance CLAUDE_COMPTE_FENETRE=B sh "$LANCEUR" "$FAUX" --output-format stream-json "--resume=$id1")
verifie "reprise reste sur A" "COMPTE=A" "$s"
verifie "reprise sans second numéro" "resume=$id1\$" "$s"

# 4. « Continuer sur B » : le registre passe à B → la reprise va sur B.
printf 'B\n' > "$B/registre/$id1"
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json --resume "$id1")
verifie "reprise après changement → B" "COMPTE=B" "$s"

# 5. Sous-commande : compte de la fenêtre, aucun numéro, rien au registre.
n=$(ls "$B/registre" | wc -l)
s=$(lance CLAUDE_COMPTE_FENETRE=B sh "$LANCEUR" "$FAUX" auth status --json)
verifie "sous-commande → B" "COMPTE=B ARGS=auth status --json\$" "$s"
verifie "sous-commande hors registre" "$n" "$(ls "$B/registre" | wc -l)"

# 6. Sonde de l'extension : pas au registre.
s=$(lance CLAUDE_CODE_CONFIG_PROBE=1 sh "$LANCEUR" "$FAUX" --output-format stream-json)
verifie "sonde hors registre" "$n" "$(ls "$B/registre" | wc -l)"

# 7. Dernier compte du projet (sans fenêtre).
dossier=$(printf '%s' "$T/projet" | tr -c 'A-Za-z0-9' '-')
printf 'B\n' > "$B/projets/$dossier"
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json)
verifie "mémoire du projet → B" "COMPTE=B" "$s"
rm -f "$B/projets/$dossier"

# 8. Numéro piégé (chemin) : ignoré, jamais lu hors du registre.
#    Le fichier visé existe et dit B : sans le filtre du numéro, on obtiendrait B.
printf 'B\n' > "$HOME/.claude/x"
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json "--resume=../../x")
verifie "numéro piégé ignoré" "COMPTE=A" "$s"
rm -f "$HOME/.claude/x"

# 9. Conversation déjà ouverte ailleurs → refus clair.
id2="11111111-2222-3333-4444-555555555555"
printf 'A\n' > "$B/registre/$id2"
sh -c 'exec -a "claude-test --session-id=$1" sleep 30' _ "$id2" 2>/dev/null &
occupant=$!
sleep 0.3
if pgrep -f -- "-(resume|session-id)=$id2" >/dev/null; then
  s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json "--resume=$id2" 2>&1)
  verifie "double ouverture refusée" "Twinseat: this conversation is already open in another tab. Close that tab, then reopen it." "$s"
else
  echo "ÉCHEC - essai 9 impossible : exec -a indisponible dans ce shell"
  echecs=$((echecs + 1))
fi
kill "$occupant" 2>/dev/null

# 11. Copie (fork) d'une conversation B depuis une fenêtre A : reste sur B,
#     nouveau numéro noté B, aucun refus même si l'originale est ouverte.
sh -c 'exec -a "claude-test --resume=$1" sleep 30' _ "$id1" 2>/dev/null &
occupant=$!
sleep 0.3
s=$(lance CLAUDE_COMPTE_FENETRE=A sh "$LANCEUR" "$FAUX" --output-format stream-json "--resume=$id1" --fork-session 2>&1)
verifie "copie garde le compte de l'originale" "COMPTE=B" "$s"
id3=$(printf '%s' "$s" | sed -n 's/.*--session-id=\([0-9a-f-]*\).*/\1/p')
verifie "copie : nouveau numéro noté B" "B" "$(cat "$B/registre/$id3" 2>/dev/null)"
kill "$occupant" 2>/dev/null

# 12. --version : ni numéro ni registre.
n=$(ls "$B/registre" | wc -l)
s=$(lance sh "$LANCEUR" "$FAUX" --version)
verifie "--version intact" "ARGS=--version\$" "$s"
verifie "--version hors registre" "$n" "$(ls "$B/registre" | wc -l)"

# 13. Un autre LANCEUR (shell) sur le même numéro ne bloque pas.
id4="22222222-3333-4444-5555-666666666666"
#     « ; : » garde le shell en vie : sans lui, sh exécute sleep à sa place et
#     le numéro disparaît de la liste des processus (l'essai ne prouverait rien).
sh -c 'sleep 30; :' "--resume=$id4" &
autre=$!
sleep 0.3
verifie "lanceur concurrent visible" "[0-9]" "$(pgrep -f -- "-(resume|session-id)[= ]$id4")"
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json "--resume=$id4" 2>&1)
verifie "lanceur concurrent ignoré" "COMPTE=" "$s"
kill "$autre" 2>/dev/null

# 14. Forme « --resume <id> » (espace) : gardée aussi.
id5="33333333-4444-5555-6666-777777777777"
sh -c 'exec -a "claude-test --resume $1" sleep 30' _ "$id5" 2>/dev/null &
occupant=$!
sleep 0.3
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json --resume "$id5" 2>&1)
verifie "double ouverture (forme espace) refusée" "already open in another tab" "$s"
kill "$occupant" 2>/dev/null

# 10. Sans dossier des comptes : Claude tel quel.
rm -rf "$B"
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json)
verifie "sans comptes → tel quel" "DIR=aucun" "$s"

rm -rf "$T"
[ "$echecs" = 0 ] && echo "TOUT EST BON" || { echo "$echecs échec(s)"; exit 1; }

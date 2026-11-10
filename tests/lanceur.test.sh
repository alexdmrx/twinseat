#!/bin/sh
# Essais du lanceur avec un faux Claude, dans un HOME jetable.
# Usage : sh tests/lanceur.test.sh
# Tourne sous le sh de macOS comme sous dash (le sh d'Ubuntu) : rien ici n'est propre à un
# shell. Les faux « occupants » (processus dont la ligne de commande imite celle d'un Claude)
# sont lancés avec bash, seul à offrir « exec -a » sur les deux systèmes ; le lanceur, lui,
# est toujours lancé avec sh.
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
absent() { # nom, motif qui ne doit pas apparaître (grep), sortie
  if printf '%s' "$3" | grep -q -- "$2"; then echo "ÉCHEC - $1 : « $2 » ne devait pas apparaître dans « $3 »"; echecs=$((echecs + 1))
  else echo "ok   - $1"; fi
}
lance() { (cd "$T/projet" && env -u CLAUDE_COMPTE_FENETRE "$@") ; }
arrete() { kill "$1" 2>/dev/null; wait "$1" 2>/dev/null; }   # fin d'un faux occupant, sans bruit

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
bash -c 'exec -a "claude-test --session-id=$1" sleep 30' _ "$id2" 2>/dev/null &
occupant=$!
sleep 0.3
if pgrep -f -- "-(resume|session-id)=$id2" >/dev/null; then
  s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json "--resume=$id2" 2>&1)
  verifie "double ouverture refusée" "Twinseat: this conversation is already open in another tab. Close that tab, then reopen it." "$s"
else
  echo "ÉCHEC - essai 9 impossible : exec -a indisponible dans bash"
  echecs=$((echecs + 1))
fi
arrete "$occupant"

# 10. Copie (fork) d'une conversation B depuis une fenêtre A : reste sur B,
#     nouveau numéro noté B, aucun refus même si l'originale est ouverte.
bash -c 'exec -a "claude-test --resume=$1" sleep 30' _ "$id1" 2>/dev/null &
occupant=$!
sleep 0.3
s=$(lance CLAUDE_COMPTE_FENETRE=A sh "$LANCEUR" "$FAUX" --output-format stream-json "--resume=$id1" --fork-session 2>&1)
verifie "copie garde le compte de l'originale" "COMPTE=B" "$s"
id3=$(printf '%s' "$s" | sed -n 's/.*--session-id=\([0-9a-f-]*\).*/\1/p')
verifie "copie : nouveau numéro noté B" "B" "$(cat "$B/registre/$id3" 2>/dev/null)"
arrete "$occupant"

# 11. --version : ni numéro ni registre.
n=$(ls "$B/registre" | wc -l)
s=$(lance sh "$LANCEUR" "$FAUX" --version)
verifie "--version intact" "ARGS=--version\$" "$s"
verifie "--version hors registre" "$n" "$(ls "$B/registre" | wc -l)"

# 12. Un autre LANCEUR (shell) sur le même numéro ne bloque pas.
id4="22222222-3333-4444-5555-666666666666"
#     « ; : » garde le shell en vie : sans lui, sh exécute sleep à sa place et
#     le numéro disparaît de la liste des processus (l'essai ne prouverait rien).
sh -c 'sleep 30; :' "--resume=$id4" &
autre=$!
sleep 0.3
verifie "lanceur concurrent visible" "[0-9]" "$(pgrep -f -- "-(resume|session-id)[= ]$id4")"
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json "--resume=$id4" 2>&1)
verifie "lanceur concurrent ignoré" "COMPTE=" "$s"
arrete "$autre"

# 12 bis. Un autre lanceur démarré par sa ligne #! (comme VS Code le fait) : sous Linux
#     son nom de processus est « lanceur », sous macOS « /bin/sh ». Il ne bloque pas non plus.
id6="44444444-5555-6666-7777-888888888888"
mkdir -p "$T/bin-lanceur"
printf '#!/bin/sh\nsleep 30\n' > "$T/bin-lanceur/lanceur"
chmod +x "$T/bin-lanceur/lanceur"
"$T/bin-lanceur/lanceur" "--resume=$id6" &
autre=$!
sleep 0.3
verifie "lanceur #! visible" "[0-9]" "$(pgrep -f -- "-(resume|session-id)[= ]$id6")"
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json "--resume=$id6" 2>&1)
verifie "lanceur #! ignoré" "COMPTE=" "$s"
arrete "$autre"

# 13. Forme « --resume <id> » (espace) : gardée aussi.
id5="33333333-4444-5555-6666-777777777777"
bash -c 'exec -a "claude-test --resume $1" sleep 30' _ "$id5" 2>/dev/null &
occupant=$!
sleep 0.3
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json --resume "$id5" 2>&1)
verifie "double ouverture (forme espace) refusée" "already open in another tab" "$s"
arrete "$occupant"

# 14. uuidgen existe mais ne dit rien : repli sur le noyau Linux (/proc/sys/kernel/random/uuid).
#     Sans /proc (macOS), il n'y a plus d'autre source : Claude est lancé tel quel, sans numéro
#     imposé (le comportement d'avant).
PROC_UUID=/proc/sys/kernel/random/uuid
UN_UUID='--session-id=[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}'
muet="$T/uuidgen-muet"
mkdir -p "$muet"
printf '#!/bin/sh\nexit 1\n' > "$muet/uuidgen"
chmod +x "$muet/uuidgen"
s=$(lance PATH="$muet:$PATH" sh "$LANCEUR" "$FAUX" --output-format stream-json 2>&1)
verifie "uuidgen muet : Claude est lancé" "DIR=$B/A COMPTE=A" "$s"
if [ -r "$PROC_UUID" ]; then
  verifie "uuidgen muet : numéro pris au noyau" "$UN_UUID\$" "$s"
else
  verifie "uuidgen muet, sans /proc : pas de numéro imposé" "ARGS=--output-format stream-json\$" "$s"
fi

# 15. Pas d'uuidgen du tout (Linux sans uuid-runtime) : numéro pris au noyau, en minuscules,
#     noté au registre, différent d'un lancement à l'autre, sans message d'erreur.
#     Ne tourne que si ce système a /proc/sys/kernel/random/uuid (c'est le seul essai sauté
#     selon la plateforme : il est signalé par « info - », jamais compté comme réussi).
SH=$(command -v sh)
sans="$T/sans-uuidgen"
mkdir -p "$sans"
for outil in cat date head mkdir mv pgrep ps sleep tr wc; do
  chemin=$(command -v "$outil" 2>/dev/null)
  case "$chemin" in /*) ln -s "$chemin" "$sans/$outil" ;; esac
done
if [ ! -r "$PROC_UUID" ]; then
  echo "info - essai 15 sauté : $PROC_UUID n'existe pas sur ce système ; le repli sans uuidgen ne s'y vérifie pas"
elif [ -n "$(env PATH="$sans" "$SH" -c 'command -v uuidgen' 2>/dev/null)" ]; then
  echo "ÉCHEC - essai 15 impossible : uuidgen reste visible dans le PATH réduit"
  echecs=$((echecs + 1))
else
  s=$(lance PATH="$sans" "$SH" "$LANCEUR" "$FAUX" --output-format stream-json 2>&1)
  verifie "sans uuidgen : Claude est lancé" "DIR=$B/A COMPTE=A" "$s"
  verifie "sans uuidgen : numéro imposé (uuid en minuscules)" "$UN_UUID\$" "$s"
  absent "sans uuidgen : aucun message d'erreur" "uuidgen\|not found\|No such file" "$s"
  id6=$(printf '%s' "$s" | sed -n 's/.*--session-id=\([0-9a-f-]*\).*/\1/p')
  verifie "sans uuidgen : numéro noté au registre" "A" "$(cat "$B/registre/$id6" 2>/dev/null)"
  s=$(lance PATH="$sans" "$SH" "$LANCEUR" "$FAUX" --output-format stream-json 2>&1)
  id7=$(printf '%s' "$s" | sed -n 's/.*--session-id=\([0-9a-f-]*\).*/\1/p')
  verifie "sans uuidgen : un autre numéro au lancement suivant" "different" "$([ -n "$id7" ] && [ "$id7" != "$id6" ] && echo different)"
fi

# 16. Sans dossier des comptes : Claude tel quel.
rm -rf "$B"
s=$(lance sh "$LANCEUR" "$FAUX" --output-format stream-json)
verifie "sans comptes → tel quel" "DIR=aucun" "$s"

rm -rf "$T"
[ "$echecs" = 0 ] && echo "TOUT EST BON" || { echo "$echecs échec(s)"; exit 1; }

#!/bin/sh
# compat-check.sh - does a given Claude Code release still offer what Twinseat relies on?
#
# Usage:
#   sh scripts/compat-check.sh EXTENSION_DIR CLAUDE
#
#   EXTENSION_DIR  The unpacked Claude Code VS Code extension: the folder that holds its
#                  package.json. Either an installed copy
#                  (~/.vscode/extensions/anthropic.claude-code-<version>-<platform>) or the
#                  `extension/` folder of an unzipped .vsix.
#   CLAUDE         The `claude` binary, or the directory of the npm package
#                  (@anthropic-ai/claude-code). For a directory, `bin/claude.exe`,
#                  `bin/claude` or `cli.js` is run for --help and --version, and every file
#                  under it is searched for the internal strings.
#
# One line per check on standard output:
#   ok   - <what was found>
#   FAIL - <what is missing>
#   warn - <something worth knowing; never fails the run>
# Exit status: 0 when no check failed, 1 when at least one did, 2 on a usage error.
#
# What Twinseat relies on, and why:
#   - The extension's package.json declares the settings `claudeCode.claudeProcessWrapper`
#     (how Twinseat puts its launcher in front of Claude) and `claudeCode.environmentVariables`,
#     the command `claude-vscode.editor.open` (reopening a conversation) and the views
#     `claudeVSCodeSidebar` / `claudeVSCodeSidebarSecondary` (the account badge in their titles).
#   - The extension's JavaScript names the webview panel `claudeVSCodePanel` (the badge on
#     conversation tabs).
#   - The extension ships `resources/native-binary/claude` (Twinseat reads usage with it).
#     A platform build without it only warns: Twinseat then falls back to ~/.local/bin/claude.
#   - `claude --help` lists the flags the launcher and the usage probe pass or read:
#     --session-id, --resume, --fork-session, --no-session-persistence, --strict-mcp-config,
#     --mcp-config, --input-format, --output-format.
#   - The binary still contains `get_usage` (the control request that returns usage),
#     `cachedUsageUtilization` (the cache Twinseat falls back on) and `CLAUDE_CODE_CONFIG_PROBE`
#     (the variable the extension sets on its probes, which the launcher recognises).
#
# The script only reads. `claude` runs with a throw-away HOME and CLAUDE_CONFIG_DIR, no input,
# and telemetry and auto-update switched off, so nothing is written to your real configuration.
# POSIX sh; needs grep, sed, mktemp and, for the optional `cli.js` form, node.

set -u

if [ "$#" -ne 2 ] || [ ! -d "$1" ]; then
  echo "usage: sh scripts/compat-check.sh EXTENSION_DIR CLAUDE_BINARY_OR_PACKAGE_DIR" >&2
  exit 2
fi
EXT=${1%/}
CLAUDE=$2
if [ ! -e "$CLAUDE" ]; then
  echo "compat-check: not found: $CLAUDE" >&2
  exit 2
fi
PKG="$EXT/package.json"

TMP=$(mktemp -d) || exit 2
trap 'rm -rf "$TMP"' EXIT
trap 'exit 130' HUP INT TERM

total=0
failed=0
ok() { total=$((total + 1)); echo "ok   - $1"; }
fail() { total=$((total + 1)); failed=$((failed + 1)); echo "FAIL - $1"; }
warn() { echo "warn - $1"; }
verdict() { # description, then a command: ok when it succeeds
  desc=$1
  shift
  if "$@"; then ok "$desc"; else fail "$desc"; fi
}

# --- Locating what to run -------------------------------------------------------------
CLAUDE_EXE=""
CLAUDE_JS=""
if [ -d "$CLAUDE" ]; then
  for c in "$CLAUDE/bin/claude.exe" "$CLAUDE/bin/claude" "$CLAUDE/claude"; do
    if [ -f "$c" ] && [ -x "$c" ]; then CLAUDE_EXE=$c; break; fi
  done
  if [ -z "$CLAUDE_EXE" ] && [ -f "$CLAUDE/cli.js" ] && command -v node >/dev/null 2>&1; then
    CLAUDE_JS="$CLAUDE/cli.js"
  fi
else
  CLAUDE_EXE=$CLAUDE
fi

run_claude() { # the CLI with the given arguments, isolated from the real configuration
  if [ -n "$CLAUDE_JS" ]; then
    env HOME="$TMP/home" CLAUDE_CONFIG_DIR="$TMP/config" DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 \
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 node "$CLAUDE_JS" "$@" </dev/null
  else
    env HOME="$TMP/home" CLAUDE_CONFIG_DIR="$TMP/config" DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1 \
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 "$CLAUDE_EXE" "$@" </dev/null
  fi
}

contains() { # does the binary (or any file of the package directory) contain this exact text?
  LC_ALL=C grep -a -r -F -q -- "$1" "$CLAUDE" 2>/dev/null
}

# --- Versions (for the log) -----------------------------------------------------------
ext_version=$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PKG" 2>/dev/null | head -n 1)
echo "info - extension ${ext_version:-unknown} ($EXT)"
mkdir -p "$TMP/home" "$TMP/config"
cli_version=$(run_claude --version 2>/dev/null | head -n 1)
echo "info - claude ${cli_version:-unknown} ($CLAUDE)"

# --- The extension: package.json ------------------------------------------------------
escape() { printf '%s' "$1" | sed 's/[.]/\\./g'; }
json_key() { grep -Eq "\"$(escape "$1")\"[[:space:]]*:" "$PKG" 2>/dev/null; }
json_value() { grep -Eq "\"$(escape "$1")\"[[:space:]]*:[[:space:]]*\"$(escape "$2")\"" "$PKG" 2>/dev/null; }

if [ ! -f "$PKG" ]; then
  fail "extension package.json exists ($PKG)"
fi
verdict "setting claudeCode.claudeProcessWrapper is declared" json_key claudeCode.claudeProcessWrapper
verdict "setting claudeCode.environmentVariables is declared" json_key claudeCode.environmentVariables
verdict "command claude-vscode.editor.open is declared" json_value command claude-vscode.editor.open
verdict "view claudeVSCodeSidebar is declared" json_value id claudeVSCodeSidebar
verdict "view claudeVSCodeSidebarSecondary is declared" json_value id claudeVSCodeSidebarSecondary

# --- The extension: JavaScript and native binary --------------------------------------
main=$(sed -n 's/^[[:space:]]*"main"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$PKG" 2>/dev/null | head -n 1)
main=${main#./}
[ -n "$main" ] || main=extension.js
panel_in_main() { LC_ALL=C grep -a -F -q -- claudeVSCodePanel "$EXT/$main" 2>/dev/null; }
verdict "extension code ($main) contains claudeVSCodePanel" panel_in_main

if [ -f "$EXT/resources/native-binary/claude" ]; then
  ok "resources/native-binary/claude is in the extension"
else
  warn "resources/native-binary/claude is not in this extension build (Twinseat falls back on ~/.local/bin/claude)"
fi

# --- The CLI: flags -------------------------------------------------------------------
HELP=""
if [ -n "$CLAUDE_EXE" ] || [ -n "$CLAUDE_JS" ]; then
  HELP=$(run_claude --help 2>&1)
fi
if [ -z "$HELP" ]; then
  fail "claude --help prints something (the CLI did not run: $CLAUDE)"
fi
help_lists() { printf '%s\n' "$HELP" | grep -Eq -- "(^|[^A-Za-z0-9-])$1([^A-Za-z0-9-]|\$)"; }
for flag in --session-id --resume --fork-session --no-session-persistence --strict-mcp-config --mcp-config --input-format --output-format; do
  verdict "claude --help lists $flag" help_lists "$flag"
done

# --- The CLI: internal strings --------------------------------------------------------
for texte in get_usage cachedUsageUtilization CLAUDE_CODE_CONFIG_PROBE; do
  verdict "claude contains $texte" contains "$texte"
done

# --- Verdict --------------------------------------------------------------------------
echo "compat-check: $total checks, $failed failed"
[ "$failed" -eq 0 ]

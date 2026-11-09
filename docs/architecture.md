# Architecture notes

These are the facts the design rests on. Each one was checked against Claude Code 2.1.289 and the Claude Code VS Code extension 2.1.291 (October 2026). Apart from `CLAUDE_CONFIG_DIR` itself, none of this is documented: re-check before relying on it with a newer version.

## Claude Code facts

| Fact | Consequence for the design |
|---|---|
| `CLAUDE_CONFIG_DIR` moves everything, `.claude.json` included, into that directory. | An account is simply a directory. Sharing a setup means symlinking the shared parts. |
| The keychain entry is named `Claude Code-credentials-<first 8 hex of sha256(config dir path)>`. The hash covers the *literal* path. | The account path must be exactly the same string everywhere: `$HOME/.claude/comptes/A`, with no trailing slash and no `~`. A different spelling means a different login. |
| `claudeCode.claudeProcessWrapper` and `claudeCode.environmentVariables` are machine-scoped (user settings only) and re-read at **every** Claude launch. | Turning the wrapper on or off never kills a running conversation. The setting has to go in user settings, not workspace settings. |
| The wrapper is called as `wrapper <claude binary> <args…>`. A resumed conversation gets `--resume=<id>`; a new conversation gets no ID. | The launcher adds `--session-id=<uuid>` itself, so it knows the ID of every new conversation before Claude starts. |
| A `get_usage` control request on a `stream-json` session answers in about 1.5 s, without sending any message. | Usage can be polled every 5 minutes at no cost to the quota. |
| `--mcp-config` is variadic: it takes in every argument that follows it. | In the usage probe it always comes before another flag, never right before free text. |

## Side effects of using a wrapper (Claude Code VS Code extension 2.1.291)

- **No automatic resume after a reload.** An answer cut short by a window reload is no longer resumed.
- **No double-open guard from the extension.** The extension stops guarding against opening the same conversation twice, so the launcher does it: it looks for a running `claude` process with the same `--resume` / `--session-id`, and waits up to 3 s for a restarting process to exit before refusing.
- **The status widgets follow the last process.** The extension's own usage counter and its “Account” view show the account of the most recently started process.

## The registry

`~/.claude/comptes/registre/<conversation id>` holds a single character, `A` or `B`.

- **Who writes it.** The launcher creates an entry when a conversation starts, and never overwrites one. A conversation started before the extension existed takes the account it is first resumed with.
- **Copies.** A fork (`--fork-session`) inherits the account of the original.
- **Moving a conversation.** “Reprendre sur B” is the only action that changes an entry. It asks you to close the conversation's tab first if it is still open.
- **Cleanup.** Once a day, entries older than two days are removed if no history file exists for their conversation.

## Why a shell script for the launcher

The launcher runs before every Claude process, including short-lived probes. A POSIX `sh` script starts in a few milliseconds, has no runtime to install, and has one rule that is easy to audit: when in doubt, `exec` Claude unchanged. Its 14 scenarios (21 checks) in `tests/lanceur.test.sh` run against a fake `claude`, and they cover:
- resume;
- forks;
- concurrent launchers (another launcher is visible but must not count as an open conversation);
- the double-open guard;
- spoofed IDs (a path in place of an ID must not reach a planted file);
- running with no accounts at all.

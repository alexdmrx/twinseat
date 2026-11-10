# Changelog

## 0.3.0 — 2026-11-10 (Preview)

- **Renamed to Twinseat.** The interface is in English, with a French translation when VS Code runs in French.
- **Named accounts.** `work`, `personal` or any name you choose replace “A” and “B” on screen.
- **The account follows the project.** `twinseat.account` in `.vscode/settings.json` pins a project to an account. Without a pin, the project reopens on the account you last used for it. The account menu only appears the first time. New command: **Twinseat: Pin this project to the current account**.
- **macOS and Linux.** On other platforms Twinseat stays inactive and says so.
- **Twinseat: Check and Repair Setup** runs 13 checks and repairs only what is safe to repair.
- **Twinseat: Copy Diagnostics** gives a report with no email, account name, conversation or token.
- **Clean uninstall.** Twinseat's launcher setting is removed from VS Code, Insiders, VSCodium, Cursor and Windsurf. Comments and formatting in your settings are kept.
- **Shell aliases are only added on request**, after you confirm, into zsh, bash or an existing `~/.bash_profile`.
- **Launcher, Linux fixes:**
  - when `uuidgen` is missing, the ID comes from the kernel;
  - a launcher started by its shebang is no longer mistaken for an open conversation.
- **CI** runs the full suite on macOS and Linux. A nightly job checks the latest Claude Code release for every behaviour Twinseat relies on.

## 0.2.0 — 2026-10-08

- **Handoff notes** section in the panel.
- **Long-conversation alert** at about 160k tokens.
- **“Copy /relais”** button in the usage alerts.

## 0.1.0 — 2026-10-07

First version, then called “Comptes Claude”:
- one Claude Code account per VS Code window, through a launcher set as `claudeCode.claudeProcessWrapper`;
- a registry that keeps each conversation on its account;
- both accounts' usage in one panel;
- tab badges.

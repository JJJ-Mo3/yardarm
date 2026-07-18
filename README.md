<p align="center">
  <img src="build/icon.png" alt="Yardarm logo" width="128" height="128" />
</p>

<h1 align="center">Yardarm</h1>

<p align="center">
  A standalone desktop app for <a href="https://code.mastra.ai">Mastra Code</a>.
</p>

Yardarm is an Electron UI for the Mastra Code coding agent. The `mastracode`
runtime is bundled with the app — no separate install, no account required to
launch. It shares every config file with the `mastracode` CLI, so you can move
between the app and the terminal freely. A global CLI install is optional
(Settings → About offers a one-click install).

> Yardarm is an independent project that builds on Mastra Code. It is not
> affiliated with, endorsed by, or sponsored by Mastra.

## Why Mastra Code

Yardarm exists because Mastra Code is a genuinely different coding agent:

- **Observational Memory** — instead of compacting the conversation when
  context runs out, a background observer continuously distills what matters
  and a reflector condenses it further. The agent keeps working with a small,
  dense memory of the session, so long-running work doesn't fall off a cliff
  at the context limit.
- **Goals with a judge** — hand the agent an objective (`/goal`) and it keeps
  running until an independent judge model agrees the goal is met, not just
  until the first "done" claim.
- **Bring any model** — OAuth in with existing Claude, OpenAI Codex, or
  GitHub Copilot subscriptions, use API keys from a dozen providers, or point
  it at any OpenAI-compatible endpoint. Different models per mode, per
  subagent, per judge, and per memory role.
- **Deeply extensible** — MCP servers, lifecycle hooks, skills and plugins,
  subagents, and custom slash commands (plain `.md` files), all configurable
  globally or per project.
- **Open source and local-first** — configuration is plain files on disk,
  shared between the CLI, ACP editors, and this app.

## Features

**Agent chat**

- Streaming agent chat with tool-call cards, plan approval, and tool-approval
  prompts (allow once / always / deny)
- Plan / Build / Fast modes, per-mode model selection, extended-thinking
  toggle, and yolo mode
- Session permissions panel (`/permissions`): per-category and per-tool
  allow / ask / deny
- Goals (`/goal`) with a live goal banner, and Observational Memory status
  (`/om`) showing observer/reflector activity and token budgets
- Threads (`/threads`): switch, rename, clone, delete, open in a new subchat,
  with per-thread token usage in the cost popover (`/cost`)

**Slash commands**

- Autocomplete for the full command surface from code.mastra.ai — mode and
  model switches, threads, `/mcp`, `/hooks`, `/commands`, `/skills`,
  `/resource`, `/login`, `/api-keys`, `/diff`, `/help`, and more
- Project and global custom commands (`.md` files with frontmatter) are
  loaded through the mastracode command loader and run as prompts
- Commands that only make sense in a terminal (e.g. `/sandbox`, `/voice`)
  are listed in `/help` and point you to the CLI
- `pnpm check:commands` guards that the registry stays in sync with the
  documented command list

**Workspace**

- Projects sidebar with chats; each chat can run in an isolated git worktree
  (branch prefix `yardarm/`, optional `setup-worktree` commands from
  `.yardarm/worktree.json`)
- Changes view with side-by-side Monaco diffs, staging, commit, and push
- Checkpoints: every user message pins a restorable snapshot
  (`refs/yardarm/checkpoints/*`); roll back the conversation and the tree
- Read-only file viewer (tree + Monaco) and an integrated terminal
  (node-pty + xterm)
- Multiple windows, multiple subchats per chat

**Providers & auth**

- OAuth login for Anthropic (Claude subscriptions), OpenAI Codex, and GitHub
  Copilot — the browser flow runs inside the bundled runtime and credentials
  land in mastracode's `auth.json`
- API keys for any supported provider, plus custom OpenAI-compatible
  providers (base URL + models) in Settings → Providers
- Model defaults per mode, subagent, goal judge, and OM roles in
  Settings → Models — written to the shared `settings.json`

**Per-project configuration**

- Project Settings dialog (gear in the sidebar): MCP servers, lifecycle
  hooks, custom commands, agent instructions, memory `resourceId`, and
  installed skills/plugins
- Edits are atomic, preserve unknown keys, and restart affected agent
  processes so they take effect immediately

## Getting started

Requirements: Node 22+, [pnpm](https://pnpm.io) 10.

```sh
pnpm install
pnpm dev             # run in development
pnpm typecheck       # tsc for main + renderer
pnpm check:commands  # slash-command registry covers code.mastra.ai
pnpm build           # production build to out/
pnpm package         # unpacked app bundle (dist/, no installers)
pnpm dist            # package installers (electron-builder)
```

First run: add a project (folder) from the sidebar, open a chat, and either
paste an API key or use OAuth login in Settings → API Keys. Type `/` in the
prompt to explore commands, or `/help` for the full list.

## Configuration paths (shared with the mastracode CLI)

Global:

- `~/.mastracode/settings.json` — model defaults per mode, subagent models,
  goal judge, Observational Memory defaults, custom providers, preferences
- `~/.mastracode/mcp.json` — global MCP servers
- `~/.mastracode/hooks.json` — global lifecycle hooks
- `~/.mastracode/commands/**/*.md` — global custom slash commands
- `~/.mastracode/database.json` — global memory `resourceId`
- App-data dir (`~/Library/Application Support/mastracode` on macOS,
  `%APPDATA%\mastracode` on Windows, `$XDG_DATA_HOME/mastracode` on Linux):
  `auth.json` (API keys + OAuth credentials), agent database

Per project (Project Settings gear in the sidebar):

- `.mastracode/mcp.json` — project MCP servers
- `.mastracode/hooks.json` — project hooks (appended after global)
- `.mastracode/commands/**/*.md` — project slash commands
- `.mastracode/agent-instructions.md` — project agent instructions
- `.mastracode/database.json` — project memory `resourceId`

Edits made in the app are written atomically and preserve unknown keys, so the
same files stay usable from the CLI. Config edits restart the affected agent
processes so changes take effect.

## App data

The app's own state (projects, chats, transcripts, checkpoints) lives in a
SQLite database (`yardarm.db`) in Electron's userData directory, separate from
mastracode's files. The database runs in WAL mode with periodic maintenance
(vacuum/optimize, size-bounded transcripts) so long-lived installs don't
degrade.

## Architecture

- **Shell**: Electron + electron-vite, React 19, Tailwind 4, jotai, tRPC over
  IPC (superjson), Monaco, xterm
- **Agent host**: each active subchat forks a `utilityProcess` that imports
  the bundled `mastracode` SDK (`createMastraCode`) and speaks a small
  JSON message protocol with the main process (streaming events, requests
  with timeouts, OAuth flows)
- **Persistence**: better-sqlite3 + drizzle in the main process
- **Isolation**: chats can run in dedicated git worktrees; checkpoints are
  pinned as git refs so they survive GC until deleted
- **Packaging**: electron-builder; native modules are kept outside the asar
  (`asarUnpack`), and the mastracode runtime ships as a self-contained,
  npm-staged tree in `Resources/agent-runtime` (see
  `scripts/build-agent-runtime.mjs`) that the agent host imports when packaged

## License

Apache-2.0

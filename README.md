# Yardarm

Electron desktop UI for [Mastra Code](https://code.mastra.ai). The mastracode
runtime is bundled with the app — no separate install required. A global
`mastracode` CLI is optional (Settings → About offers a one-click install) and
shares all configuration with the app.

## Develop

```sh
pnpm install
pnpm dev          # run in development
pnpm typecheck    # tsc for main + renderer
pnpm check:commands  # slash-command registry covers code.mastra.ai
pnpm build        # production build to out/
pnpm dist         # package installers (electron-builder)
```

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
SQLite database in Electron's userData directory, separate from mastracode's
files.

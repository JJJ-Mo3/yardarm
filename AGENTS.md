# Yardarm — agent instructions

Yardarm is a standalone Electron desktop UI for the Mastra Code (mastracode) CLI coding agent.
No accounts or login — everything runs locally against mastracode's own config files.

## Architecture

- `src/main/` — Electron main process. Entry: `src/main/index.ts`.
  - `src/main/agent-host/agent-host.ts` — one `utilityProcess` is forked per active subchat; it
    imports the bundled mastracode SDK and speaks the JSON protocol defined in
    `src/shared/ipc-types.ts`. These two files are the SDK boundary — they are what changes when
    the vendored mastracode version changes.
  - `src/main/lib/agent/` — session manager, SDK-event → UI-message translation, storage clamp.
  - `src/main/lib/db/` — better-sqlite3 + drizzle; schema in `db/schema.ts`. The app DB
    (`yardarm.db`) lives in Electron userData, separate from mastracode's config.
  - `src/main/lib/git/` — worktree lifecycle (`worktree.ts`), git ops, gh CLI integration.
  - `src/main/lib/mastra-config/` — readers/writers for mastracode's shared JSON config files.
  - `src/main/lib/trpc/` — tRPC over IPC. `trpc.ts` exports `router`/`publicProcedure`
    (superjson transformer); one router file per domain in `trpc/routers/`, registered in
    `routers/index.ts`. Inputs are validated with zod.
- `src/preload/index.ts` — sandboxed; `trpc-electron` is bundled in (it cannot `require()`
  external modules).
- `src/renderer/src/` — React 19 UI. Feature folders under `features/<domain>/` (agents,
  changes, file-viewer, settings, sidebar, terminal, onboarding, project-settings, boot).
  Shared shadcn-style primitives in `components/ui/`; `lib/utils.ts` has `cn()` and `timeAgo()`.
- `src/shared/` — types shared across processes (`ipc-types.ts`, `ui-message.ts`,
  `mastra-settings.ts`). Path aliases: `@shared` (all processes), `@` (renderer only).

## Build & verify

- `pnpm dev` — run the app in dev mode.
- `pnpm typecheck` — two projects: `tsconfig.node.json` (main/preload/shared) and
  `tsconfig.web.json` (renderer). Must pass before committing.
- `pnpm lint`, `pnpm format:check`, `pnpm test` — ESLint, Prettier, Vitest.
- `pnpm check:commands` — verifies slash-command coverage against the canonical list.
- `pnpm package` — stages the agent runtime into `vendor/`, builds, and produces
  `dist/mac-arm64/Yardarm.app`. Repo convention: after packaging-affecting changes, boot-check
  the packaged binary (launch it, confirm it is still alive after ~10s with an empty error log)
  before committing.

## Code conventions

- Style is Prettier-enforced: no semicolons, single quotes, no trailing commas, print width 100.
- Exported functions have explicit return types; React components return `React.JSX.Element`.
- Nontrivial files start with a `/** ... */` header comment describing their purpose.
- Interactive controls (buttons, selects, switches, tabs) get a descriptive tooltip via the
  `Tip` wrapper from `src/renderer/src/components/ui/tooltip.tsx` — never a bare `title=`
  attribute. Wrap possibly-disabled controls in `<span className="inline-flex">` inside the Tip
  (disabled elements don't fire Radix tooltips). `title=` is acceptable only on non-interactive
  truncated text and `<option>` elements.
- Empty catch blocks (`catch {}`) are intentional for best-effort operations.
- mastracode config writes go through the queued atomic read-modify-write pattern in
  `src/main/lib/mastra-config/settings-json.ts` and must preserve unknown keys — the files are
  shared with the CLI.
- Messages are persisted through `clampMessageForStorage`
  (`src/main/lib/agent/message-clamp.ts`) so SQLite rows can't grow unboundedly.

## Gotchas

- `vendor/` is gitignored; `scripts/build-agent-runtime.mjs` stages a self-contained mastracode
  runtime there for packaging (npm-staged because electron-builder's pnpm walker mis-pairs
  multi-version `@ai-sdk/*` packages). mastracode deliberately lives in devDependencies.
- Native modules (better-sqlite3, node-pty) are `asarUnpack`ed — see `electron-builder.yml`.
- Each chat can run in its own git worktree under Electron userData
  (`worktrees/<projectId>/<chatId>`, branch prefix `yardarm/`); rollback checkpoints are stored
  as `refs/yardarm/checkpoints/*`. Repos without commits get a bootstrap "Initial commit".
- pnpm 10 reads the native build-script allowlist from `pnpm-workspace.yaml`
  (`onlyBuiltDependencies`), not package.json.
- Agent instructions: this file (`AGENTS.md`) is the single source of truth. `CLAUDE.md` and
  `.mastracode/agent-instructions.md` are one-line pointers — keep them that way, because
  mastracode ingests all three and duplicated content would be injected multiple times.

## Commits

- Short imperative subject line, no type prefixes (see `git log` for examples).
- Never add `Co-Authored-By` or "Generated with" trailers.

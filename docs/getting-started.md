# Getting started with Yardarm

Yardarm is a desktop app for the [Mastra Code](https://code.mastra.ai) coding
agent. You describe what you want in plain language; the agent reads your
code, proposes a plan, edits files, runs commands, and helps you review and
ship the result — all inside one window. The `mastracode` runtime is bundled
with the app: there is no separate install, no account, and no telemetry.

This guide walks through everything from installation to daily use. For a
shorter overview, see the [README](../README.md).

## Contents

- [Install](#install)
- [First launch: the setup wizard](#first-launch-the-setup-wizard)
- [Connecting a model](#connecting-a-model)
- [Your first project and chat](#your-first-project-and-chat)
- [The chat screen, piece by piece](#the-chat-screen-piece-by-piece)
- [Modes: Plan, Build, Fast](#modes-plan-build-fast)
- [Approvals and permissions](#approvals-and-permissions)
- [Reviewing and shipping changes](#reviewing-and-shipping-changes)
- [Checkpoints and rollback](#checkpoints-and-rollback)
- [Goals: let the agent run to completion](#goals-let-the-agent-run-to-completion)
- [Threads and subchats](#threads-and-subchats)
- [Terminal, IDE, and CLI tabs](#terminal-ide-and-cli-tabs)
- [The Kanban board and sidebar indicators](#the-kanban-board-and-sidebar-indicators)
- [Voice dictation](#voice-dictation)
- [Slash commands](#slash-commands)
- [Settings reference](#settings-reference)
- [Per-project configuration](#per-project-configuration)
- [Keeping Yardarm updated](#keeping-yardarm-updated)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Tips](#tips)
- [Where to get help](#where-to-get-help)

## Install

### Download a release (macOS, Apple Silicon)

Grab the latest `.dmg` (or `.zip`) from the
[Releases page](https://github.com/JJJ-Mo3/yardarm/releases) — currently
[v0.7.1](https://github.com/JJJ-Mo3/yardarm/releases/tag/v0.7.1)
([dmg](https://github.com/JJJ-Mo3/yardarm/releases/download/v0.7.1/Yardarm-0.7.1-arm64.dmg)
·
[zip](https://github.com/JJJ-Mo3/yardarm/releases/download/v0.7.1/Yardarm-0.7.1-arm64.zip))
— and drag `Yardarm.app` into `/Applications`.

Release builds are not code-signed, so macOS Gatekeeper will refuse a plain
double-click the first time ("Yardarm is damaged" or "cannot be opened").
Either right-click the app → **Open** → **Open**, or clear the quarantine
flag once:

```sh
xattr -dr com.apple.quarantine /Applications/Yardarm.app
```

### Build from source (all platforms)

Requirements: [Node](https://nodejs.org) 22+, [pnpm](https://pnpm.io) 10, git.

```sh
git clone https://github.com/JJJ-Mo3/yardarm.git
cd yardarm
pnpm install
pnpm dist        # installers into dist/ (dmg/zip, nsis, AppImage/deb)
# or
pnpm package     # unpacked app bundle, e.g. dist/mac-arm64/Yardarm.app
```

Targets: macOS (arm64 + x64), Windows (x64), Linux (AppImage + deb). Apps you
build yourself are not quarantined and open normally.

## First launch: the setup wizard

The first time you open Yardarm, a setup wizard walks you through the same
onboarding the `mastracode` CLI uses. Nothing is written to disk until the
final step, and you can skip any part of it.

1. **Welcome** — a reminder that everything runs locally and no account is
   created.
2. **Connect a provider** — sign in with an existing subscription (Claude,
   OpenAI Codex, or GitHub Copilot via OAuth), paste an API key, or skip and
   add a local model later.
3. **Mode pack** — choose which models power the Build / Plan / Fast modes.
   Pick a preset pack or choose per-mode.
4. **Observational Memory** — optionally choose the model used for the
   agent's background memory (see [Tips](#tips)).
5. **Yolo** — decide whether the agent may run tools without asking each
   time. You can change this later per chat.
6. **Summary** — review, then finish.

The wizard writes mastracode's own `settings.json`, so the CLI is configured
at the same time. Re-run it any time from **Settings → About → Run setup
again**.

## Connecting a model

Yardarm can drive models from subscriptions, API keys, or your own machine.
All of these are managed in **Settings** (`Cmd+,` / `Ctrl+,`):

- **Subscriptions (OAuth)** — Settings → **Providers** has sign-in buttons
  for Anthropic (Claude), OpenAI Codex, and GitHub Copilot. The browser flow
  completes in seconds and credentials are stored in mastracode's own
  `auth.json`.
- **API keys** — Settings → **API Keys** accepts keys for Anthropic, OpenAI,
  Google, OpenRouter, xAI, Groq, Mistral, Deepgram, and more. Keys go to the
  same `auth.json` the CLI reads and are only ever sent to their own
  provider.
- **Local models (Ollama)** — install [Ollama](https://ollama.com), pull a
  model, and open Settings → **Providers**. Yardarm detects a running Ollama
  server automatically and offers to start one if it's installed but not
  running. Tick the models you want to expose.
- **Any OpenAI-compatible server** — LM Studio, vLLM, llama.cpp, a remote
  gateway: add it in Settings → Providers with a name, base URL, and model
  ids. No API key needed for local servers.

Model dropdowns throughout the app only list models that are actually usable
right now (key present, login active, or server reachable), so an empty
dropdown means "connect something first".

> **Local model context windows matter.** The agent's base prompt is roughly
> 30k tokens before you type anything. Configure at least a 64k context
> window — 128k+ if you have the memory. Ollama defaults to ~4k; raise it in
> the Ollama app (Settings → Context length) or start the server with
> `OLLAMA_CONTEXT_LENGTH=65536 ollama serve`. Yardarm never imposes idle
> timeouts, so a big local model can think for minutes without being cut off.

## Your first project and chat

1. Click **Add project** in the sidebar and pick a folder. It doesn't need to
   be a git repository yet — Yardarm will initialize what it needs.
2. Create a chat (`Cmd+N`). By default each chat gets its own **git
   worktree**: a private checkout of your repo on a `yardarm/…` branch,
   stored under the app's data directory. The agent edits, builds, and
   commits there without touching your working copy — and several chats can
   work on the same repo in parallel without conflicts.
3. Type what you want and press **Enter**. That's it.

A few notes on worktrees:

- Repos with no commits yet get a bootstrap "Initial commit" automatically.
- If your project needs setup in a fresh checkout (dependency installs,
  codegen), put commands in `.yardarm/worktree.json` at the repo root:

  ```json
  { "setup-worktree": ["pnpm install"] }
  ```

- When the work is done, merge or PR the `yardarm/…` branch from the
  **Changes** tab (see [Reviewing and shipping changes](#reviewing-and-shipping-changes)).

## The chat screen, piece by piece

### The header

- **Mode selector** — three color-coded buttons: Plan (blue), Build (green),
  Fast (amber). See [Modes](#modes-plan-build-fast).
- **Model selector** — switch the active model for this chat.
- **think** — extended-thinking level (off / low / medium / high / xhigh).
  Higher levels are slower but better on hard problems.
- **auto-approve** — the "yolo" switch. On, the agent runs tools and edits
  files without asking; off, you approve each sensitive action.
- **sandbox** — run this chat's shell commands inside an OS-level sandbox.
  While it's on, a green shield chip appears next to the switch — click it
  to configure network access and allowed paths. See
  [Full sandbox](#full-sandbox-os-isolation).
- **goal** chip — set an objective the agent works toward across runs. The
  chip is color-coded once a goal is set: blue while active, amber when
  paused, green when done. See
  [Goals](#goals-let-the-agent-run-to-completion).
- **review** chip — have the agent code-review this chat's changes or an
  open PR. See [Agent code review](#agent-code-review).
- **Threads** (`Cmd+P`) — switch, rename, clone, or delete conversation
  threads. See [Threads and subchats](#threads-and-subchats).

### The transcript

- **Tool calls** appear as expandable cards — click one to see the exact
  command, file diff, or output.
- **Approval prompts** appear inline when the agent wants to do something
  sensitive, with **Allow once / Always allow / Deny** buttons.
- **Plan approval**: in Plan mode the agent ends with a plan card — approve
  it to let the agent start building, or edit/deny it.
- **Questions from the agent** appear as answer cards with options or a
  free-text field.
- **Task checklist** — when the agent breaks work into tasks, a collapsible
  "Tasks n/m" strip appears under the header showing live progress. It hides
  itself when everything is done.
- **Marker lines** — actions triggered from buttons (like reviews) don't
  post a user bubble; the transcript shows a compact muted one-liner
  (e.g. "Review: PR #42 — fix auth") instead. Hover it to roll back, like
  any message.

### The composer

- **Enter** sends; **Shift+Enter** inserts a newline.
- **`/`** opens slash-command autocomplete (arrow keys to navigate, Tab to
  complete, Enter to run).
- **`@`** searches project files and inserts a mention so the agent looks at
  that file.
- **Attachments** — click the paperclip, or paste/drag-and-drop images
  straight into the composer.
- **Mic button** — voice dictation, if enabled. See
  [Voice dictation](#voice-dictation).
- **While the agent is running**, the send button becomes **Queue**: messages
  you send are queued in a strip above the composer (each with a dismiss
  button) and delivered in order when the current run finishes. The red
  square button stops the current run.

## Modes: Plan, Build, Fast

| Mode      | Color | What it does                                                             |
| --------- | ----- | ------------------------------------------------------------------------ |
| **Plan**  | blue  | Read-only research. The agent explores and proposes a plan for approval. |
| **Build** | green | Full agent: edits files, runs commands, commits.                         |
| **Fast**  | amber | A lighter/faster model for quick tasks and questions.                    |

Switch with the header buttons or `/plan`, `/build`, `/fast`. Each chat
remembers its own mode across restarts, and each mode can have its own
default model (Settings → Models).

A good rhythm for nontrivial work: start in **Plan**, let the agent explore
and propose, approve the plan, and let it flip to **Build** to execute.

## Approvals and permissions

Unless auto-approve is on, the agent asks before sensitive actions (running
commands, editing files, calling MCP tools). Each prompt offers:

- **Allow once** — just this call.
- **Always allow** — this tool for the rest of the session.
- **Deny** — block it and tell the agent why, if you like.

For finer control, run `/permissions` to open the permissions panel: per
category (read / edit / execute / MCP / other) and per tool, set
**allow / ask / deny** for the session.

The **auto-approve** switch in the header is the blunt instrument: everything
runs without asking. Recommended only in isolated worktrees (the default) and
projects you can afford to roll back.

### Full sandbox (OS isolation)

Approvals control _whether_ a command runs; the full sandbox controls what it
can touch once it does. Flip the **sandbox** switch in the chat header (or
run `/sandbox`) to execute the agent's shell commands inside an OS-level
sandbox — seatbelt on macOS, bubblewrap on Linux (install the `bwrap`
package first). Not available on Windows.

What it does — and, honestly, what it doesn't:

- **Writes are contained.** Sandboxed commands can only write inside the
  chat's worktree, the sandbox allowed paths, and temp directories; writes
  anywhere else fail.
- **Reads are not restricted.** The sandbox limits damage, not what the
  agent can look at.
- **Network is all-or-nothing.** Allowed by default; the **Allow network**
  switch blocks it entirely (installs, fetches, and pushes will fail while
  blocked).

If the agent needs to write somewhere else, it asks with a **sandbox access
request** card — approving adds that directory to the allowed paths, and the
grant applies to sandboxed commands immediately, no restart needed.

The setting persists per chat, and a green shield chip appears in the header
while it's active (with "no net" when the network is blocked) — click it to
reconfigure. Defaults for new chats live in Settings → **Preferences** →
Agent sandbox. Pairs well with auto-approve: yolo speed, contained blast
radius.

### Token compression

Long sessions accumulate big tool outputs the model keeps re-reading on every
turn. Flip **Token compression** in Settings → **Preferences** to shrink
stale tool outputs in the prompt sent to the model:

- duplicate results are replaced with a stub pointing at the first occurrence
- big homogeneous JSON arrays are crushed to their head and tail (error-like
  items are preserved), including arrays nested one level inside objects
- noisy text is cleaned: ANSI color codes stripped, repeated log lines
  collapsed
- anything still long is reduced to a head+tail excerpt

Recent turns are never touched, and compression is reversible: every
replacement names its `toolCallId`, and the agent can fetch the original via
the built-in `retrieve_full_output` tool (or just re-run the original tool).
The toggle is global and applies to all chats immediately, no restart needed.
Stored chat history is never modified: compression happens transiently per
model call, so transcripts, rollbacks, and threads are unaffected. The
estimated tokens saved show up as a green **Saved by compression** line in
the cost popover (`/cost`).

The separate **Verbosity steering** switch in the same card appends a short
constant instruction to the system prompt asking the agent not to restate
tool outputs and to keep replies brief — it works with or without output
compression and doesn't disturb provider prompt caching.

## Reviewing and shipping changes

The **Changes** tab (`Cmd+4`) is a full review-and-ship surface for the
chat's worktree:

- **Diffs** — side-by-side Monaco diffs of every changed file.
- **Stage / unstage** files and **commit** with a message.
- **Commit history** for the worktree branch.
- **Push**, **pull**, and **merge into base** — merge the `yardarm/…` branch
  back into the branch you started from, or use the `gh` CLI integration for
  PR flows if `gh` is installed.
- **Agent review** — the magnifier button asks the chat's agent to review
  the branch's local changes. See [Agent code review](#agent-code-review).

Nothing the agent does in a worktree touches your own checkout until you
merge it.

### Agent code review

Click the **review** button in the chat header (next to the goal chip) to
open the review picker:

- **Review local changes** — reviews the branch's committed work against
  its base branch, plus anything uncommitted.
- **Open PRs** — pick any open pull request from the list to review it
  (requires the [GitHub CLI](https://cli.github.com), `gh`).
- The optional **focus** field steers the review toward a specific concern
  ("error handling", "security", a file name, …).

Reviews run silently: no user message is posted — the transcript just shows
a compact "Review: local changes" or "Review: PR #42 — …" marker line
(hover it to roll back, like any message). If a run is already active, the
review queues behind it.

When the review finishes, a follow-up bar appears above the composer:

- **Post review as PR comments** — the agent posts its findings on the PR
  with `gh` (comment only — it never approves or requests changes). Offered
  after PR reviews, and after local reviews when the branch has an open PR.
- **Build a plan to execute** — switches to Plan mode and turns the
  findings into a prioritized implementation plan for approval.

The same review can be started from the magnifier button on the Changes tab
or from the keyboard: `/review changes` (local), `/review <pr-number>` (a
PR), `/review` alone (list open PRs to pick from); append a focus to either
form, e.g. `/review 42 security`.

## Checkpoints and rollback

Every message you send pins a **checkpoint**: a real git ref
(`refs/yardarm/checkpoints/*`) snapshotting the worktree at that moment.

To rewind, hover over one of your messages and click the circular-arrow
pill next to it (it only appears when there is actually something to roll
back). Confirming will:

1. Restore all files to the snapshot taken just before that message.
2. Remove that message and everything after it from the conversation.
3. Put the message text back in the composer so you can edit and resend it.
4. Tell the agent (on your next message) that a rollback happened, so it
   doesn't act on stale memory.

## Goals: let the agent run to completion

For bigger objectives, click the **goal** chip in the header (or use
`/goal`) and describe the outcome you want. The agent keeps working across
runs until an independent **judge model** agrees the goal is met — not just
until the agent claims it is.

By default **Set goal & start** kicks off a run toward the goal
immediately. Untick **Start working right away** if you'd rather set the
goal first and launch it with your own detailed prompt — the judge then
starts evaluating from your next message. If a run is already in progress,
the goal simply attaches to it. Resuming a paused goal also picks the work
back up right away when the agent is idle.

In the goal popover you can:

- set or edit the objective,
- choose the judge model,
- cap the number of runs,
- pause/resume, or clear the goal.

A banner above the transcript shows live goal status: blue while active,
amber when paused, green when the judge signs off.

## Threads and subchats

Each chat can hold multiple **threads** — independent conversation histories
over the same worktree. Press `Cmd+P` or use `/threads` to switch, rename,
clone, or delete threads, or open one in a new **subchat** (its own agent
process, running in parallel). The cost popover (`/cost`) breaks token usage
down per thread.

## Terminal, IDE, and CLI tabs

- **Terminal** (`Cmd+5`, or toggle with `Cmd+J`) — a real shell that opens in
  the chat's worktree. Build, test, poke around; you and the agent are
  looking at the same files.
- **IDE** (`Cmd+3`) — a file tree + Monaco editor scoped to the worktree.
  Open multiple files as tabs and save with `⌘S`. Every save is tracked per
  project/worktree and survives app restarts: each chat working on that
  root is told about your edit immediately — pushed into the run while its
  agent is working, or written into the chat's memory while it's idle, no
  message needed (edits saved during a permission prompt are delivered
  right after you answer it). The transcript shows a "Told the agent about
  IDE edits" line either way; brand-new chats with no messages yet get the
  note alongside your first prompt. Clean files the agent changes refresh
  automatically, and saving over a file the agent just changed prompts you
  to overwrite or reload.
- **CLI** (`Cmd+2`) — the interactive Mastra Code terminal UI, embedded,
  running in the same worktree and seeing the same threads as the chat.
  Handy for CLI-only commands (terminal voice mode, …). Avoid
  driving the same thread from the chat and the CLI at the same time.

## The Kanban board and sidebar indicators

When you're running several agents at once, the **Kanban** tab (`Cmd+6`)
shows every chat in the project as a card in one of four live columns:

| Column              | Meaning                             |
| ------------------- | ----------------------------------- |
| **Needs input**     | the agent asked you something       |
| **In progress**     | the agent is working right now      |
| **Ready to review** | a run finished you haven't seen yet |
| **Idle**            | nothing happening                   |

The same states appear as dots on chat rows in the sidebar: amber = waiting
for you, spinner = working, blue = finished and unseen.

When a chat is finished but you want to keep it around, hover its sidebar
row and click the **archive** icon: the chat disappears from the list and
the board without deleting its worktree or history. Archived chats collapse
into an **Archived** section at the bottom of the sidebar, where they can be
restored or deleted.

## Voice dictation

Yardarm can transcribe your voice straight into the composer using a cloud
speech-to-text provider.

1. Open **Settings → Voice** and enable voice input with the **Cloud**
   engine.
2. Pick an STT provider and model — OpenAI (Whisper, GPT-4o Transcribe),
   Groq (Whisper large v3), Deepgram (Nova-3), and several other Whisper
   hosts are supported.
3. The provider's API key is a prerequisite: add it under Settings →
   **API Keys** if you haven't. The Voice tab shows which providers have
   keys, and the toggle stays off until one does.

Then, in any chat, click the **mic button** in the composer:

- Click to start recording (the button pulses red and shows elapsed time),
  click again to stop and transcribe. Or press-and-hold to talk, release to
  transcribe.
- **Escape** cancels a recording and discards the audio.
- Transcribed text is appended to the prompt for you to edit before sending.

Audio is sent only to the STT provider you selected. If dictation isn't
enabled (or no provider has a key), the mic button is hidden entirely.

## Slash commands

Type `/` in the composer to see everything available — the full Mastra Code
command surface plus app commands. Highlights:

| Command                   | What it does                       |
| ------------------------- | ---------------------------------- |
| `/plan` `/build` `/fast`  | switch mode                        |
| `/model`                  | switch model                       |
| `/goal`                   | set a goal                         |
| `/threads`                | manage threads                     |
| `/permissions`            | session permissions panel          |
| `/sandbox`                | full sandbox + session settings    |
| `/mcp` `/hooks` `/skills` | inspect MCP servers, hooks, skills |
| `/om`                     | Observational Memory status        |
| `/cost`                   | token usage per thread             |
| `/diff`                   | show working-tree changes          |
| `/review`                 | review a PR or the local changes   |
| `/help`                   | the full list                      |

You can define your own commands as plain Markdown files:
`~/.mastracode/commands/**/*.md` (global) or `.mastracode/commands/**/*.md`
(per project). They appear in the autocomplete like built-ins. A few
terminal-only commands (e.g. `/voice`) are listed in `/help` and point you
to the CLI tab.

## Settings reference

Open with `Cmd+,` (`Ctrl+,`).

| Tab             | What's there                                                                                                                                            |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Appearance**  | light / dark / system theme (also togglable from the sidebar footer)                                                                                    |
| **Preferences** | default auto-approve (yolo), CLI theme, default thinking level, tool-output previews, new-chat sandbox defaults, token compression + verbosity steering |
| **API Keys**    | provider API keys (stored in mastracode's `auth.json`)                                                                                                  |
| **Models**      | default model per mode, subagent, goal judge, and memory role; model packs                                                                              |
| **Providers**   | OAuth logins (Claude / Codex / Copilot), Ollama detection, custom local providers                                                                       |
| **Voice**       | dictation engine, STT provider and model                                                                                                                |
| **Browser**     | browser-automation settings for web tools                                                                                                               |
| **MCP Servers** | global Model Context Protocol servers                                                                                                                   |
| **About**       | versions, runtime boot status, CLI install, updates, re-run setup                                                                                       |

Everything you change here is written to mastracode's own config files
(atomically, preserving keys the app doesn't know about), so the CLI picks up
the same configuration.

## Per-project configuration

Click the **gear** next to the project name in the sidebar to configure a
single project:

- **General** — rename, archive, or remove the project. Archived projects move
  to an "Archived" group at the bottom of the project picker, from where they
  can be reopened and unarchived. Removing a project deletes its chats and
  worktrees but keeps the project folder on disk unless you tick the option to
  delete it too.
- **MCP servers** (`.mastracode/mcp.json`)
- **Lifecycle hooks** (`.mastracode/hooks.json`, appended after global hooks)
- **Custom slash commands** (`.mastracode/commands/**/*.md`)
- **Custom subagents** (`.mastracode/agents/*.md`, or `~/.mastracode/agents/`
  for every project) — helpers the main agent can delegate tasks to via the
  `subagent` tool (`/subagents` opens this tab). Each file has a frontmatter
  block (`name`, `description` — required, `model`, `maxSteps`, `forked`) and
  the body is the subagent's instructions. Saving restarts the affected agent
  processes; the ids `explore`, `plan`, `execute` and `general` are reserved.
- **Agent instructions** (`.mastracode/agent-instructions.md`) — standing
  guidance the agent reads on every run
- **Memory resource id** (`.mastracode/database.json`)
- Installed **skills and plugins**

Edits restart the affected agent processes, so they take effect immediately.

## Keeping Yardarm updated

**Settings → About → Updates**:

- **Check for updates** queries this project's GitHub Releases.
- If a newer version exists, **Install** downloads and stages it in the
  background; an amber **"Restart to finish"** banner appears when it's
  ready. The restart is always your click.
- **Automatically update** (on by default in release builds) checks shortly
  after launch and every few hours, staging updates silently.

Self-install works on packaged macOS builds. Elsewhere (or in dev builds) the
app offers a **View release** link instead. Update checks are the only
network traffic Yardarm itself makes — everything else goes to the model
providers you configured.

## Keyboard shortcuts

`Cmd` on macOS, `Ctrl` on Windows/Linux.

| Shortcut      | Action                                                      |
| ------------- | ----------------------------------------------------------- |
| `Cmd+N`       | new chat                                                    |
| `Cmd+P`       | thread switcher                                             |
| `Cmd+1`–`6`   | switch tab (Chat / CLI / IDE / Changes / Terminal / Kanban) |
| `Cmd+J`       | toggle the Terminal tab                                     |
| `Cmd+,`       | settings                                                    |
| `Enter`       | send (in composer)                                          |
| `Shift+Enter` | newline (in composer)                                       |
| `Escape`      | cancel voice recording / close autocomplete popups          |

## Tips

- **Start in Plan mode** for anything nontrivial. Reviewing a plan is much
  cheaper than reviewing a surprise.
- **Run chats in parallel.** Worktrees make it safe — give each chat a
  separate task on the same repo and watch the Kanban board.
- **Use `@` mentions** to point the agent at the exact files that matter
  instead of hoping it finds them.
- **Queue follow-ups** while the agent works instead of interrupting; they're
  delivered in order when the run ends.
- **Long sessions don't fall off a cliff.** Mastra Code's Observational
  Memory distills the conversation in the background instead of compacting
  it, so multi-hour sessions keep their thread. Check `/om` to see it work.
- **Local models:** context window ≥ 64k, and start a fresh chat when a long
  session slows down — that resets the conversation and frees context.
- **The CLI is always there.** Settings → About installs the global
  `mastracode` CLI in one click; it shares every config file with the app.

## Where to get help

- **Settings → About** shows the bundled runtime's boot status and the full
  error text if the agent fails to start.
- The [README troubleshooting section](../README.md#troubleshooting) covers
  common issues (unsigned-build warnings, empty model dropdowns, context
  window errors, worktree failures).
- Otherwise, [open an issue](https://github.com/JJJ-Mo3/yardarm/issues) with
  the error text from Settings → About or the chat.

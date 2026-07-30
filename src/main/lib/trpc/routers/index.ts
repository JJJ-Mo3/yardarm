import { publicProcedure, router } from '../trpc'
import { agentRouter } from './agent'
import { analyticsRouter } from './analytics'
import { chatsRouter } from './chats'
import { checkpointsRouter } from './checkpoints'
import { filesRouter } from './files'
import { gitRouter } from './git'
import { goalsRouter } from './goals'
import { kanbanRouter } from './kanban'
import { lspPacksRouter } from './lsp-packs'
import { mastraSettingsRouter } from './mastra-settings'
import { mcpRouter } from './mcp'
import { projectConfigRouter } from './project-config'
import { projectsRouter } from './projects'
import { settingsRouter } from './settings'
import { systemRouter } from './system'
import { terminalRouter } from './terminal'
import { updatesRouter } from './updates'
import { voiceRouter } from './voice'

export const appRouter = router({
  ping: publicProcedure.query(() => 'pong'),
  projects: projectsRouter,
  chats: chatsRouter,
  agent: agentRouter,
  analytics: analyticsRouter,
  checkpoints: checkpointsRouter,
  git: gitRouter,
  goals: goalsRouter,
  kanban: kanbanRouter,
  lspPacks: lspPacksRouter,
  terminal: terminalRouter,
  files: filesRouter,
  settings: settingsRouter,
  mastraSettings: mastraSettingsRouter,
  mcp: mcpRouter,
  projectConfig: projectConfigRouter,
  system: systemRouter,
  updates: updatesRouter,
  voice: voiceRouter
})

export type AppRouter = typeof appRouter

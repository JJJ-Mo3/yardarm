import { publicProcedure, router } from '../trpc'
import { agentRouter } from './agent'
import { chatsRouter } from './chats'
import { filesRouter } from './files'
import { gitRouter } from './git'
import { mastraSettingsRouter } from './mastra-settings'
import { mcpRouter } from './mcp'
import { projectConfigRouter } from './project-config'
import { projectsRouter } from './projects'
import { settingsRouter } from './settings'
import { systemRouter } from './system'
import { terminalRouter } from './terminal'
import { updatesRouter } from './updates'

export const appRouter = router({
  ping: publicProcedure.query(() => 'pong'),
  projects: projectsRouter,
  chats: chatsRouter,
  agent: agentRouter,
  git: gitRouter,
  terminal: terminalRouter,
  files: filesRouter,
  settings: settingsRouter,
  mastraSettings: mastraSettingsRouter,
  mcp: mcpRouter,
  projectConfig: projectConfigRouter,
  system: systemRouter,
  updates: updatesRouter
})

export type AppRouter = typeof appRouter

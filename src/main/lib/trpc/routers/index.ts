import { publicProcedure, router } from '../trpc'
import { agentRouter } from './agent'
import { chatsRouter } from './chats'
import { filesRouter } from './files'
import { gitRouter } from './git'
import { mcpRouter } from './mcp'
import { projectsRouter } from './projects'
import { settingsRouter } from './settings'
import { terminalRouter } from './terminal'

export const appRouter = router({
  ping: publicProcedure.query(() => 'pong'),
  projects: projectsRouter,
  chats: chatsRouter,
  agent: agentRouter,
  git: gitRouter,
  terminal: terminalRouter,
  files: filesRouter,
  settings: settingsRouter,
  mcp: mcpRouter
})

export type AppRouter = typeof appRouter

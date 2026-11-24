import { publicProcedure, router } from '../trpc'
import { agentRouter } from './agent'
import { analyticsRouter } from './analytics'
import { chatsRouter } from './chats'
import { checkpointsRouter } from './checkpoints'
import { compareRouter } from './compare'
import { externalRouter } from './external'
import { factoryRouter } from './factory'
import { factoryWorkRouter } from './factory-work'
import { filesRouter } from './files'
import { gitRouter } from './git'
import { goalsRouter } from './goals'
import { integrationsRouter } from './integrations'
import { knowledgeNotesRouter } from './knowledge-notes'
import { lspPacksRouter } from './lsp-packs'
import { mastraSettingsRouter } from './mastra-settings'
import { mcpRouter } from './mcp'
import { previewRouter } from './preview'
import { projectConfigRouter } from './project-config'
import { projectsRouter } from './projects'
import { schedulesRouter } from './schedules'
import { searchRouter } from './search'
import { settingsRouter } from './settings'
import { sideQuestionRouter } from './side-question'
import { systemRouter } from './system'
import { terminalRouter } from './terminal'
import { updatesRouter } from './updates'
import { voiceRouter } from './voice'
import { wikiRouter } from './wiki'
import { workflowsRouter } from './workflows'

export const appRouter = router({
  ping: publicProcedure.query(() => 'pong'),
  projects: projectsRouter,
  chats: chatsRouter,
  agent: agentRouter,
  analytics: analyticsRouter,
  checkpoints: checkpointsRouter,
  compare: compareRouter,
  external: externalRouter,
  factory: factoryRouter,
  factoryWork: factoryWorkRouter,
  git: gitRouter,
  goals: goalsRouter,
  integrations: integrationsRouter,
  knowledgeNotes: knowledgeNotesRouter,
  lspPacks: lspPacksRouter,
  terminal: terminalRouter,
  files: filesRouter,
  settings: settingsRouter,
  sideQuestion: sideQuestionRouter,
  mastraSettings: mastraSettingsRouter,
  mcp: mcpRouter,
  preview: previewRouter,
  projectConfig: projectConfigRouter,
  schedules: schedulesRouter,
  search: searchRouter,
  system: systemRouter,
  updates: updatesRouter,
  voice: voiceRouter,
  wiki: wikiRouter,
  workflows: workflowsRouter
})

export type AppRouter = typeof appRouter

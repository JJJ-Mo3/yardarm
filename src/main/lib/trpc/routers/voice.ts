/**
 * In-app voice dictation: cloud speech-to-text via the agent host, plus macOS
 * microphone permission plumbing. Voice settings editing stays in
 * mastra-settings.ts — this router only consumes the current config.
 */
import { systemPreferences } from 'electron'
import { z } from 'zod'
import { agentSessionManager } from '../../agent/agent-session-manager'
import { readSettings } from '../../mastra-config/settings-json'
import { publicProcedure, router } from '../trpc'

// A 5-minute recording at 32 kbps opus is ~1.6 MB of base64; this backstop
// bounds tRPC/utilityProcess IPC payloads with generous headroom.
const MAX_AUDIO_BASE64_CHARS = 16_000_000

export const voiceRouter = router({
  transcribe: publicProcedure
    .input(
      z.object({
        audioBase64: z.string().min(1).max(MAX_AUDIO_BASE64_CHARS),
        mimeType: z.string().min(1)
      })
    )
    .mutation(async ({ input }) => {
      // Read live settings per call — voice edits apply without a host restart.
      const settings = await readSettings()
      const v = settings.voice ?? {}
      if (!v.enabled) {
        throw new Error('Voice input is disabled — enable it in Settings → Voice.')
      }
      if ((v.engine ?? 'macos-native') !== 'cloud') {
        throw new Error(
          'Native dictation runs in the mastracode CLI — switch the engine to Cloud in Settings → Voice.'
        )
      }
      return agentSessionManager.transcribe({
        ...input,
        provider: v.provider,
        model: v.model ?? undefined
      })
    }),

  /** 'granted' | 'denied' | 'restricted' | 'not-determined' ('granted' off-macOS). */
  micAccessStatus: publicProcedure.query(() =>
    process.platform === 'darwin'
      ? systemPreferences.getMediaAccessStatus('microphone')
      : ('granted' as const)
  ),

  /** Trigger the macOS microphone TCC prompt (no-op true elsewhere). */
  requestMicAccess: publicProcedure.mutation(async () =>
    process.platform === 'darwin' ? systemPreferences.askForMediaAccess('microphone') : true
  )
})

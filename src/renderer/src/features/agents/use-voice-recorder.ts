/**
 * Microphone recording + cloud transcription for the composer mic button.
 * Records webm/opus via MediaRecorder, sends the clip to the voice.transcribe
 * tRPC mutation (agent host does the provider HTTP), and hands the transcript
 * back through onTranscript. Esc cancels via a capture-phase listener so it
 * only wins over other Esc handling while a recording is active.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { trpc } from '../../lib/trpc'

export type VoiceRecorderState = 'idle' | 'recording' | 'transcribing'

export interface VoiceRecorder {
  state: VoiceRecorderState
  /** ms since recording started (for the mm:ss readout). */
  elapsedMs: number
  /** getUserMedia + MediaRecorder.start(); errors surface via onError. */
  start: () => Promise<void>
  /** Stop and transcribe; the transcript surfaces via onTranscript. */
  stop: () => void
  /** Discard the recording without transcribing (Esc). */
  cancel: () => void
  /** false when MediaRecorder/getUserMedia are unavailable. */
  supported: boolean
}

/** Hold the mic button past this to get push-to-talk (release stops). */
export const HOLD_THRESHOLD_MS = 400

/** What releasing the mic button should do, given how the press began. */
export function micReleaseAction(input: {
  /** This press is the one that started the recording. */
  pressStartedRecording: boolean
  heldMs: number
}): 'stop' | 'keep-recording' {
  if (!input.pressStartedRecording) return 'stop' // second click of the toggle
  return input.heldMs >= HOLD_THRESHOLD_MS ? 'stop' : 'keep-recording'
}

/** Render elapsed milliseconds as m:ss. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

const DEFAULT_MAX_DURATION_MS = 300_000 // 5 minutes — bounds the IPC payload

export function useVoiceRecorder(opts: {
  onTranscript: (text: string) => void
  onError: (message: string) => void
  maxDurationMs?: number
}): VoiceRecorder {
  const [state, setState] = useState<VoiceRecorderState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const transcribe = trpc.voice.transcribe.useMutation()

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const cancelledRef = useRef(false)
  const startedAtRef = useRef(0)
  const timersRef = useRef<{ tick?: ReturnType<typeof setInterval> }>({})
  // Callbacks live in refs so start/stop identities stay stable.
  const onTranscriptRef = useRef(opts.onTranscript)
  const onErrorRef = useRef(opts.onError)
  onTranscriptRef.current = opts.onTranscript
  onErrorRef.current = opts.onError
  const maxDurationMs = opts.maxDurationMs ?? DEFAULT_MAX_DURATION_MS

  const supported = typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

  const clearTick = useCallback((): void => {
    if (timersRef.current.tick) clearInterval(timersRef.current.tick)
    timersRef.current.tick = undefined
  }, [])

  const teardown = useCallback((): void => {
    clearTick()
    const rec = recorderRef.current
    recorderRef.current = null
    if (rec) {
      rec.stream.getTracks().forEach((t) => t.stop())
      if (rec.state !== 'inactive') {
        try {
          rec.stop()
        } catch {}
      }
    }
  }, [clearTick])

  const stop = useCallback((): void => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    clearTick()
    setState('transcribing')
    rec.stop() // onstop assembles + transcribes
  }, [clearTick])

  const cancel = useCallback((): void => {
    if (!recorderRef.current) return
    cancelledRef.current = true
    teardown()
    setState('idle')
  }, [teardown])

  const start = useCallback(async (): Promise<void> => {
    if (recorderRef.current) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const denied = err instanceof DOMException && err.name === 'NotAllowedError'
      onErrorRef.current(
        denied
          ? 'Microphone access was denied — allow Yardarm in System Settings → Privacy & Security → Microphone.'
          : `Could not start recording: ${err instanceof Error ? err.message : String(err)}`
      )
      return
    }
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm'
    // 32 kbps opus keeps a 5-minute clip around 1.2 MB.
    const rec = new MediaRecorder(stream, { mimeType, audioBitsPerSecond: 32_000 })
    recorderRef.current = rec
    chunksRef.current = []
    cancelledRef.current = false
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      const chunks = chunksRef.current
      chunksRef.current = []
      recorderRef.current = null
      if (cancelledRef.current) return
      const blob = new Blob(chunks, { type: mimeType })
      if (blob.size === 0) {
        setState('idle')
        onErrorRef.current('No audio was captured.')
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        const url = reader.result as string
        const audioBase64 = url.slice(url.indexOf(',') + 1)
        transcribe
          .mutateAsync({ audioBase64, mimeType })
          .then(({ text }) => {
            setState('idle')
            if (text.trim()) onTranscriptRef.current(text.trim())
            else onErrorRef.current('No speech detected.')
          })
          .catch((err: unknown) => {
            setState('idle')
            onErrorRef.current(err instanceof Error ? err.message : String(err))
          })
      }
      reader.onerror = () => {
        setState('idle')
        onErrorRef.current('Failed to read the recorded audio.')
      }
      reader.readAsDataURL(blob)
    }
    rec.start()
    startedAtRef.current = Date.now()
    setElapsedMs(0)
    setState('recording')
    timersRef.current.tick = setInterval(() => {
      const elapsed = Date.now() - startedAtRef.current
      setElapsedMs(elapsed)
      if (elapsed >= maxDurationMs) stop()
    }, 250)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxDurationMs, stop])

  // Esc cancels — capture phase so it wins over textarea/popup handlers, and
  // it's only installed while recording so normal Esc behavior is untouched.
  useEffect(() => {
    if (state !== 'recording') return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      cancel()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [state, cancel])

  // Discard everything if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      cancelledRef.current = true
      teardown()
    }
  }, [teardown])

  return { state, elapsedMs, start, stop, cancel, supported }
}

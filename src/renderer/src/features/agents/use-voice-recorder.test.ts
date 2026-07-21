import { describe, expect, it } from 'vitest'
import { HOLD_THRESHOLD_MS, formatElapsed, micReleaseAction } from './use-voice-recorder'

describe('micReleaseAction', () => {
  it('keeps recording after a quick click that started the recording (toggle armed)', () => {
    expect(micReleaseAction({ pressStartedRecording: true, heldMs: HOLD_THRESHOLD_MS - 1 })).toBe(
      'keep-recording'
    )
  })

  it('stops when the starting press was held past the threshold (push-to-talk)', () => {
    expect(micReleaseAction({ pressStartedRecording: true, heldMs: HOLD_THRESHOLD_MS })).toBe(
      'stop'
    )
    expect(micReleaseAction({ pressStartedRecording: true, heldMs: 5000 })).toBe('stop')
  })

  it('stops on a press while already recording (second click of the toggle)', () => {
    expect(micReleaseAction({ pressStartedRecording: false, heldMs: 10 })).toBe('stop')
    expect(micReleaseAction({ pressStartedRecording: false, heldMs: 5000 })).toBe('stop')
  })
})

describe('formatElapsed', () => {
  it('formats m:ss with zero-padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(999)).toBe('0:00')
    expect(formatElapsed(1000)).toBe('0:01')
    expect(formatElapsed(59_000)).toBe('0:59')
    expect(formatElapsed(60_000)).toBe('1:00')
    expect(formatElapsed(305_500)).toBe('5:05')
  })
})

/** Tests for the stall-watchdog error marker shared by host and session manager. */
import { describe, expect, it } from 'vitest'
import { isStallError, STALL_ERROR_MARKER } from './stall-error'

describe('isStallError', () => {
  it('matches the host watchdog message for both stall kinds', () => {
    expect(
      isStallError(
        `A tool call produced no output for ~15 minutes — ${STALL_ERROR_MARKER}. ` +
          'Send a new message to retry.'
      )
    ).toBe(true)
    expect(
      isStallError(
        `No response from the model provider for ~10 minutes — ${STALL_ERROR_MARKER}. ` +
          'Send a new message to retry.'
      )
    ).toBe(true)
  })

  it('ignores unrelated errors', () => {
    expect(isStallError('rate limit exceeded')).toBe(false)
    expect(isStallError('This model does not support assistant message prefill.')).toBe(false)
    expect(isStallError('')).toBe(false)
  })
})

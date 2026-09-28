/**
 * Tests for the lossless .env model backing the Factory harness.
 */
import { describe, expect, it } from 'vitest'
import { getEnv, listEnv, parseEnvFile, serializeEnvFile, upsertEnv } from './env-file'

const FIXTURE = [
  '# Factory server configuration',
  '',
  'PORT=4111',
  'DATABASE_URL=postgresql://factory:factory@localhost:5433/factory',
  'FACTORY_CREDENTIAL_ENCRYPTION_KEY=',
  '# Sandboxes',
  'FACTORY_SANDBOX_PROVIDER=local',
  "SINGLE_QUOTED='hello world' # trailing note",
  'DOUBLE_QUOTED="line1\\nline2 \\"quoted\\""',
  'export EXPORTED=yes',
  'SPACED = padded',
  'not a pair at all',
  'URL_WITH_HASH=https://example.com/a#frag'
].join('\n')

describe('parseEnvFile', () => {
  it('classifies pairs, comments, blanks, and junk', () => {
    const lines = parseEnvFile(FIXTURE + '\n')
    const kinds = lines.map((l) => l.kind)
    expect(kinds).toEqual([
      'other',
      'other',
      'pair',
      'pair',
      'pair',
      'other',
      'pair',
      'pair',
      'pair',
      'pair',
      'pair',
      'other',
      'pair'
    ])
  })

  it('decodes quoting styles with dotenv semantics', () => {
    const lines = parseEnvFile(FIXTURE)
    expect(getEnv(lines, 'SINGLE_QUOTED')).toBe('hello world')
    expect(getEnv(lines, 'DOUBLE_QUOTED')).toBe('line1\nline2 "quoted"')
    expect(getEnv(lines, 'EXPORTED')).toBe('yes')
    expect(getEnv(lines, 'SPACED')).toBe('padded')
    expect(getEnv(lines, 'URL_WITH_HASH')).toBe('https://example.com/a#frag')
    expect(getEnv(lines, 'FACTORY_CREDENTIAL_ENCRYPTION_KEY')).toBe('')
    expect(getEnv(lines, 'MISSING')).toBeUndefined()
  })

  it('keeps an unterminated quote verbatim as other', () => {
    const lines = parseEnvFile('BROKEN="oops\n')
    expect(lines[0].kind).toBe('other')
    expect(serializeEnvFile(lines)).toBe('BROKEN="oops\n')
  })
})

describe('serializeEnvFile round-trips', () => {
  it('is byte-identical with a trailing newline', () => {
    const text = FIXTURE + '\n'
    expect(serializeEnvFile(parseEnvFile(text))).toBe(text)
  })

  it('is byte-identical without a trailing newline', () => {
    expect(serializeEnvFile(parseEnvFile(FIXTURE))).toBe(FIXTURE)
  })

  it('is byte-identical with CRLF line endings', () => {
    const crlf = FIXTURE.replace(/\n/g, '\r\n') + '\r\n'
    expect(serializeEnvFile(parseEnvFile(crlf))).toBe(crlf)
  })

  it('round-trips the empty file', () => {
    expect(serializeEnvFile(parseEnvFile(''))).toBe('')
  })
})

describe('upsertEnv', () => {
  it('changes only the targeted line, leaving all other bytes intact', () => {
    const text = FIXTURE + '\n'
    const updated = serializeEnvFile(upsertEnv(parseEnvFile(text), { PORT: '5200' }))
    expect(updated).toBe(text.replace('PORT=4111', 'PORT=5200'))
  })

  it('is a byte no-op when the value is unchanged', () => {
    const text = FIXTURE + '\n'
    const updated = serializeEnvFile(upsertEnv(parseEnvFile(text), { PORT: '4111' }))
    expect(updated).toBe(text)
  })

  it('appends missing keys, adding a newline to a bare last line first', () => {
    const updated = serializeEnvFile(upsertEnv(parseEnvFile('A=1'), { B: '2' }))
    expect(updated).toBe('A=1\nB=2\n')
  })

  it('edits the last occurrence of a duplicated key', () => {
    const lines = upsertEnv(parseEnvFile('DUP=first\nDUP=second\n'), { DUP: 'third' })
    expect(serializeEnvFile(lines)).toBe('DUP=first\nDUP=third\n')
    expect(getEnv(lines, 'DUP')).toBe('third')
  })

  it('preserves CRLF on edited lines', () => {
    const updated = serializeEnvFile(upsertEnv(parseEnvFile('A=1\r\nB=2\r\n'), { A: '9' }))
    expect(updated).toBe('A=9\r\nB=2\r\n')
  })

  it('quotes only when needed', () => {
    const rendered = serializeEnvFile(
      upsertEnv([], {
        KEY_B64: 'aGVsbG8rd29ybGQvZm9vPT0=',
        KEY_URL: 'postgresql://u:p@localhost:5433/db',
        KEY_SPACE: 'hello world',
        KEY_HASH: 'a#b',
        KEY_QUOTE: 'say "hi"',
        KEY_NEWLINE: 'a\nb',
        KEY_EMPTY: ''
      })
    )
    expect(rendered).toBe(
      [
        'KEY_B64=aGVsbG8rd29ybGQvZm9vPT0=',
        'KEY_URL=postgresql://u:p@localhost:5433/db',
        'KEY_SPACE="hello world"',
        'KEY_HASH="a#b"',
        'KEY_QUOTE="say \\"hi\\""',
        'KEY_NEWLINE="a\\nb"',
        'KEY_EMPTY=',
        ''
      ].join('\n')
    )
  })

  it('re-parses its own quoted output to the same values', () => {
    const values = {
      KEY_SPACE: 'hello world',
      KEY_QUOTE: 'say "hi"',
      KEY_NEWLINE: 'a\nb',
      KEY_BACKSLASH: 'C:\\path\\to'
    }
    const reparsed = listEnv(parseEnvFile(serializeEnvFile(upsertEnv([], values))))
    expect(reparsed).toEqual(values)
  })

  it('does not mutate its input', () => {
    const lines = parseEnvFile('A=1\n')
    upsertEnv(lines, { A: '2', B: '3' })
    expect(serializeEnvFile(lines)).toBe('A=1\n')
  })
})

describe('listEnv', () => {
  it('applies last-wins for duplicates', () => {
    expect(listEnv(parseEnvFile('DUP=first\nDUP=second\n'))).toEqual({ DUP: 'second' })
  })
})

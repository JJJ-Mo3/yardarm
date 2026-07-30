/**
 * parseEnvOutput turns `command env` output into a name→value map. Values can
 * contain `=` and even newlines (folded back as continuations), and anything
 * before the first NAME= line is ignored.
 */
import { describe, expect, it } from 'vitest'
import { parseEnvOutput } from './login-path'

describe('parseEnvOutput', () => {
  it('parses simple NAME=VALUE lines', () => {
    const env = parseEnvOutput('HOME=/Users/me\nSHELL=/bin/zsh\n')
    expect(env).toEqual({ HOME: '/Users/me', SHELL: '/bin/zsh' })
  })

  it('splits on the first = only, keeping = inside values', () => {
    const env = parseEnvOutput('DATABASE_URL=postgres://u:p@host/db?sslmode=require\n')
    expect(env.DATABASE_URL).toBe('postgres://u:p@host/db?sslmode=require')
  })

  it('folds multiline values back together', () => {
    const env = parseEnvOutput('BANNER=line one\nline two\nline three\nPATH=/usr/bin\n')
    expect(env.BANNER).toBe('line one\nline two\nline three')
    expect(env.PATH).toBe('/usr/bin')
  })

  it('ignores leading lines that are not env entries', () => {
    const env = parseEnvOutput('Last login: today\n42=not-a-name\nUSER=me\n')
    expect(env).toEqual({ USER: 'me' })
  })

  it('extracts PATH like the previous PATH-only scan did', () => {
    const stdout = 'TERM=xterm\nPATH=/opt/homebrew/bin:/usr/bin:/bin\nLANG=en_US.UTF-8\n'
    expect(parseEnvOutput(stdout).PATH).toBe('/opt/homebrew/bin:/usr/bin:/bin')
  })

  it('handles empty values and empty input', () => {
    expect(parseEnvOutput('EMPTY=\nX=1\n')).toEqual({ EMPTY: '', X: '1' })
    expect(parseEnvOutput('')).toEqual({})
  })
})

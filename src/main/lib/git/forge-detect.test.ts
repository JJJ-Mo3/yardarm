import { describe, expect, it } from 'vitest'
import { detectForgeFromRemoteUrl } from './forge-detect'

describe('detectForgeFromRemoteUrl', () => {
  it('detects github.com over https', () => {
    expect(detectForgeFromRemoteUrl('https://github.com/owner/repo.git')).toBe('github')
  })

  it('detects github.com scp-style', () => {
    expect(detectForgeFromRemoteUrl('git@github.com:owner/repo.git')).toBe('github')
  })

  it('detects github enterprise subdomains', () => {
    expect(detectForgeFromRemoteUrl('git@corp.github.com:owner/repo.git')).toBe('github')
  })

  it('detects gitlab.com over https', () => {
    expect(detectForgeFromRemoteUrl('https://gitlab.com/owner/repo.git')).toBe('gitlab')
  })

  it('detects gitlab.com scp-style with subgroups', () => {
    expect(detectForgeFromRemoteUrl('git@gitlab.com:group/subgroup/repo.git')).toBe('gitlab')
  })

  it('detects gitlab over ssh:// with user and port', () => {
    expect(detectForgeFromRemoteUrl('ssh://git@gitlab.com:2222/owner/repo.git')).toBe('gitlab')
  })

  it('detects self-hosted gitlab.* hosts', () => {
    expect(detectForgeFromRemoteUrl('git@gitlab.mycorp.com:owner/repo.git')).toBe('gitlab')
  })

  it('detects *.gitlab.* hosts', () => {
    expect(detectForgeFromRemoteUrl('https://code.gitlab.example.org/owner/repo')).toBe('gitlab')
  })

  it('works without a .git suffix', () => {
    expect(detectForgeFromRemoteUrl('https://github.com/owner/repo')).toBe('github')
  })

  it('returns null for unknown hosts', () => {
    expect(detectForgeFromRemoteUrl('git@bitbucket.org:owner/repo.git')).toBeNull()
    expect(detectForgeFromRemoteUrl('https://git.mycorp.com/owner/repo.git')).toBeNull()
  })

  it('does not treat lookalike hosts as forges', () => {
    expect(detectForgeFromRemoteUrl('https://notgithub.com/owner/repo.git')).toBeNull()
    expect(detectForgeFromRemoteUrl('https://mygitlab.com/owner/repo.git')).toBeNull()
  })

  it('returns null for garbage input', () => {
    expect(detectForgeFromRemoteUrl('')).toBeNull()
    expect(detectForgeFromRemoteUrl('not a url')).toBeNull()
    expect(detectForgeFromRemoteUrl('/local/path/to/repo')).toBeNull()
  })
})

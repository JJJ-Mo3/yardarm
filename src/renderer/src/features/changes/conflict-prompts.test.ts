import { describe, expect, it } from 'vitest'
import { buildMergeConflictPrompt, buildPullConflictPrompt } from './conflict-prompts'

describe('buildMergeConflictPrompt', () => {
  const prompt = buildMergeConflictPrompt({
    branch: 'yardarm/fix-login',
    baseBranch: 'main',
    files: ['src/a.ts', 'src/b.ts']
  })

  it('names both branches and the conflicted files', () => {
    expect(prompt).toContain('Merging `yardarm/fix-login` into `main` stopped on conflicts')
    expect(prompt).toContain('Conflicted files:\n- src/a.ts\n- src/b.ts\n')
  })

  it('asks for merge, resolution, checks and a commit in the worktree', () => {
    expect(prompt).toContain('2. Merge the base branch into this branch: `git merge main`.')
    expect(prompt).toContain('3. Resolve every conflict')
    expect(prompt).toContain("4. Run the project's checks")
    expect(prompt).toContain('5. Commit the merge.')
    expect(prompt).toContain('I will retry the merge into `main`')
    expect(prompt).toContain('do not push')
  })

  it('omits the file list when no paths are known and caps long lists', () => {
    expect(buildMergeConflictPrompt({ branch: 'b', baseBranch: 'main', files: [] })).not.toContain(
      'Conflicted files'
    )
    const many = Array.from({ length: 25 }, (_, i) => `f${i}.ts`)
    const capped = buildMergeConflictPrompt({ branch: 'b', baseBranch: 'main', files: many })
    expect(capped).toContain('- f19.ts\n- … and 5 more')
    expect(capped).not.toContain('f20.ts')
  })
})

describe('buildPullConflictPrompt', () => {
  it('asks to merge the upstream rather than the base branch', () => {
    const prompt = buildPullConflictPrompt({ branch: 'yardarm/x', files: ['README.md'] })
    expect(prompt).toContain('Pulling `yardarm/x` from its upstream stopped on conflicts')
    expect(prompt).toContain('- README.md')
    expect(prompt).toContain('`git merge @{upstream}`')
    expect(prompt).toContain('5. Commit the merge.')
    expect(prompt).toContain('I will pull and push again')
  })
})

import React, { useState } from 'react'
import Editor from '@monaco-editor/react'
import { ChevronDown, ChevronRight, FileText, Folder } from 'lucide-react'
import { useAtomValue } from 'jotai'
import '../../lib/monaco-setup'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { themeAtom } from '../../lib/atoms'

function languageFor(path: string): string | undefined {
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    html: 'html',
    md: 'markdown',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    rb: 'ruby',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    sql: 'sql'
  }
  return ext ? map[ext] : undefined
}

function DirNode({
  root,
  path,
  name,
  depth,
  selected,
  onSelect
}: {
  root: string
  path: string
  name: string
  depth: number
  selected: string | null
  onSelect: (path: string) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const children = trpc.files.tree.useQuery({ root, dir: path, depth: 0 }, { enabled: open })

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ paddingLeft: depth * 12 + 8 }}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] hover:bg-accent cursor-pointer"
      >
        {open ? (
          <ChevronDown size={11} className="shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-muted-foreground" />
        )}
        <Folder size={12} className="shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </button>
      {open &&
        (children.data ?? []).map((n) =>
          n.type === 'dir' ? (
            <DirNode
              key={n.path}
              root={root}
              path={n.path}
              name={n.name}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ) : (
            <FileNodeRow
              key={n.path}
              path={n.path}
              name={n.name}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          )
        )}
    </div>
  )
}

function FileNodeRow({
  path,
  name,
  depth,
  selected,
  onSelect
}: {
  path: string
  name: string
  depth: number
  selected: string | null
  onSelect: (path: string) => void
}): React.JSX.Element {
  return (
    <button
      onClick={() => onSelect(path)}
      style={{ paddingLeft: depth * 12 + 8 + 13 }}
      className={cn(
        'flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[12px] cursor-pointer',
        selected === path ? 'bg-accent' : 'hover:bg-accent'
      )}
    >
      <FileText size={12} className="shrink-0 text-muted-foreground" />
      <span className="truncate">{name}</span>
    </button>
  )
}

export function FilesView({ root }: { root: string }): React.JSX.Element {
  const [selected, setSelected] = useState<string | null>(null)
  const theme = useAtomValue(themeAtom)
  const tree = trpc.files.tree.useQuery({ root, dir: '', depth: 0 })
  const file = trpc.files.read.useQuery(
    { root, path: selected ?? '' },
    { enabled: selected !== null }
  )

  return (
    <div className="flex h-full">
      <div className="w-64 shrink-0 overflow-y-auto border-r border-border py-1">
        {(tree.data ?? []).map((n) =>
          n.type === 'dir' ? (
            <DirNode
              key={n.path}
              root={root}
              path={n.path}
              name={n.name}
              depth={0}
              selected={selected}
              onSelect={setSelected}
            />
          ) : (
            <FileNodeRow
              key={n.path}
              path={n.path}
              name={n.name}
              depth={0}
              selected={selected}
              onSelect={setSelected}
            />
          )
        )}
      </div>
      <div className="min-w-0 flex-1">
        {selected && file.data ? (
          file.data.binary ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Binary file
            </div>
          ) : file.data.tooLarge ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              File too large to preview
            </div>
          ) : (
            <Editor
              height="100%"
              path={selected}
              language={languageFor(selected)}
              value={file.data.content ?? ''}
              theme={theme === 'light' ? 'vs' : 'vs-dark'}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                scrollBeyondLastLine: false,
                renderWhitespace: 'none'
              }}
            />
          )
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Select a file
          </div>
        )}
      </div>
    </div>
  )
}

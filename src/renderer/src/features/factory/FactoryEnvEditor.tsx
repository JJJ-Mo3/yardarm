/**
 * Factory Environment section — guided editor for the checkout's .env.
 * Rows are the file's keys (file order) plus greyed .env.example suggestions;
 * writes go through the router's lossless queued-atomic helpers. Mode-aware:
 * platform shows a sign-in status row for the installer-written credentials,
 * local shows a sandbox-provider switch and database guidance.
 */
import React, { useMemo, useState } from 'react'
import { Eye, EyeOff, KeyRound, Plus, Save } from 'lucide-react'
import type { FactoryMode } from '@shared/ipc-types'
import { ENV_VAR_NAME_RE } from '@shared/provider-key-env'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'

const SECRET_RE = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i
const ENCRYPTION_KEY = 'FACTORY_CREDENTIAL_ENCRYPTION_KEY'
const SANDBOX_KEY = 'FACTORY_SANDBOX_PROVIDER'
const PLATFORM_CRED_KEYS = ['MASTRA_PLATFORM_ACCESS_TOKEN', 'MASTRA_PLATFORM_SECRET_KEY']

export function FactoryEnvEditor({
  dir,
  mode,
  active
}: {
  dir: string
  mode: FactoryMode
  active: boolean
}): React.JSX.Element {
  const utils = trpc.useUtils()
  const envRead = trpc.factory.envRead.useQuery({ dir, mode }, { enabled: active })
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const [newKey, setNewKey] = useState('')

  const invalidate = (): void => {
    utils.factory.envRead.invalidate()
    utils.factory.inspect.invalidate()
  }
  const envWrite = trpc.factory.envWrite.useMutation({
    onSuccess: () => {
      setEdits({})
      invalidate()
    }
  })
  const genKey = trpc.factory.envGenerateEncryptionKey.useMutation({ onSuccess: invalidate })
  const seedKeys = trpc.factory.envSeedProviderKeys.useMutation({ onSuccess: invalidate })

  // Last occurrence wins, matching dotenv semantics (and the router's listEnv).
  const fileValues = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of envRead.data?.entries ?? []) m.set(e.key, e.value)
    return m
  }, [envRead.data])

  const rows = useMemo(() => {
    const keys: string[] = []
    const seen = new Set<string>()
    const push = (k: string): void => {
      if (!seen.has(k)) {
        seen.add(k)
        keys.push(k)
      }
    }
    for (const e of envRead.data?.entries ?? []) push(e.key)
    for (const k of envRead.data?.exampleKeys ?? []) push(k)
    for (const k of Object.keys(edits)) push(k)
    return keys
  }, [envRead.data, edits])

  const val = (k: string): string => edits[k] ?? fileValues.get(k) ?? ''
  const setEdit = (k: string, v: string): void => setEdits((e) => ({ ...e, [k]: v }))
  const dirty = Object.keys(edits).filter((k) => edits[k] !== (fileValues.get(k) ?? ''))
  const missing = envRead.data?.missingRequired ?? []
  const signedIn = PLATFORM_CRED_KEYS.some((k) => val(k).trim() !== '')
  const newKeyValid = ENV_VAR_NAME_RE.test(newKey)

  const hints: Record<string, string> = {
    PORT: 'Dashboard/API port (Factory defaults to 4111) — avoid ports your Preview dev servers use',
    DATABASE_URL:
      mode === 'local'
        ? 'Postgres with pgvector — the bundled docker database (card below) works out of the box'
        : 'Postgres connection string — platform setups get a hosted database during scaffold sign-in'
  }

  const save = (): void => {
    envWrite.mutate({ dir, updates: Object.fromEntries(dirty.map((k) => [k, edits[k]])) })
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium">Environment (.env)</span>
        {envRead.data && !envRead.data.exists && (
          <span className="text-[11px] text-muted-foreground">
            no .env yet — it is created (seeded from .env.example) on first save
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          <Tip content="Copy the model-provider API keys Yardarm already uses (Settings → API Keys + login-shell auto-detect) into this .env — existing values are never overwritten">
            <span className="inline-flex">
              <Button
                size="sm"
                variant="outline"
                disabled={seedKeys.isPending}
                onClick={() => seedKeys.mutate({ dir })}
              >
                <KeyRound size={12} />
                Seed provider keys
              </Button>
            </span>
          </Tip>
          <Tip
            content={
              dirty.length > 0
                ? `Write ${dirty.length} changed ${dirty.length === 1 ? 'key' : 'keys'} to .env (other lines and comments are preserved byte-for-byte)`
                : 'No unsaved changes'
            }
          >
            <span className="inline-flex">
              <Button size="sm" disabled={dirty.length === 0 || envWrite.isPending} onClick={save}>
                <Save size={12} />
                Save{dirty.length > 0 ? ` (${dirty.length})` : ''}
              </Button>
            </span>
          </Tip>
        </div>
      </div>

      {missing.length > 0 && (
        <div className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-[11px] text-amber-500">
          Required before the server can start: {missing.join(', ')}
        </div>
      )}

      {seedKeys.data && (
        <div className="mt-3 rounded-md bg-accent px-3 py-2 text-[11px] text-muted-foreground">
          {seedKeys.data.seeded.length > 0
            ? `Seeded: ${seedKeys.data.seeded.join(', ')}`
            : 'No new keys to seed — every detected provider key is already set in .env.'}
        </div>
      )}

      {mode === 'platform' && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-border px-3 py-2 text-[11px]">
          <span
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              signedIn ? 'bg-emerald-500' : 'bg-amber-500'
            )}
          />
          {signedIn
            ? 'Signed in to the Mastra platform — the installer wrote your platform credentials to .env.'
            : 'Platform credentials missing — re-run the scaffold sign-in from Setup; they are written automatically (no need to hand-type them).'}
        </div>
      )}

      {mode === 'local' && (
        <div className="mt-3 flex items-center gap-2 rounded-md border border-border px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-medium">Local sandboxes</div>
            <div className="text-[11px] text-muted-foreground">
              Run agent sessions in local sandboxes ({SANDBOX_KEY}=local). Alternatively set
              E2B_API_KEY for cloud sandboxes.
            </div>
          </div>
          <Tip content="Toggle FACTORY_SANDBOX_PROVIDER=local (remember to Save)">
            <Switch
              checked={val(SANDBOX_KEY) === 'local'}
              onCheckedChange={(c) => setEdit(SANDBOX_KEY, c ? 'local' : '')}
            />
          </Tip>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-1.5">
        {rows.map((k) => {
          const secret = SECRET_RE.test(k)
          const present = fileValues.has(k) || k in edits
          const isMissing = missing.includes(k)
          return (
            <div key={k}>
              <div className="flex items-center gap-2">
                <span
                  title={k}
                  className={cn(
                    'w-72 shrink-0 truncate font-mono text-[11px]',
                    !present && 'text-muted-foreground',
                    isMissing && 'text-amber-500'
                  )}
                >
                  {k}
                </span>
                <Input
                  type={secret && !revealed[k] ? 'password' : 'text'}
                  value={val(k)}
                  onChange={(e) => setEdit(k, e.target.value)}
                  placeholder={present ? '' : 'not set'}
                  spellCheck={false}
                  className="h-6 min-w-0 flex-1 font-mono text-[11px]"
                />
                {secret && (
                  <Tip content={revealed[k] ? 'Hide this value' : 'Reveal this value'}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6"
                      onClick={() => setRevealed((r) => ({ ...r, [k]: !r[k] }))}
                    >
                      {revealed[k] ? <EyeOff size={12} /> : <Eye size={12} />}
                    </Button>
                  </Tip>
                )}
                {k === ENCRYPTION_KEY && !val(k).trim() && (
                  <Tip content="Generate a random 32-byte base64 encryption key and write it to .env">
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={genKey.isPending}
                        onClick={() => genKey.mutate({ dir })}
                      >
                        Generate
                      </Button>
                    </span>
                  </Tip>
                )}
              </div>
              {hints[k] && (
                <div className="ml-2 mt-0.5 text-[10px] text-muted-foreground">{hints[k]}</div>
              )}
            </div>
          )
        })}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Input
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="ADD_CUSTOM_KEY"
          spellCheck={false}
          className={cn(
            'h-6 w-72 font-mono text-[11px]',
            newKey && !newKeyValid && 'border-destructive'
          )}
        />
        <Tip
          content={
            newKeyValid
              ? 'Add this key as a new row (set its value, then Save)'
              : 'Enter a valid env var name (letters, digits, underscores; not starting with a digit)'
          }
        >
          <span className="inline-flex">
            <Button
              size="sm"
              variant="outline"
              disabled={!newKeyValid}
              onClick={() => {
                setEdit(newKey, edits[newKey] ?? fileValues.get(newKey) ?? '')
                setNewKey('')
              }}
            >
              <Plus size={12} />
              Add key
            </Button>
          </span>
        </Tip>
      </div>

      {(envWrite.error || genKey.error || seedKeys.error) && (
        <div className="mt-2 text-[11px] text-destructive">
          {envWrite.error?.message ?? genKey.error?.message ?? seedKeys.error?.message}
        </div>
      )}
    </div>
  )
}

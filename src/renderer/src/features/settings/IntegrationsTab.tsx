/**
 * Settings → Integrations: remote messaging via Slack (Socket Mode) and
 * Discord (Gateway). Per-platform cards with enable switch, write-only bot
 * tokens (the renderer only ever sees set/not-set booleans), an access mode
 * (user-id allowlist or allow-all), live connection status, and a collapsible
 * setup guide; plus the conversation-binding table shared by both platforms.
 */
import React, { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, RefreshCw, Trash2 } from 'lucide-react'
import type {
  IntegrationPlatform,
  IntegrationSecretKey,
  IntegrationStatusMap,
  IntegrationsConfig
} from '@shared/integrations'
import { trpc } from '../../lib/trpc'
import { cn } from '../../lib/utils'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select'
import { Switch } from '../../components/ui/switch'
import { Tip } from '../../components/ui/tooltip'

const STATE_DOT: Record<string, string> = {
  connected: 'bg-emerald-500',
  connecting: 'bg-amber-500',
  error: 'bg-red-500',
  disconnected: 'bg-muted-foreground/50'
}

const STATE_LABEL: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Connecting…',
  error: 'Error',
  disconnected: 'Disconnected'
}

interface SecretFieldProps {
  label: string
  placeholder: string
  secretKey: IntegrationSecretKey
  isSet: boolean
}

function SecretField({
  label,
  placeholder,
  secretKey,
  isSet
}: SecretFieldProps): React.JSX.Element {
  const utils = trpc.useUtils()
  const [value, setValue] = useState('')
  const setSecret = trpc.integrations.setSecret.useMutation({
    onSuccess: () => {
      setValue('')
      utils.integrations.getConfig.invalidate()
    }
  })
  const clearSecret = trpc.integrations.clearSecret.useMutation({
    onSuccess: () => utils.integrations.getConfig.invalidate()
  })

  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <Tip content={`${label} — stored encrypted on this machine, never shown again`}>
        <Input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isSet ? '••••••••  (set)' : placeholder}
          className="h-7 min-w-0 flex-1 text-[11px]"
        />
      </Tip>
      <Tip content="Save this token (restarts the connection)">
        <span className="inline-flex">
          <Button
            size="sm"
            variant="outline"
            disabled={!value.trim() || setSecret.isPending}
            onClick={() => setSecret.mutate({ key: secretKey, value: value.trim() })}
          >
            Save
          </Button>
        </span>
      </Tip>
      <Tip content="Remove the stored token">
        <span className="inline-flex">
          <Button
            size="sm"
            variant="ghost"
            disabled={!isSet || clearSecret.isPending}
            onClick={() => clearSecret.mutate({ key: secretKey })}
          >
            Clear
          </Button>
        </span>
      </Tip>
    </div>
  )
}

interface PlatformCardProps {
  platform: IntegrationPlatform
  title: string
  config: IntegrationsConfig
  status: IntegrationStatusMap
  secretFields: Array<Omit<SecretFieldProps, 'isSet'> & { isSet: boolean }>
  guide: React.ReactNode
}

function PlatformCard({
  platform,
  title,
  config,
  status,
  secretFields,
  guide
}: PlatformCardProps): React.JSX.Element {
  const utils = trpc.useUtils()
  const [allowlist, setAllowlist] = useState('')
  const [allowlistDirty, setAllowlistDirty] = useState(false)
  const [guideOpen, setGuideOpen] = useState(false)

  const cfg = config[platform]
  useEffect(() => {
    if (!allowlistDirty) setAllowlist(cfg.allowedUserIds.join('\n'))
  }, [cfg.allowedUserIds, allowlistDirty])

  const setConfig = trpc.integrations.setConfig.useMutation({
    onSuccess: () => utils.integrations.getConfig.invalidate()
  })
  const reconnect = trpc.integrations.reconnect.useMutation()

  const st = status[platform]

  const saveConfig = (patch: Partial<IntegrationsConfig[IntegrationPlatform]>): void => {
    setConfig.mutate({ ...config, [platform]: { ...cfg, ...patch } })
  }

  const saveAllowlist = (): void => {
    const ids = allowlist
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    saveConfig({ allowedUserIds: ids })
    setAllowlistDirty(false)
  }

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <span className={cn('size-2 shrink-0 rounded-full', STATE_DOT[st.state])} />
        <span className="text-xs font-medium">{title}</span>
        <span
          className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
          title={st.detail}
        >
          {STATE_LABEL[st.state]}
          {st.detail ? ` — ${st.detail}` : ''}
        </span>
        <Tip content="Drop and re-establish this connection">
          <span className="inline-flex">
            <Button
              size="sm"
              variant="outline"
              disabled={reconnect.isPending || !cfg.enabled}
              onClick={() => reconnect.mutate({ platform })}
            >
              <RefreshCw size={12} />
              Reconnect
            </Button>
          </span>
        </Tip>
        <Tip content={`Turn the ${title} bot connection on or off`}>
          <span className="inline-flex items-center gap-1.5">
            <span className="text-[11px] text-muted-foreground">Enabled</span>
            <Switch checked={cfg.enabled} onCheckedChange={(enabled) => saveConfig({ enabled })} />
          </span>
        </Tip>
      </div>

      {secretFields.map((f) => (
        <SecretField key={f.secretKey} {...f} />
      ))}

      <div className="flex items-center gap-2">
        <span className="w-24 shrink-0 text-[11px] text-muted-foreground">Access</span>
        <Select
          value={cfg.allowAllUsers ? 'all' : 'allowlist'}
          onValueChange={(v) => saveConfig({ allowAllUsers: v === 'all' })}
        >
          <Tip content="Who may talk to the bot: only allowlisted user ids, or every user who can message it">
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
          </Tip>
          <SelectContent>
            <SelectItem value="allowlist">Allowlisted users only</SelectItem>
            <SelectItem value="all">All users</SelectItem>
          </SelectContent>
        </Select>
        {cfg.allowAllUsers && (
          <span className="text-[11px] text-amber-600 dark:text-amber-500">
            Anyone who can message the bot can drive this machine.
          </span>
        )}
      </div>

      {!cfg.allowAllUsers && (
        <div className="flex items-start gap-2">
          <span className="w-24 shrink-0 pt-1 text-[11px] text-muted-foreground">
            Allowed users
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <Tip
              content={`${title} user ids allowed to talk to the bot — one per line. Empty = nobody.`}
            >
              <textarea
                value={allowlist}
                onChange={(e) => {
                  setAllowlist(e.target.value)
                  setAllowlistDirty(true)
                }}
                rows={3}
                spellCheck={false}
                placeholder="One user id per line"
                className="w-full rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px]"
              />
            </Tip>
            <div className="flex items-center gap-2">
              <Tip content="Save the allowlist (applies immediately)">
                <span className="inline-flex">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!allowlistDirty}
                    onClick={saveAllowlist}
                  >
                    Save allowlist
                  </Button>
                </span>
              </Tip>
              <span className="text-[11px] text-muted-foreground">
                Empty list = nobody can use the bot.
              </span>
            </div>
          </div>
        </div>
      )}

      <Tip content={guideOpen ? 'Hide the setup guide' : 'Show the step-by-step setup guide'}>
        <button
          onClick={() => setGuideOpen((o) => !o)}
          className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {guideOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          Setup guide
        </button>
      </Tip>
      {guideOpen && (
        <div className="space-y-1 rounded-md bg-accent/40 px-3 py-2 text-[11px] text-muted-foreground selectable">
          {guide}
        </div>
      )}

      {setConfig.error && (
        <div className="text-xs text-destructive selectable">{setConfig.error.message}</div>
      )}
    </div>
  )
}

export function IntegrationsTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const configQuery = trpc.integrations.getConfig.useQuery()
  const statusQuery = trpc.integrations.status.useQuery()
  const bindings = trpc.integrations.listBindings.useQuery()
  const [liveStatus, setLiveStatus] = useState<IntegrationStatusMap | null>(null)
  trpc.integrations.onStatus.useSubscription(undefined, {
    onData: (s) => setLiveStatus(s)
  })
  const deleteBinding = trpc.integrations.deleteBinding.useMutation({
    onSuccess: () => utils.integrations.listBindings.invalidate()
  })

  const config = configQuery.data?.config
  const secrets = configQuery.data?.secrets
  const status: IntegrationStatusMap = liveStatus ??
    statusQuery.data ?? {
      slack: { state: 'disconnected' },
      discord: { state: 'disconnected' }
    }

  if (!config || !secrets) {
    return <div className="text-xs text-muted-foreground">Loading…</div>
  }

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Work with Yardarm remotely from Slack or Discord: send prompts, get the final reply, answer
        agent questions, and approve tool calls. Message the bot <code>help</code> for commands;{' '}
        <code>use &lt;project&gt; &lt;chat&gt;</code> binds a conversation to a chat. Connections
        only run while the app is open.
      </div>

      <PlatformCard
        platform="slack"
        title="Slack"
        config={config}
        status={status}
        secretFields={[
          {
            label: 'App token',
            placeholder: 'xapp-…',
            secretKey: 'slackAppToken',
            isSet: secrets.slackAppToken
          },
          {
            label: 'Bot token',
            placeholder: 'xoxb-…',
            secretKey: 'slackBotToken',
            isSet: secrets.slackBotToken
          }
        ]}
        guide={
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Create an app at api.slack.com/apps and enable <b>Socket Mode</b> (Settings → Socket
              Mode) — this generates the app token (<code>xapp-…</code>, scope{' '}
              <code>connections:write</code>).
            </li>
            <li>
              Under <b>OAuth &amp; Permissions</b>, add bot scopes <code>chat:write</code>,{' '}
              <code>im:history</code>, <code>channels:history</code>, then install the app to your
              workspace to get the bot token (<code>xoxb-…</code>).
            </li>
            <li>
              Under <b>Event Subscriptions</b>, enable events and subscribe the bot to{' '}
              <code>message.im</code> and <code>message.channels</code>.
            </li>
            <li>
              Paste both tokens above, add your Slack member id (profile → ⋯ → Copy member ID) to
              the allowlist, and enable the switch. Then DM the bot <code>help</code>.
            </li>
          </ol>
        }
      />

      <PlatformCard
        platform="discord"
        title="Discord"
        config={config}
        status={status}
        secretFields={[
          {
            label: 'Bot token',
            placeholder: 'Bot token',
            secretKey: 'discordBotToken',
            isSet: secrets.discordBotToken
          }
        ]}
        guide={
          <ol className="list-decimal space-y-1 pl-4">
            <li>
              Create an application at discord.com/developers, add a <b>Bot</b>, and copy its token.
            </li>
            <li>
              Under Bot → Privileged Gateway Intents, enable the <b>Message Content Intent</b> —
              required to read messages.
            </li>
            <li>
              Invite the bot via OAuth2 → URL Generator (scope <code>bot</code>, permissions Send
              Messages + Read Message History), or just DM it.
            </li>
            <li>
              Paste the token above, add your Discord user id (enable Developer Mode, right-click
              your name → Copy User ID) to the allowlist, and enable the switch.
            </li>
          </ol>
        }
      />

      <div className="space-y-2">
        <div className="text-xs font-medium">Conversation bindings</div>
        <div className="text-[11px] text-muted-foreground">
          Each external conversation is bound to one project + chat (set with the <code>use</code>{' '}
          or <code>new</code> bot commands). Deleting a binding here just unlinks the conversation.
        </div>
        {(bindings.data ?? []).length === 0 ? (
          <div className="text-[11px] text-muted-foreground">No bindings yet.</div>
        ) : (
          <div className="space-y-1">
            {(bindings.data ?? []).map((b) => (
              <div
                key={b.id}
                className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[11px]"
              >
                <span className="shrink-0 rounded bg-accent px-1.5 py-0.5 capitalize">
                  {b.platform}
                </span>
                <span className="truncate text-muted-foreground" title={b.conversationId}>
                  {b.conversationId}
                </span>
                <span
                  className="min-w-0 flex-1 truncate"
                  title={`${b.projectName} / ${b.chatTitle}`}
                >
                  → {b.projectName} / {b.chatTitle}
                </span>
                <Tip content="Remove this binding (the conversation can re-bind with the use command)">
                  <span className="inline-flex">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={deleteBinding.isPending}
                      onClick={() => deleteBinding.mutate({ id: b.id })}
                    >
                      <Trash2 size={12} />
                    </Button>
                  </span>
                </Tip>
              </div>
            ))}
          </div>
        )}
      </div>

      {configQuery.error && (
        <div className="text-xs text-destructive selectable">{configQuery.error.message}</div>
      )}
    </div>
  )
}

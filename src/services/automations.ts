import type { Result } from '@/types/api'
import {
  AUTOMATION_KEYS,
  type Automation,
  type AutomationAction,
  type AutomationKey,
  type AutomationRun,
} from '@/types/automations'
import { err, ok } from '@/utils/result'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'

/**
 * Automations are a fixed list per business (supabase/migrations/…_notifications_automations.sql).
 * Managers switch them on or off, change their settings and run them now; the database checks the
 * settings and does the work. Row Level Security hides all of this from staff and clients.
 */
type Row = Record<string, unknown>

const str = (v: unknown) => (v === null || v === undefined ? null : String(v))
const isKey = (v: unknown): v is AutomationKey =>
  (AUTOMATION_KEYS as readonly string[]).includes(String(v))

function toAutomation(r: Row): Automation {
  const settings: Record<string, number> = {}
  for (const [k, v] of Object.entries((r.settings ?? {}) as Row)) settings[k] = num(v)
  return {
    id: String(r.id),
    key: r.key as AutomationKey,
    enabled: Boolean(r.enabled),
    settings,
    lastRunAt: str(r.last_run_at),
    lastStatus: (str(r.last_status) as Automation['lastStatus']) ?? null,
    lastMessage: str(r.last_message),
    updatedAt: String(r.updated_at),
  }
}

const COLUMNS = 'id, key, enabled, settings, last_run_at, last_status, last_message, updated_at'

export const listAutomations = (client?: DbClient) =>
  guarded<Automation[]>('Automations', client, async (c) => {
    const { data, error } = await c.from('automations').select(COLUMNS)
    if (error) return err(mapReadError(error, 'Automations'))
    const rows = ((data ?? []) as Row[]).filter((r) => isKey(r.key)).map(toAutomation)
    // Always in the catalogue's order, whatever order the database returns.
    return ok(rows.sort((a, b) => AUTOMATION_KEYS.indexOf(a.key) - AUTOMATION_KEYS.indexOf(b.key)))
  })

export interface AutomationDetail {
  automation: Automation
  runs: AutomationRun[]
  actions: AutomationAction[]
}

export const getAutomation = (key: string, client?: DbClient) =>
  guarded<AutomationDetail | null>(
    'Automation',
    client,
    async (c): Promise<Result<AutomationDetail | null>> => {
      if (!isKey(key)) return ok(null)
      const [a, runs, actions] = await Promise.all([
        c.from('automations').select(COLUMNS).eq('key', key).maybeSingle(),
        c
          .from('automation_runs')
          .select(
            'id, number, trigger, started_at, finished_at, status, checked, done, skipped, failed, error',
          )
          .eq('automation_key', key)
          .order('started_at', { ascending: false })
          .limit(20),
        c
          .from('automation_actions')
          .select('id, run_id, target_type, target_id, target_label, outcome, detail, created_at')
          .eq('automation_key', key)
          .order('created_at', { ascending: false })
          .limit(50),
      ])
      const failed = [a, runs, actions].find((r) => r.error)
      if (failed?.error) return err(mapReadError(failed.error, 'Automation'))
      if (!a.data) return ok(null)
      return ok({
        automation: toAutomation(a.data as Row),
        runs: ((runs.data ?? []) as Row[]).map((r) => ({
          id: String(r.id),
          number: num(r.number),
          trigger: r.trigger === 'manual' ? 'manual' : 'schedule',
          startedAt: String(r.started_at),
          finishedAt: str(r.finished_at),
          status: (str(r.status) as AutomationRun['status']) ?? null,
          checked: num(r.checked),
          done: num(r.done),
          skipped: num(r.skipped),
          failed: num(r.failed),
          error: str(r.error),
        })),
        actions: ((actions.data ?? []) as Row[]).map((r) => ({
          id: String(r.id),
          runId: str(r.run_id),
          targetType: r.target_type as AutomationAction['targetType'],
          targetId: str(r.target_id),
          targetLabel: str(r.target_label),
          outcome: r.outcome as AutomationAction['outcome'],
          detail: str(r.detail),
          createdAt: String(r.created_at),
        })),
      })
    },
  )

export const setAutomationEnabled = (key: AutomationKey, enabled: boolean, client?: DbClient) =>
  guarded<null>(
    'automation',
    client,
    async (c) => {
      const { error } = await c.from('automations').update({ enabled }).eq('key', key)
      if (error) return err(mapWriteError(error, 'automation'))
      return ok(null)
    },
    mapWriteError,
  )

export const saveAutomationSettings = (
  key: AutomationKey,
  settings: Record<string, number>,
  client?: DbClient,
) =>
  guarded<null>(
    'automation',
    client,
    async (c) => {
      const { error } = await c.from('automations').update({ settings }).eq('key', key)
      if (error) return err(mapWriteError(error, 'automation'))
      return ok(null)
    },
    mapWriteError,
  )

export interface RunSummary {
  key: string
  status: string
  done: number
  skipped: number
  failed: number
}

/** Runs the business's switched-on daily automations now. */
export const runAutomationsNow = (client?: DbClient) =>
  guarded<RunSummary[]>(
    'automations',
    client,
    async (c) => {
      const { data, error } = await c.rpc('run_my_automations')
      if (error) return err(mapWriteError(error, 'automations'))
      const runs = (((data ?? {}) as Row).runs ?? []) as Row[]
      return ok(
        runs
          .filter((r) => r.key)
          .map((r) => ({
            key: String(r.key),
            status: String(r.status),
            done: num(r.done),
            skipped: num(r.skipped),
            failed: num(r.failed),
          })),
      )
    },
    mapWriteError,
  )

/** Readable text for a skip or failure reason stored by the database. */
export function reasonText(detail: string | null): string {
  if (!detail) return ''
  const known: Record<string, string> = {
    message_no_email: 'The customer has no email address.',
    message_opted_out: 'The customer does not want email.',
    message_recipient_suppressed: 'Email to this customer bounced or was marked as spam.',
    message_no_consent: 'No marketing consent.',
    message_template_off: 'The email template is switched off.',
    message_customer_not_found: 'The customer no longer exists.',
  }
  return known[detail] ?? detail
}

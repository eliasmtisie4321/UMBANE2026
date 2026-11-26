import { afterEach, describe, expect, it, vi } from 'vitest'
import { fake } from '@/test/fakeSupabase'
import { AUTOMATIONS, automationInfo } from '@/types/automations'
import { settingsProblems } from '@/utils/automationForm'
import {
  getAutomation,
  listAutomations,
  reasonText,
  runAutomationsNow,
  saveAutomationSettings,
  setAutomationEnabled,
} from './automations'
import { flushNotificationEmails, getPreferences, savePreferences } from './notifications'

vi.mock('./supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) },
  }),
}))

const row = (key: string, over: Record<string, unknown> = {}) => ({
  id: `a-${key}`,
  key,
  enabled: true,
  settings: {},
  last_run_at: null,
  last_status: null,
  last_message: null,
  updated_at: 'x',
  ...over,
})

describe('automations service', () => {
  it('lists the automations in catalogue order and ignores unknown kinds', async () => {
    const { client } = fake({
      automations: {
        data: [
          row('low_stock'),
          row('legacy_thing'),
          row('overdue_invoices', { settings: { days_overdue: '2' } }),
        ],
      },
    })
    const r = await listAutomations(client)
    expect(r.ok && r.data.map((a) => a.key)).toEqual(['overdue_invoices', 'low_stock'])
    expect(r.ok && r.data[0].settings).toEqual({ days_overdue: 2 })
  })

  it('loads one automation with its runs and actions', async () => {
    const { client, log } = fake({
      automations: { data: row('task_reminders', { last_status: 'failed' }) },
      automation_runs: {
        data: [
          {
            id: 'r1',
            number: '7',
            trigger: 'manual',
            started_at: 's',
            finished_at: null,
            status: 'failed',
            checked: 1,
            done: 0,
            skipped: 0,
            failed: 1,
            error: 'boom',
          },
        ],
      },
      automation_actions: {
        data: [
          {
            id: 'x1',
            run_id: 'r1',
            target_type: 'task',
            target_id: 't1',
            target_label: 'TSK-00001 · Audit',
            outcome: 'failed',
            detail: 'boom',
            created_at: 'c',
          },
        ],
      },
    })
    const r = await getAutomation('task_reminders', client)
    expect(r.ok && r.data?.runs[0]).toMatchObject({
      number: 7,
      trigger: 'manual',
      failed: 1,
      error: 'boom',
    })
    expect(r.ok && r.data?.actions[0]).toMatchObject({
      targetType: 'task',
      targetLabel: 'TSK-00001 · Audit',
    })
    expect(log.find((l) => l.table === 'automation_runs')?.ops).toContain('limit(20)')
    expect(await getAutomation('not_real', fake({}).client)).toEqual({ ok: true, data: null })
  })

  it('switches and saves settings for one automation', async () => {
    const a = fake({ automations: {} })
    await setAutomationEnabled('payment_reminder', true, a.client)
    expect(a.log[0].ops).toEqual(['update({"enabled":true})', 'eq("key","payment_reminder")'])
    const b = fake({ automations: {} })
    await saveAutomationSettings('payment_reminder', { days_before: 5, min_balance: 0 }, b.client)
    expect(b.log[0].ops[0]).toBe('update({"settings":{"days_before":5,"min_balance":0}})')
  })

  it('explains refused settings in words', async () => {
    const { client } = fake({
      automations: { error: { code: '23514', message: 'automation_settings_invalid' } },
    })
    const r = await saveAutomationSettings('overdue_invoices', { days_overdue: 999 }, client)
    expect(r).toMatchObject({
      ok: false,
      error: {
        code: 'validation',
        message: expect.stringContaining('outside what this automation allows'),
      },
    })
  })

  it('runs now and summarises each automation', async () => {
    const { client } = fake({
      'rpc:run_my_automations': {
        data: {
          runs: [
            { business_id: 'b1', status: 'busy' },
            { key: 'overdue_invoices', status: 'success', done: 2, skipped: 1, failed: 0 },
          ],
        },
      },
    })
    expect(await runAutomationsNow(client)).toEqual({
      ok: true,
      data: [{ key: 'overdue_invoices', status: 'success', done: 2, skipped: 1, failed: 0 }],
    })
  })

  it('reads stored reasons as sentences', () => {
    expect(reasonText('message_opted_out')).toBe('The customer does not want email.')
    expect(reasonText('Notified 2 people')).toBe('Notified 2 people')
    expect(reasonText(null)).toBe('')
  })
})

describe('automation settings form', () => {
  const info = automationInfo('payment_reminder')!
  it('accepts whole numbers within the limits only', () => {
    expect(settingsProblems(info, { days_before: '3', min_balance: '0' })).toEqual({})
    expect(Object.keys(settingsProblems(info, { days_before: '0', min_balance: '-1' }))).toEqual([
      'days_before',
      'min_balance',
    ])
    expect(settingsProblems(info, { days_before: '2.5', min_balance: '' })).toMatchObject({
      days_before: 'Enter a whole number from 1 to 30.',
      min_balance: 'Enter a whole number from 0 to 10,000,000.',
    })
  })

  it('describes every automation in words, whatever its settings', () => {
    for (const a of AUTOMATIONS) {
      const s = Object.fromEntries(a.fields.map((f) => [f.name, f.min]))
      expect(a.trigger(s)).not.toMatch(/undefined|NaN/)
    }
    expect(automationInfo('task_reminders')!.trigger({ days_before: 0 })).toBe(
      'A task is due today, or becomes overdue',
    )
  })
})

describe('notification preferences', () => {
  it('fills in categories never chosen as in-app only', async () => {
    const { client } = fake({
      notification_preferences: { data: [{ category: 'invoices', in_app: false, email: true }] },
    })
    const r = await getPreferences(client)
    expect(r.ok && r.data.find((p) => p.category === 'invoices')).toEqual({
      category: 'invoices',
      inApp: false,
      email: true,
    })
    expect(r.ok && r.data.find((p) => p.category === 'tasks')).toEqual({
      category: 'tasks',
      inApp: true,
      email: false,
    })
  })

  it('saves all choices for the person in one go', async () => {
    const { client, log } = fake({ notification_preferences: {} })
    await savePreferences('u1', [{ category: 'tasks', inApp: true, email: true }], client)
    expect(log[0].ops[0]).toBe(
      'upsert([{"user_id":"u1","category":"tasks","in_app":true,"email":true}],{"onConflict":"user_id,category"})',
    )
  })
})

describe('flushing email', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does nothing outside production, and at most once a minute', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchMock)
    await flushNotificationEmails(1_000_000)
    expect(fetchMock).not.toHaveBeenCalled()
    await flushNotificationEmails(2_000_000, true)
    expect(fetchMock).toHaveBeenCalledWith('/api/notifications/flush', {
      method: 'POST',
      headers: { Authorization: 'Bearer tok' },
    })
    await flushNotificationEmails(2_030_000, true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await flushNotificationEmails(2_061_000, true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

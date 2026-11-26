import {
  NOTIFICATION_CATEGORIES,
  type NotificationCategory,
  type NotificationPreference,
} from '@/types/automations'
import { err, ok } from '@/utils/result'
import { getSupabase } from './supabase'
import { guarded, mapReadError, mapWriteError, type DbClient } from './db'

type Row = Record<string, unknown>

export interface AppNotification {
  id: string
  title: string
  body: string | null
  /** A page inside the app, always starting with "/". */
  link: string | null
  isRead: boolean
  createdAt: string
  category: NotificationCategory
}

const CATEGORY_VALUES: readonly string[] = NOTIFICATION_CATEGORIES.map((c) => c.value)
const asCategory = (v: unknown): NotificationCategory =>
  (CATEGORY_VALUES.includes(String(v)) ? v : 'general') as NotificationCategory

/** Only links inside the app are followed, whatever is stored. */
const safeLink = (v: unknown) => (typeof v === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(v) ? v : null)

// Notifications are personal: row security returns only the signed-in person's own.
export interface NotificationFilter {
  unreadOnly: boolean
  /** Empty for every category. */
  category?: string
}

export const listNotifications = (
  { unreadOnly, category }: NotificationFilter,
  client?: DbClient,
) =>
  guarded<AppNotification[]>('Notifications', client, async (c) => {
    let q = c.from('notifications').select('id, title, body, link, is_read, created_at, category')
    if (unreadOnly) q = q.eq('is_read', false)
    if (category && CATEGORY_VALUES.includes(category)) q = q.eq('category', category)
    const { data, error } = await q.order('created_at', { ascending: false }).limit(100)
    if (error) return err(mapReadError(error, 'Notifications'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        title: String(r.title),
        body: r.body === null || r.body === undefined ? null : String(r.body),
        link: safeLink(r.link),
        isRead: Boolean(r.is_read),
        createdAt: String(r.created_at),
        category: asCategory(r.category),
      })),
    )
  })

export const getUnreadCount = (client?: DbClient) =>
  guarded<number>('Notifications', client, async (c) => {
    const { count, error } = await c
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false)
    if (error) return err(mapReadError(error, 'Notifications'))
    return ok(count ?? 0)
  })

export const markRead = (ids: string[] | 'all', client?: DbClient) =>
  guarded<null>(
    'notification',
    client,
    async (c) => {
      let q = c.from('notifications').update({ is_read: true }).eq('is_read', false)
      if (ids !== 'all') q = q.in('id', ids)
      const { error } = await q
      if (error) return err(mapWriteError(error, 'notification'))
      return ok(null)
    },
    mapWriteError,
  )

// Preferences --------------------------------------------------------------------------------------
/** The signed-in person's choices for every category; categories never chosen are in-app only. */
export const getPreferences = (client?: DbClient) =>
  guarded<NotificationPreference[]>('Notification settings', client, async (c) => {
    const { data, error } = await c
      .from('notification_preferences')
      .select('category, in_app, email')
    if (error) return err(mapReadError(error, 'Notification settings'))
    const saved = new Map(((data ?? []) as Row[]).map((r) => [String(r.category), r]))
    return ok(
      NOTIFICATION_CATEGORIES.map(({ value }) => {
        const r = saved.get(value)
        return {
          category: value,
          inApp: r ? Boolean(r.in_app) : true,
          email: r ? Boolean(r.email) : false,
        }
      }),
    )
  })

export const savePreferences = (
  userId: string,
  prefs: NotificationPreference[],
  client?: DbClient,
) =>
  guarded<null>(
    'notification settings',
    client,
    async (c) => {
      const { error } = await c.from('notification_preferences').upsert(
        prefs.map((p) => ({
          user_id: userId,
          category: p.category,
          in_app: p.inApp,
          email: p.email,
        })),
        { onConflict: 'user_id,category' },
      )
      if (error) return err(mapWriteError(error, 'notification settings'))
      return ok(null)
    },
    mapWriteError,
  )

// Sending queued email --------------------------------------------------------------------------
let lastFlush = 0
const FLUSH_EVERY_MS = 60_000

/**
 * Asks the server to send emails waiting in the queue (at most once a minute per tab), so they go
 * out within minutes while anyone is signed in. Nothing happens in development or tests, where
 * there is no server; a failure is ignored, as the daily run sends them anyway.
 */
export async function flushNotificationEmails(now = Date.now(), force = false): Promise<void> {
  if (!import.meta.env.PROD && !force) return
  if (now - lastFlush < FLUSH_EVERY_MS) return
  lastFlush = now
  try {
    const token = (await getSupabase().auth.getSession()).data.session?.access_token
    if (!token) return
    await fetch('/api/notifications/flush', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
  } catch {
    // The daily run sends anything left.
  }
}

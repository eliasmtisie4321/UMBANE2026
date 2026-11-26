import { err, ok } from '@/utils/result'
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
}

/** Only links inside the app are followed, whatever is stored. */
const safeLink = (v: unknown) => (typeof v === 'string' && /^\/[A-Za-z0-9/_-]*$/.test(v) ? v : null)

// Notifications are personal: row security returns only the signed-in person's own.
export const listNotifications = (unreadOnly: boolean, client?: DbClient) =>
  guarded<AppNotification[]>('Notifications', client, async (c) => {
    let q = c.from('notifications').select('id, title, body, link, is_read, created_at')
    if (unreadOnly) q = q.eq('is_read', false)
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

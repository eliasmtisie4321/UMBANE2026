import type { Channel } from '@shared/integrations'
import { guarded, mapReadError, type DbClient } from './db'
import type { MessageStatus } from '@/types/messages'
import { err, ok } from '@/utils/result'

export interface SocialPost {
  id: string
  channel: Channel
  status: MessageStatus
  body: string
  sender: string | null
  externalUrl: string | null
  error: string | null
  createdAt: string
}

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' && v ? v : null)

/** The business's public posts, newest first, from the communication history. */
export const listSocialPosts = (client?: DbClient) =>
  guarded<SocialPost[]>('Posts', client, async (c) => {
    const { data, error } = await c
      .from('message_list')
      .select('id, channel, status, body, sender, external_url, error, created_at')
      .eq('message_type', 'social_post')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) return err(mapReadError(error, 'Posts'))
    return ok(
      ((data ?? []) as Row[]).map((r) => ({
        id: String(r.id),
        channel: r.channel as Channel,
        status: r.status as MessageStatus,
        body: String(r.body ?? ''),
        sender: str(r.sender),
        externalUrl: str(r.external_url),
        error: str(r.error),
        createdAt: String(r.created_at),
      })),
    )
  })

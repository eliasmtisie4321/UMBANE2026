import type { DbClient } from '@/services/db'

export interface Reply {
  data?: unknown
  count?: number | null
  error?: unknown
}

type ReplyFor = Reply | ((ops: string[]) => Reply)

/**
 * Fake Supabase client for service tests. Every query-builder call (select, eq, insert, ...) is
 * recorded as a string and returns the builder; awaiting the builder yields the reply configured
 * for that table. A reply can be a function of the recorded calls, so one table can answer
 * different queries differently.
 */
export function fake(replies: Record<string, ReplyFor>) {
  const log: Array<{ table: string; ops: string[] }> = []
  const client = {
    /** Recorded as table "rpc:<name>" with the arguments as its first op. */
    rpc(name: string, args?: unknown) {
      const builder = client.from(`rpc:${name}`)
      log.at(-1)!.ops.push(JSON.stringify(args))
      return builder
    },
    from(table: string): unknown {
      const entry = { table, ops: [] as string[] }
      log.push(entry)
      const builder: unknown = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === 'then') {
              const r = replies[table]
              const reply = typeof r === 'function' ? r(entry.ops) : (r ?? {})
              const value = {
                data: reply.data ?? null,
                count: reply.count ?? null,
                error: reply.error ?? null,
              }
              return (resolve: (v: unknown) => unknown) => Promise.resolve(value).then(resolve)
            }
            return (...args: unknown[]) => {
              entry.ops.push(`${String(prop)}(${args.map((a) => JSON.stringify(a)).join(',')})`)
              return builder
            }
          },
        },
      )
      return builder
    },
  }
  return { client: client as unknown as DbClient, log }
}

import { randomUUID } from 'node:crypto'

/**
 * An in-memory stand-in for the parts of the Supabase service-role client the server code uses:
 * table queries (select, insert, update, upsert, delete with eq/neq/in/lt filters, order, limit,
 * single), rpc, storage and auth. Tests only; it does not enforce constraints.
 */
type Row = Record<string, unknown>
type Result = { data: unknown; error: { message: string } | null }

export interface FakeOptions {
  rpc?: Record<string, (args: Record<string, unknown>) => Result | Promise<Result>>
  storage?: {
    download?: (bucket: string, path: string) => Result
    createSignedUrl?: (bucket: string, path: string) => Result
  }
  auth?: {
    users?: Record<string, { id: string }>
    generateLink?: (args: Record<string, unknown>) => Result
    getUserById?: (id: string) => Result
    deleteUser?: (id: string) => Result
  }
}

export function fakeDb(seed: Record<string, Row[]> = {}, options: FakeOptions = {}) {
  const tables = new Map<string, Row[]>(
    Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
  )
  const rows = (t: string) => {
    if (!tables.has(t)) tables.set(t, [])
    return tables.get(t)!
  }
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = []
  const deletedUsers: string[] = []

  function from(table: string) {
    let op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
    let payload: Row | Row[] | null = null
    let conflict = 'id'
    let returning = false
    let mode: 'many' | 'single' | 'maybe' = 'many'
    const filters: ((r: Row) => boolean)[] = []
    const orders: { col: string; asc: boolean }[] = []
    let max: number | null = null

    const run = (): Result => {
      const all = rows(table)
      const match = (r: Row) => filters.every((f) => f(r))
      let out: Row[] = []
      if (op === 'select') {
        out = all.filter(match)
        for (const o of [...orders].reverse()) {
          out.sort((a, b) => {
            const x = a[o.col] as never
            const y = b[o.col] as never
            return (x === y ? 0 : x > y ? 1 : -1) * (o.asc ? 1 : -1)
          })
        }
        if (max !== null) out = out.slice(0, max)
      } else if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload!]
        out = list.map((r) => ({ id: randomUUID(), created_at: new Date().toISOString(), ...r }))
        all.push(...out)
      } else if (op === 'upsert') {
        const list = Array.isArray(payload) ? payload : [payload!]
        for (const r of list) {
          const i = all.findIndex((x) => x[conflict] === r[conflict])
          if (i >= 0) all[i] = { ...all[i], ...r }
          else all.push({ ...r })
          out.push(i >= 0 ? all[i] : r)
        }
      } else if (op === 'update') {
        for (const r of all.filter(match)) {
          Object.assign(r, payload)
          out.push(r)
        }
      } else if (op === 'delete') {
        out = all.filter(match)
        tables.set(
          table,
          all.filter((r) => !match(r)),
        )
      }
      const data = op === 'select' || returning ? out.map((r) => ({ ...r })) : null
      if (mode === 'single') {
        return data && data.length === 1
          ? { data: data[0], error: null }
          : { data: null, error: { message: 'not one row' } }
      }
      if (mode === 'maybe') return { data: data?.[0] ?? null, error: null }
      return { data, error: null }
    }

    const q = {
      select() {
        if (op !== 'select') returning = true
        return q
      },
      insert(p: Row | Row[]) {
        op = 'insert'
        payload = p
        return q
      },
      upsert(p: Row | Row[], opts?: { onConflict?: string }) {
        op = 'upsert'
        payload = p
        conflict = opts?.onConflict ?? 'id'
        return q
      },
      update(p: Row) {
        op = 'update'
        payload = p
        return q
      },
      delete() {
        op = 'delete'
        return q
      },
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v)
        return q
      },
      neq(col: string, v: unknown) {
        filters.push((r) => r[col] !== v)
        return q
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]))
        return q
      },
      lt(col: string, v: unknown) {
        filters.push((r) => (r[col] as string) < (v as string))
        return q
      },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, asc: opts?.ascending !== false })
        return q
      },
      limit(n: number) {
        max = n
        return q
      },
      single() {
        mode = 'single'
        return q
      },
      maybeSingle() {
        mode = 'maybe'
        return q
      },
      then<T>(resolve: (r: Result) => T, reject?: (e: unknown) => T) {
        try {
          return Promise.resolve(resolve(run()))
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e)
        }
      },
    }
    return q
  }

  const db = {
    from,
    async rpc(fn: string, args: Record<string, unknown> = {}) {
      rpcCalls.push({ fn, args })
      const h = options.rpc?.[fn]
      return h ? await h(args) : { data: null, error: null }
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) =>
          options.storage?.download?.(bucket, path) ?? {
            data: null,
            error: { message: 'missing' },
          },
        createSignedUrl: async (path: string) =>
          options.storage?.createSignedUrl?.(bucket, path) ?? {
            data: null,
            error: { message: 'missing' },
          },
      }),
    },
    auth: {
      async getUser(token: string) {
        const user = options.auth?.users?.[token]
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: 'bad token' } }
      },
      admin: {
        generateLink: async (args: Record<string, unknown>) =>
          options.auth?.generateLink?.(args) ?? { data: null, error: { message: 'not set up' } },
        getUserById: async (id: string) =>
          options.auth?.getUserById?.(id) ?? { data: { user: null }, error: null },
        deleteUser: async (id: string) => {
          deletedUsers.push(id)
          return options.auth?.deleteUser?.(id) ?? { data: null, error: null }
        },
      },
    },
  }
  return { db, tables, rows, rpcCalls, deletedUsers }
}

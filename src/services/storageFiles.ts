import type { SupabaseClient } from '@supabase/supabase-js'
import type { Result } from '@/types/api'
import { fileTypeOf, safeFileName, type FileRules } from '@/utils/files'
import { err, ok } from '@/utils/result'
import { guarded, mapReadError, mapWriteError, num, type DbClient } from './db'
import { getSupabase } from './supabase'

/** The slice of Supabase Storage used for attachments; tests pass a fake. */
export type StorageApi = Pick<SupabaseClient['storage'], 'from'>
const resolveStorage = (s?: StorageApi): StorageApi => s ?? getSupabase().storage

type Row = Record<string, unknown>

/** A file recorded against a ticket or task. */
export interface StoredFile {
  id: string
  fileName: string
  contentType: string
  sizeBytes: number
  storagePath: string
  uploaderName: string | null
  createdAt: string
}

/** Where a kind of attachment lives: its bucket, its table and the column naming its parent. */
export interface FileStore {
  bucket: string
  table: string
  parentColumn: string
  rules: FileRules
}

export const fromFileRow = (r: Row): StoredFile => ({
  id: String(r.id),
  fileName: String(r.file_name),
  contentType: String(r.content_type),
  sizeBytes: num(r.size_bytes),
  storagePath: String(r.storage_path),
  uploaderName:
    r.uploader_name === null || r.uploader_name === undefined ? null : String(r.uploader_name),
  createdAt: String(r.created_at),
})

export const listFiles = (store: FileStore, parentId: string, client?: DbClient) =>
  guarded<StoredFile[]>('Attachments', client, async (c) => {
    const { data, error } = await c
      .from(store.table)
      .select('id, file_name, content_type, size_bytes, storage_path, uploader_name, created_at')
      .eq(store.parentColumn, parentId)
      .order('created_at')
      .order('id')
    if (error) return err(mapReadError(error, 'Attachments'))
    return ok(((data ?? []) as Row[]).map(fromFileRow))
  })

const randomId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

/**
 * Uploads the file to private storage under <business>/<parent>/<file>, then records it. The
 * database checks the file really arrived and keeps its stored size and type.
 */
export async function uploadFile(
  store: FileStore,
  parent: { id: string; businessId: string },
  file: File,
  deps: { client?: DbClient; storage?: StorageApi } = {},
): Promise<Result<{ id: string }>> {
  const contentType = fileTypeOf(file.name, store.rules)
  if (!contentType) {
    return err({
      code: 'validation',
      message: `${file.name}: this type of file cannot be attached.`,
    })
  }
  const path = `${parent.businessId}/${parent.id}/${randomId()}-${safeFileName(file.name)}`
  try {
    const up = await resolveStorage(deps.storage)
      .from(store.bucket)
      .upload(path, file, { contentType, upsert: false })
    if (up.error) {
      return err({
        code: /fetch|network/i.test(up.error.message) ? 'network' : 'validation',
        message: `${file.name} could not be uploaded. Check its type and that it is under 10 MB, then try again.`,
      })
    }
  } catch {
    return err({
      code: 'network',
      message: `${file.name} could not be uploaded. Please try again.`,
    })
  }
  return guarded<{ id: string }>(
    'attachment',
    deps.client,
    async (c) => {
      const { data, error } = await c
        .from(store.table)
        .insert({
          [store.parentColumn]: parent.id,
          storage_path: path,
          file_name: file.name.slice(0, 200),
          content_type: contentType,
          size_bytes: file.size,
        })
        .select('id')
        .single()
      if (error) return err(mapWriteError(error, 'attachment'))
      return ok({ id: String((data as Row).id) })
    },
    mapWriteError,
  )
}

/** Private links to the files, valid for an hour, keyed by storage path. */
export async function signedUrls(
  bucket: string,
  paths: string[],
  storage?: StorageApi,
): Promise<Result<Record<string, string>>> {
  if (paths.length === 0) return ok({})
  try {
    const { data, error } = await resolveStorage(storage).from(bucket).createSignedUrls(paths, 3600)
    if (error || !data) return err({ code: 'unknown', message: 'The files could not be opened.' })
    const urls: Record<string, string> = {}
    for (const d of data) if (d.path && d.signedUrl && !d.error) urls[d.path] = d.signedUrl
    return ok(urls)
  } catch {
    return err({ code: 'network', message: 'The files could not be opened.' })
  }
}

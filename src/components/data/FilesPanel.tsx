import { FileText, Paperclip, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { Button } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import type { StoredFile } from '@/services/storageFiles'
import type { Result } from '@/types/api'
import { checkFiles, formatBytes, isImage, type FileRules } from '@/utils/files'
import { formatDateTime, formatNumber } from '@/utils/format'

/** Where a panel's files come from and go to. */
export interface FileSource {
  /** Changes when the parent record changes, so the list reloads. */
  key: string
  list: () => Promise<Result<StoredFile[]>>
  urls: (paths: string[]) => Promise<Result<Record<string, string>>>
  upload: (file: File) => Promise<Result<unknown>>
  rules: FileRules
}

interface FilesPanelProps {
  title?: string
  source: FileSource
  canUpload: boolean
  version: number
  onUploaded: (notice: string) => void
}

/** Photos shown as thumbnails and documents as links, through private links that expire. */
export function FilesPanel({
  title = 'Photos and documents',
  source,
  canUpload,
  version,
  onUploaded,
}: FilesPanelProps) {
  const files = useResource(async () => {
    const list = await source.list()
    if (!list.ok) return list
    const urls = await source.urls(list.data.map((f) => f.storagePath))
    return { ok: true as const, data: { list: list.data, urls: urls.ok ? urls.data : {} } }
  }, `files-${source.key}-${version}`)
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const max = source.rules.maxFiles

  async function onPick(picked: File[]) {
    const { accepted, problems: refused } = checkFiles(
      picked,
      files.data?.list.length ?? 0,
      source.rules,
    )
    const failed = [...refused]
    setBusy(true)
    let added = 0
    for (const f of accepted) {
      const r = await source.upload(f)
      if (r.ok) added += 1
      else failed.push(r.error.message)
    }
    setBusy(false)
    setProblems(failed)
    if (input.current) input.current.value = ''
    if (added > 0) onUploaded(`${formatNumber(added)} ${added === 1 ? 'file' : 'files'} attached.`)
  }

  const count = files.data?.list.length ?? 0
  return (
    <Panel
      title={title}
      subtitle={`${formatNumber(count)} of ${max} files`}
      action={
        canUpload && count < max ? (
          <>
            <input
              ref={input}
              type="file"
              multiple
              accept={source.rules.accept}
              className="sr-only"
              aria-label="Attach files"
              onChange={(e) => void onPick(Array.from(e.target.files ?? []))}
            />
            <Button variant="secondary" loading={busy} onClick={() => input.current?.click()}>
              <Upload size={16} aria-hidden="true" /> Attach Files
            </Button>
          </>
        ) : undefined
      }
    >
      {problems.length > 0 && (
        <div className="mb-3">
          <FormError>
            <ul>
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </FormError>
        </div>
      )}
      <ResourceBoundary
        state={files}
        isEmpty={(d) => d.list.length === 0}
        empty={canUpload ? source.rules.hint : 'No files are attached.'}
      >
        {({ list, urls }) => <FileList files={list} urls={urls} />}
      </ResourceBoundary>
    </Panel>
  )
}

function FileList({ files, urls }: { files: StoredFile[]; urls: Record<string, string> }) {
  const images = files.filter((f) => isImage(f.contentType))
  const documents = files.filter((f) => !isImage(f.contentType))
  const meta = (f: StoredFile) =>
    [formatBytes(f.sizeBytes), f.uploaderName, formatDateTime(f.createdAt)]
      .filter(Boolean)
      .join(' · ')
  return (
    <div className="flex flex-col gap-4">
      {images.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Photos">
          {images.map((f) => (
            <li key={f.id} className="overflow-hidden rounded-lg border border-outline-variant">
              {urls[f.storagePath] ? (
                <a href={urls[f.storagePath]} target="_blank" rel="noopener noreferrer">
                  <img
                    src={urls[f.storagePath]}
                    alt={f.fileName}
                    loading="lazy"
                    className="aspect-[4/3] w-full bg-surface-container object-cover"
                  />
                </a>
              ) : (
                <div className="flex aspect-[4/3] items-center justify-center bg-surface-container text-label-md text-on-surface-variant">
                  Preview unavailable
                </div>
              )}
              <p className="truncate px-2 pt-1.5 text-label-md font-medium text-on-surface">
                {f.fileName}
              </p>
              <p className="truncate px-2 pb-1.5 text-label-sm text-on-surface-variant">
                {meta(f)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {documents.length > 0 && (
        <ul className="divide-y divide-outline-variant" aria-label="Documents">
          {documents.map((f) => (
            <li key={f.id} className="flex items-center gap-3 py-2.5">
              <FileText size={20} className="shrink-0 text-on-surface-variant" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                {urls[f.storagePath] ? (
                  <a
                    href={urls[f.storagePath]}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block truncate text-body-md font-medium text-secondary hover:underline"
                  >
                    {f.fileName}
                  </a>
                ) : (
                  <p className="truncate text-body-md font-medium">{f.fileName}</p>
                )}
                <p className="text-label-md text-on-surface-variant">{meta(f)}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export interface ActivityEvent {
  id: string
  kind: string
  actorName: string | null
  createdAt: string
}

/** What happened to a record, newest first, in words. */
export function ActivityPanel<E extends ActivityEvent>({
  load,
  loadKey,
  describe,
  label,
}: {
  load: () => Promise<Result<E[]>>
  loadKey: string
  describe: (e: E) => string
  label: string
}) {
  const events = useResource(load, loadKey)
  return (
    <Panel title="Activity">
      <ResourceBoundary state={events} isEmpty={(r) => r.length === 0} empty="No activity yet.">
        {(rows) => (
          <ol className="flex flex-col gap-3" aria-label={label}>
            {rows.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span
                  className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-secondary"
                  aria-hidden="true"
                />
                <div>
                  <p className="text-body-md text-on-surface">
                    {e.kind === 'attachment' && (
                      <Paperclip size={14} className="mr-1 inline" aria-hidden="true" />
                    )}
                    {describe(e)}
                  </p>
                  <p className="text-label-md text-on-surface-variant">
                    {[e.actorName, formatDateTime(e.createdAt)].filter(Boolean).join(' · ')}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </ResourceBoundary>
    </Panel>
  )
}

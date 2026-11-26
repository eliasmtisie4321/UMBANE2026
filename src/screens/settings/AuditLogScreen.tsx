import { Download } from 'lucide-react'
import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError } from '@/components/data/ListPanel'
import { inlineLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { Pagination } from '@/components/data/Pagination'
import { Button, Input, Select } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { AUDIT_PAGE_SIZE, listAuditLog } from '@/services/settings'
import { AUDIT_ACTIONS, AUDIT_AREAS, type AuditEntry, type AuditFilter } from '@/types/settings'
import { auditDetails, auditLink, describeAudit } from '@/utils/auditText'
import { downloadFile, toCsv } from '@/utils/csv'
import { formatDateTime } from '@/utils/format'
import { patchParams, readEnum, readPage } from '@/utils/listParams'
import { isRealDate } from '@/utils/meterForm'

/** At most this many entries go into one CSV export. */
const EXPORT_LIMIT = 1000

function readFilter(params: URLSearchParams): AuditFilter {
  const date = (k: string) => {
    const v = params.get(k) ?? ''
    return isRealDate(v) ? v : ''
  }
  return {
    from: date('from'),
    to: date('to'),
    area: readEnum(
      params,
      'area',
      AUDIT_AREAS.map((a) => a.value),
    ),
    action: readEnum(
      params,
      'action',
      AUDIT_ACTIONS.map((a) => a.value),
    ),
    page: readPage(params),
  }
}

/** Who did what, and when: every audited change in the business. Administrators only. */
export default function AuditLogScreen() {
  const [params, setParams] = useSearchParams()
  const f = readFilter(params)
  const state = useResource(() => listAuditLog(f), JSON.stringify(f))
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const update = (patch: Record<string, string | number | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })

  async function exportCsv() {
    setExporting(true)
    setExportError(null)
    const rows: AuditEntry[] = []
    for (let page = 1; rows.length < EXPORT_LIMIT; page += 1) {
      const result = await listAuditLog({ ...f, page })
      if (!result.ok) {
        setExporting(false)
        return setExportError(result.error.message)
      }
      rows.push(...result.data.rows)
      if (result.data.rows.length < AUDIT_PAGE_SIZE || rows.length >= result.data.total) break
    }
    const csv = toCsv(
      [
        { label: 'When', value: (e: AuditEntry) => e.createdAt },
        { label: 'Who', value: (e: AuditEntry) => e.actorName ?? '' },
        { label: 'What', value: (e: AuditEntry) => describeAudit(e) },
        { label: 'Action', value: (e: AuditEntry) => e.action },
        { label: 'Record type', value: (e: AuditEntry) => e.table ?? '' },
        { label: 'Record', value: (e: AuditEntry) => e.recordId ?? '' },
        { label: 'Details', value: (e: AuditEntry) => auditDetails(e).join('; ') },
      ],
      rows.slice(0, EXPORT_LIMIT),
    )
    downloadFile(
      `audit-log${f.from ? `-from-${f.from}` : ''}${f.to ? `-to-${f.to}` : ''}.csv`,
      csv,
      'text/csv;charset=utf-8',
    )
    setExporting(false)
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Every change to customers, money, stock, people and settings: who made it, when, and what changed."
        back={{ to: '/settings', label: 'Settings' }}
        actions={
          <Button variant="secondary" loading={exporting} onClick={() => void exportCsv()}>
            <Download size={16} aria-hidden="true" /> Export CSV
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-outline-variant bg-surface p-4 shadow-card">
        <div className="w-40">
          <Input
            id="audit-from"
            label="From"
            type="date"
            value={f.from}
            onChange={(e) => update({ from: e.target.value })}
          />
        </div>
        <div className="w-40">
          <Input
            id="audit-to"
            label="To"
            type="date"
            value={f.to}
            onChange={(e) => update({ to: e.target.value })}
          />
        </div>
        <div className="w-56">
          <Select
            id="audit-area"
            label="About"
            value={f.area}
            options={[{ value: '', label: 'Everything' }, ...AUDIT_AREAS]}
            onChange={(e) => update({ area: e.target.value })}
          />
        </div>
        <div className="w-44">
          <Select
            id="audit-action"
            label="What happened"
            value={f.action}
            options={[{ value: '', label: 'Anything' }, ...AUDIT_ACTIONS]}
            onChange={(e) => update({ action: e.target.value })}
          />
        </div>
      </div>
      {exportError && (
        <div className="mb-4">
          <FormError>{exportError}</FormError>
        </div>
      )}
      <Panel title="Activity" subtitle="Newest first. Times are South African time.">
        <ResourceBoundary
          state={state}
          isEmpty={(d) => d.rows.length === 0}
          empty="Nothing matches these filters."
          skeletonLines={8}
        >
          {(d) => (
            <>
              <ol className="divide-y divide-outline-variant">
                {d.rows.map((e) => {
                  const link = auditLink(e)
                  const lines = auditDetails(e)
                  return (
                    <li key={e.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                      <span className="shrink-0 text-label-md text-on-surface-variant tabular-nums sm:w-40">
                        {formatDateTime(e.createdAt)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-body-md font-medium text-on-surface">
                          {describeAudit(e)}
                          {link && (
                            <>
                              {' · '}
                              <Link to={link} className={inlineLink}>
                                Open
                              </Link>
                            </>
                          )}
                        </p>
                        {lines.length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-label-md text-on-surface-variant">
                            {lines.slice(0, 8).map((l) => (
                              <li key={l} className="break-words">
                                {l}
                              </li>
                            ))}
                            {lines.length > 8 && <li>and {lines.length - 8} more changes</li>}
                          </ul>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
              <Pagination
                page={f.page}
                pageSize={AUDIT_PAGE_SIZE}
                total={d.total}
                onPageChange={(page) => update({ page })}
              />
            </>
          )}
        </ResourceBoundary>
      </Panel>
    </>
  )
}

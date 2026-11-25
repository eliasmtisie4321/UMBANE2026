import { Gauge, Pencil, PowerOff, Trash2, Wrench } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { DetailList } from '@/components/data/DetailList'
import { PageHeader } from '@/components/data/PageHeader'
import { Pagination } from '@/components/data/Pagination'
import { StatusBadge } from '@/components/data/StatusBadge'
import { ConsumptionPanel } from '@/components/meters/ConsumptionPanel'
import { MaintenanceDialog } from '@/components/meters/MaintenanceDialog'
import { EstimateBadge, FlagBadge } from '@/components/meters/MeterBadges'
import { RetireDialog } from '@/components/meters/RetireDialog'
import { Button, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getMeterMaintenance } from '@/services/maintenance'
import { deleteReading, getMeter, getMeterConsumption, getReadings } from '@/services/meters'
import {
  METER_CATEGORIES,
  METER_TYPES,
  READING_METHODS,
  type MaintenanceItem,
  type Meter,
  type Reading,
} from '@/types/meters'
import { formatDate, formatKwh, humanize } from '@/utils/format'

const READINGS_PER_PAGE = 10

const linkButton =
  'inline-flex items-center justify-center gap-2 rounded-md border border-outline-variant bg-surface px-4 py-2.5 text-label-md font-semibold text-primary hover:bg-surface-container'
const inlineLink = 'font-medium text-secondary hover:underline'
const label = (options: Array<{ value: string; label: string }>, v: string | null) =>
  options.find((o) => o.value === v)?.label

function DetailBody({
  meter,
  reload,
  onNotice,
}: {
  meter: Meter
  reload: () => void
  onNotice: (notice: ReactNode) => void
}) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const role = profile?.role ?? 'client'
  const canWrite = canAccess(role, '/electricity-meters/new')
  const canDelete = role === 'administrator' || role === 'manager'
  const retired = meter.retiredOn !== null

  const [page, setPage] = useState(1)
  // Bumped after a reading is removed, so the chart is recalculated too.
  const [version, setVersion] = useState(0)
  const [removing, setRemoving] = useState<Reading | null>(null)
  const [removeBusy, setRemoveBusy] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [retiring, setRetiring] = useState(false)
  const [workOrder, setWorkOrder] = useState<MaintenanceItem | 'new' | null>(null)

  const readings = useResource(
    () => getReadings(meter.id, page, READINGS_PER_PAGE),
    `readings-${meter.id}-${page}-${version}`,
  )

  async function confirmRemove() {
    if (!removing) return
    setRemoveBusy(true)
    setRemoveError(null)
    const result = await deleteReading(removing.id)
    setRemoveBusy(false)
    if (!result.ok) {
      setRemoveError(result.error.message)
      return
    }
    setRemoving(null)
    setPage(1)
    setVersion((v) => v + 1)
    onNotice('Reading removed.')
  }

  return (
    <>
      <PageHeader
        title={meter.serialNumber}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={meter.status} />
            <span>
              {[label(METER_TYPES, meter.meterType), meter.propertyName]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </span>
        }
        back={{ to: '/electricity-meters', label: 'Electricity & Meters' }}
        actions={
          canWrite && (
            <>
              {!retired && (
                <>
                  <Button variant="secondary" onClick={() => setRetiring(true)}>
                    <PowerOff size={16} aria-hidden="true" /> Replace or decommission
                  </Button>
                  <Link
                    to={`/electricity-meters/readings/new?meter=${meter.id}`}
                    className={linkButton}
                  >
                    <Gauge size={16} aria-hidden="true" /> Record Reading
                  </Link>
                </>
              )}
              <Link to={`/electricity-meters/${meter.id}/edit`} className={linkButton}>
                <Pencil size={16} aria-hidden="true" /> Edit
              </Link>
            </>
          )
        }
      />

      {retired && (
        <p className="mb-4 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
          {humanize(meter.status)} on {formatDate(meter.retiredOn!)}
          {meter.retiredReason ? `: ${meter.retiredReason}. ` : '. '}
          {meter.replacedById && (
            <Link to={`/electricity-meters/${meter.replacedById}`} className={inlineLink}>
              View the replacement meter
            </Link>
          )}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Meter information">
          <DetailList
            items={[
              { label: 'Serial number', value: meter.serialNumber },
              { label: 'Type', value: label(METER_TYPES, meter.meterType) },
              { label: 'Category', value: label(METER_CATEGORIES, meter.category) },
              {
                label: 'Installed',
                value: meter.installedOn ? formatDate(meter.installedOn) : null,
              },
              { label: 'Technician', value: meter.installerName },
              { label: 'Location', value: meter.location },
              ...(meter.notes ? [{ label: 'Description', value: meter.notes }] : []),
            ]}
          />
        </Panel>
        <Panel title="Linked property and customer">
          <DetailList
            items={[
              {
                label: 'Property',
                value: (
                  <Link to={`/properties/${meter.propertyId}`} className={inlineLink}>
                    {meter.propertyName}
                  </Link>
                ),
              },
              { label: 'Property ID', value: meter.propertyReference },
              { label: 'Address', value: meter.propertyAddress },
              {
                label: 'Customer',
                value:
                  meter.customerId && canAccess(role, '/customers') ? (
                    <Link to={`/customers/${meter.customerId}`} className={inlineLink}>
                      {meter.customerName ?? 'View customer'}
                    </Link>
                  ) : (
                    meter.customerName
                  ),
              },
            ]}
          />
        </Panel>

        <ConsumptionPanel
          load={() => getMeterConsumption(meter.id, 12)}
          resourceKey={`consumption-${meter.id}-${version}`}
          className="lg:col-span-2"
        />

        <Panel title="Reading history" className="lg:col-span-2">
          <ResourceBoundary
            state={readings}
            isEmpty={(d) => d.total === 0}
            empty="No readings have been recorded for this meter."
          >
            {(d) => (
              <>
                <Table>
                  <caption className="sr-only">Reading history</caption>
                  <thead>
                    <tr>
                      <Th>Date</Th>
                      <Th className="text-right">Reading</Th>
                      <Th className="text-right">Consumption</Th>
                      <Th>Days</Th>
                      <Th>Method</Th>
                      <Th>Recorded by</Th>
                      <Th>Notes</Th>
                      {canDelete && (
                        <Th>
                          <span className="sr-only">Actions</span>
                        </Th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={r.id}>
                        <Td className="whitespace-nowrap">{formatDate(r.readingDate)}</Td>
                        <Td className="whitespace-nowrap text-right">
                          <span className="inline-flex flex-wrap items-center justify-end gap-2">
                            {formatKwh(r.readingValue)}
                            {r.isEstimate && <EstimateBadge />}
                          </span>
                        </Td>
                        <Td className="whitespace-nowrap text-right">
                          <span className="inline-flex flex-wrap items-center justify-end gap-2">
                            {r.consumption === null ? '-' : formatKwh(r.consumption)}
                            {r.consumption !== null && r.consumptionIsEstimate && <EstimateBadge />}
                            {r.flag && <FlagBadge flag={r.flag} />}
                          </span>
                        </Td>
                        <Td>{r.days ?? '-'}</Td>
                        <Td className="whitespace-nowrap">{label(READING_METHODS, r.method)}</Td>
                        <Td className="whitespace-nowrap">{r.recordedByName ?? '-'}</Td>
                        <Td>{r.notes ?? '-'}</Td>
                        {canDelete && (
                          <Td>
                            <button
                              type="button"
                              aria-label={`Remove reading of ${formatDate(r.readingDate)}`}
                              onClick={() => {
                                setRemoveError(null)
                                setRemoving(r)
                              }}
                              className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container hover:text-error"
                            >
                              <Trash2 size={16} aria-hidden="true" />
                            </button>
                          </Td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </Table>
                <Pagination
                  page={page}
                  pageSize={READINGS_PER_PAGE}
                  total={d.total}
                  onPageChange={setPage}
                />
              </>
            )}
          </ResourceBoundary>
        </Panel>

        {canWrite && (
          <MeterMaintenancePanel
            meter={meter}
            onSchedule={retired ? undefined : () => setWorkOrder('new')}
            onUpdate={setWorkOrder}
          />
        )}
      </div>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this reading?"
        confirmLabel="Remove reading"
        danger
        busy={removeBusy}
        error={removeError}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoving(null)}
      >
        {removing && (
          <p>
            {formatKwh(removing.readingValue)} on {formatDate(removing.readingDate)} will be removed
            and consumption recalculated. The removal is kept in the audit log.
          </p>
        )}
      </ConfirmDialog>
      {retiring && (
        <RetireDialog
          meter={meter}
          onClose={() => setRetiring(false)}
          onDone={(newMeterId) => {
            setRetiring(false)
            if (newMeterId) {
              navigate(`/electricity-meters/${newMeterId}`, {
                state: { notice: `This meter replaces ${meter.serialNumber}.` },
              })
            } else {
              onNotice('Meter decommissioned.')
              setVersion((v) => v + 1)
              reload()
            }
          }}
        />
      )}
      {workOrder && (
        <MaintenanceDialog
          item={workOrder === 'new' ? null : workOrder}
          meter={meter}
          onClose={() => setWorkOrder(null)}
          onSaved={() => {
            setWorkOrder(null)
            onNotice('Maintenance saved.')
            reload()
          }}
        />
      )}
    </>
  )
}

function MeterMaintenancePanel({
  meter,
  onSchedule,
  onUpdate,
}: {
  meter: Meter
  onSchedule?: () => void
  onUpdate: (item: MaintenanceItem) => void
}) {
  // Keyed by the meter object: a reload of the meter after saving brings a new one, so this refetches.
  const [seen, setSeen] = useState({ meter, version: 0 })
  if (seen.meter !== meter) setSeen({ meter, version: seen.version + 1 })
  const state = useResource(
    () => getMeterMaintenance(meter.id),
    `maintenance-${meter.id}-${seen.version}`,
  )
  return (
    <Panel
      title="Maintenance history"
      className="lg:col-span-2"
      action={
        onSchedule && (
          <Button variant="secondary" className="px-3 py-1.5" onClick={onSchedule}>
            <Wrench size={16} aria-hidden="true" /> Schedule
          </Button>
        )
      }
    >
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="No maintenance has been recorded for this meter."
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Maintenance history</caption>
            <thead>
              <tr>
                <Th>Work order</Th>
                <Th>Issue</Th>
                <Th>Technician</Th>
                <Th>Date</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <Td className="whitespace-nowrap">
                    <button
                      type="button"
                      className="font-mono text-label-md font-medium text-primary hover:underline"
                      onClick={() => onUpdate(w)}
                    >
                      {w.reference}
                    </button>
                  </Td>
                  <Td>
                    {w.issue}
                    {w.outcome && (
                      <span className="block text-label-md text-on-surface-variant">
                        {w.outcome}
                      </span>
                    )}
                  </Td>
                  <Td>{w.assignedName ?? '-'}</Td>
                  <Td className="whitespace-nowrap">
                    {w.completedOn
                      ? formatDate(w.completedOn)
                      : w.scheduledFor
                        ? formatDate(w.scheduledFor)
                        : '-'}
                  </Td>
                  <Td>
                    <StatusBadge status={w.status} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </ResourceBoundary>
    </Panel>
  )
}

export default function MeterDetailScreen() {
  const { id = '' } = useParams()
  // Keyed so moving from a meter to its replacement starts fresh (page, dialogs, notice).
  return <MeterDetail key={id} id={id} />
}

function MeterDetail({ id }: { id: string }) {
  const location = useLocation()
  const [notice, setNotice] = useState<ReactNode>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const state = useResource(() => getMeter(id), `meter-${id}`)

  return (
    <>
      {notice && (
        <p
          role="status"
          className="mb-4 rounded-md bg-primary-container px-4 py-3 text-body-md text-on-primary-container"
        >
          {notice}
        </p>
      )}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(meter) => <DetailBody meter={meter} reload={state.reload} onNotice={setNotice} />}
      </ResourceBoundary>
    </>
  )
}

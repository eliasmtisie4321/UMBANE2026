import { Pencil, Plus } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { DetailList } from '@/components/data/DetailList'
import { PageHeader } from '@/components/data/PageHeader'
import { StatusBadge } from '@/components/data/StatusBadge'
import { Badge, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getPropertyMaintenance } from '@/services/maintenance'
import { getProperty, getPropertyMeters, getPropertyReadings } from '@/services/properties'
import { PROPERTY_TYPES, type Property } from '@/types/properties'
import { formatDate, formatNumber } from '@/utils/format'

const linkButton =
  'inline-flex items-center justify-center gap-2 rounded-md border border-outline-variant bg-surface px-4 py-2.5 text-label-md font-semibold text-primary hover:bg-surface-container'

const fullAddress = (p: Property) =>
  [p.address, p.suburb, [p.city, p.postalCode].filter(Boolean).join(' '), p.province]
    .filter((x) => x && x.trim() !== '')
    .join(', ')

function DetailBody({ property }: { property: Property }) {
  const { profile } = useAuth()
  const canWrite = profile !== null && canAccess(profile.role, '/electricity-meters/new')
  const meters = useResource(() => getPropertyMeters(property.id), `meters-${property.id}`)
  const readings = useResource(() => getPropertyReadings(property.id), `readings-${property.id}`)

  return (
    <>
      <PageHeader
        title={property.name ?? property.address}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            {property.reference && <span className="font-mono">{property.reference}</span>}
            <StatusBadge status={property.status} />
          </span>
        }
        back={{ to: '/properties', label: 'Properties' }}
        actions={
          <Link to={`/properties/${property.id}/edit`} className={linkButton}>
            <Pencil size={16} aria-hidden="true" /> Edit
          </Link>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Property information">
          <DetailList
            items={[
              {
                label: 'Property type',
                value: PROPERTY_TYPES.find((t) => t.value === property.propertyType)?.label,
              },
              {
                label: 'Units',
                value: property.units === null ? null : formatNumber(property.units),
              },
              { label: 'Property ID', value: property.reference },
              { label: 'Registered', value: formatDate(property.createdAt) },
            ]}
          />
        </Panel>
        <Panel title="Owner">
          <DetailList
            items={[
              {
                label: 'Customer',
                value: (
                  <Link
                    to={`/customers/${property.customerId}`}
                    className="font-medium text-secondary hover:underline"
                  >
                    {property.ownerName ?? 'View customer'}
                  </Link>
                ),
              },
              { label: 'Full address', value: fullAddress(property) },
            ]}
          />
        </Panel>

        <Panel
          title="Linked electricity meters"
          className="lg:col-span-2"
          action={
            canWrite && (
              <Link
                to={`/electricity-meters/new?property=${property.id}`}
                className="inline-flex items-center gap-1 text-label-md font-semibold text-secondary hover:text-primary"
              >
                <Plus size={16} aria-hidden="true" /> Add meter
              </Link>
            )
          }
        >
          <ResourceBoundary
            state={meters}
            isEmpty={(rows) => rows.length === 0}
            empty="No meters are linked to this property yet."
          >
            {(rows) => (
              <Table>
                <caption className="sr-only">Linked meters</caption>
                <thead>
                  <tr>
                    <Th>Serial number</Th>
                    <Th>Status</Th>
                    <Th>Installed</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((m) => (
                    <tr key={m.id}>
                      <Td>
                        <Link
                          to={`/electricity-meters/${m.id}`}
                          className="font-mono text-label-md font-medium text-primary hover:underline"
                        >
                          {m.serialNumber}
                        </Link>
                      </Td>
                      <Td>
                        <StatusBadge status={m.status} />
                      </Td>
                      <Td className="whitespace-nowrap">
                        {m.installedOn ? formatDate(m.installedOn) : '-'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </ResourceBoundary>
        </Panel>

        <Panel title="Latest meter readings" className="lg:col-span-2">
          <ResourceBoundary
            state={readings}
            isEmpty={(rows) => rows.length === 0}
            empty="No meter readings have been recorded for this property."
          >
            {(rows) => (
              <Table>
                <caption className="sr-only">Latest meter readings</caption>
                <thead>
                  <tr>
                    <Th>Date</Th>
                    <Th>Meter</Th>
                    <Th className="text-right">Reading (kWh)</Th>
                    <Th>Type</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <Td className="whitespace-nowrap">{formatDate(r.readingDate)}</Td>
                      <Td className="font-mono text-label-md">{r.serialNumber}</Td>
                      <Td className="text-right">
                        {r.readingValue.toLocaleString('en-US', { maximumFractionDigits: 3 })}
                      </Td>
                      <Td>{r.isEstimate ? <Badge tone="warning">Estimate</Badge> : 'Actual'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </ResourceBoundary>
        </Panel>
        {canWrite && <MaintenancePanel propertyId={property.id} />}
      </div>
    </>
  )
}

function MaintenancePanel({ propertyId }: { propertyId: string }) {
  const state = useResource(() => getPropertyMaintenance(propertyId), `maintenance-${propertyId}`)
  return (
    <Panel
      title="Service history"
      subtitle="Maintenance on this property's meters"
      className="lg:col-span-2"
    >
      <ResourceBoundary
        state={state}
        isEmpty={(rows) => rows.length === 0}
        empty="No maintenance has been recorded for this property's meters."
      >
        {(rows) => (
          <Table>
            <caption className="sr-only">Maintenance</caption>
            <thead>
              <tr>
                <Th>Work order</Th>
                <Th>Meter</Th>
                <Th>Issue</Th>
                <Th>Date</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <Td className="whitespace-nowrap font-mono text-label-md">{w.reference}</Td>
                  <Td>
                    <Link
                      to={`/electricity-meters/${w.meterId}`}
                      className="font-mono text-label-md text-secondary hover:underline"
                    >
                      {w.serialNumber}
                    </Link>
                  </Td>
                  <Td>{w.outcome ? `${w.issue}: ${w.outcome}` : w.issue}</Td>
                  <Td className="whitespace-nowrap">
                    {w.completedOn || w.scheduledFor
                      ? formatDate((w.completedOn ?? w.scheduledFor)!)
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

export default function PropertyDetailScreen() {
  const { id = '' } = useParams()
  const location = useLocation()
  const notice = (location.state as { notice?: string } | null)?.notice
  const state = useResource(() => getProperty(id), `property-${id}`)

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
        {(property) => <DetailBody property={property} />}
      </ResourceBoundary>
    </>
  )
}

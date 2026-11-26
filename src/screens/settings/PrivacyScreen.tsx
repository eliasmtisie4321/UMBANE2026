import { Link } from 'react-router-dom'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { inlineLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getRetentionPeriods } from '@/services/settings'
import type { RetentionPeriods } from '@/types/settings'

const span = (days: number) =>
  days % 365 === 0 || days === 2557
    ? `${Math.round(days / 365.25)} year${Math.round(days / 365.25) === 1 ? '' : 's'}`
    : `${days} days`

function rows(p: RetentionPeriods): Array<[string, string, string]> {
  return [
    [
      'Notifications',
      `${span(p.readNotificationsDays)} once read; ${span(p.notificationsDays)} at most`,
      'Removed',
    ],
    ['Automation runs and actions', span(p.automationHistoryDays), 'Removed'],
    [
      'Answered account requests',
      span(p.processedAccessRequestsDays),
      'Removed, with their audit entries',
    ],
    ['Audit log', span(p.auditDays), 'Removed'],
    [
      'Customers, properties, meters and readings',
      'While the business needs them',
      'Kept; personal details erased on request',
    ],
    ['Invoices, payments, orders and stock records', 'At least 5 years (SARS)', 'Kept'],
    [
      'Emails, tickets and tasks',
      'While the business needs them',
      'Kept; a customer’s text is erased with them',
    ],
  ]
}

/** How long Umbane keeps records, and how to erase a customer's details. Administrators only. */
export default function PrivacyScreen() {
  const state = useResource(() => getRetentionPeriods(), 'retention')
  return (
    <>
      <PageHeader
        title="Data and privacy"
        subtitle="What Umbane keeps, for how long, and how to act on a customer’s request under POPIA."
        back={{ to: '/settings', label: 'Settings' }}
      />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel
          title="How long records are kept"
          subtitle="The clean-up runs every morning with the daily automations."
        >
          <ResourceBoundary state={state}>
            {(p) => (
              <Table>
                <caption className="sr-only">How long records are kept</caption>
                <thead>
                  <tr>
                    <Th>Records</Th>
                    <Th>Kept for</Th>
                    <Th>Then</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows(p).map(([what, how, then]) => (
                    <tr key={what}>
                      <Td className="min-w-40 font-medium text-on-surface">{what}</Td>
                      <Td>{how}</Td>
                      <Td>{then}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </ResourceBoundary>
        </Panel>
        <Panel title="When a customer asks to be forgotten">
          <ol className="list-decimal space-y-2 pl-5 text-body-md text-on-surface">
            <li>
              Check the request really comes from the customer (for example, a reply from the email
              address on their account).
            </li>
            <li>Settle or credit anything they owe, and close their open support tickets.</li>
            <li>
              Open the customer in{' '}
              <Link to="/customers" className={inlineLink}>
                Customers
              </Link>{' '}
              and choose <strong>Erase Personal Details</strong>, giving the reason.
            </li>
            <li>
              Delete any photos on their tickets, and their sign-in account under Supabase →
              Authentication → Users.
            </li>
          </ol>
          <p className="mt-4 text-body-md text-on-surface-variant">
            Their invoices and payments stay, showing “Erased customer”, because tax law requires
            them. The erasure and its reason are kept in the{' '}
            <Link to="/settings/audit?action=ERASE" className={inlineLink}>
              audit log
            </Link>
            .
          </p>
        </Panel>
      </div>
    </>
  )
}

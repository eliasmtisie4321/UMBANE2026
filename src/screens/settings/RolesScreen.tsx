import { Link } from 'react-router-dom'
import { Panel } from '@/components/dashboard/Panel'
import { primaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { Table, Td, Th } from '@/components/ui'
import { ROLE_LABEL, type UserRole } from '@/types/auth'
import { ROLE_MATRIX } from '@/types/settings'

const ROLES: UserRole[] = ['administrator', 'manager', 'staff', 'client']

const ABOUT: Record<UserRole, string> = {
  administrator: 'Runs the system: people, roles, settings, the audit log and privacy requests.',
  manager: 'Runs the business day to day: everything except people’s access and the audit log.',
  staff: 'Does the work: customers, readings, orders, tickets and their own tasks.',
  client: 'A customer who signs in: sees their own account, invoices and tickets.',
}

/**
 * The four roles and what each may do. Roles are fixed; the database enforces every rule here
 * (docs/PERMISSIONS.md). People are given a role on the Team page.
 */
export default function RolesScreen() {
  return (
    <>
      <PageHeader
        title="Roles and permissions"
        subtitle="Everyone has one of four roles. The database checks every action against it."
        back={{ to: '/settings', label: 'Settings' }}
        actions={
          <Link to="/team" className={primaryLink}>
            Change someone’s role
          </Link>
        }
      />
      <ul className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {ROLES.map((r) => (
          <li
            key={r}
            className="rounded-lg border border-outline-variant bg-surface p-5 shadow-card"
          >
            <h2 className="text-title-md font-semibold text-on-surface">{ROLE_LABEL[r]}</h2>
            <p className="mt-1 text-body-md text-on-surface-variant">{ABOUT[r]}</p>
          </li>
        ))}
      </ul>
      <Panel title="What each role can do">
        <Table>
          <caption className="sr-only">What each role can do</caption>
          <thead>
            <tr>
              <Th>Area</Th>
              {ROLES.map((r) => (
                <Th key={r}>{ROLE_LABEL[r]}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ROLE_MATRIX.map((row) => (
              <tr key={row.area}>
                <th
                  scope="row"
                  className="border-b border-outline-variant px-4 py-3 text-left text-body-md font-medium text-on-surface"
                >
                  {row.area}
                </th>
                {ROLES.map((r) => (
                  <Td
                    key={r}
                    className={row.rights[r] === '-' ? 'text-on-surface-variant' : undefined}
                  >
                    {row.rights[r] === '-' ? 'No access' : row.rights[r]}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </>
  )
}

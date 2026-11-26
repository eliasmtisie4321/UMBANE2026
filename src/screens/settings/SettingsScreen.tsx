import {
  ArrowRight,
  Bell,
  Building2,
  FileClock,
  KeyRound,
  Receipt,
  ShieldCheck,
  Tags,
  UserCog,
  Users,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/data/PageHeader'
import { useAuth } from '@/auth/useAuth'
import { canAccess } from '@/auth/permissions'

interface Card {
  to: string
  title: string
  description: string
  icon: LucideIcon
  /** Shown to managers as view-only. */
  viewOnlyFor?: 'manager'
}

const CARDS: Card[] = [
  {
    to: '/settings/business',
    title: 'Business profile',
    description: 'Business name, description, contact details and address.',
    icon: Building2,
    viewOnlyFor: 'manager',
  },
  {
    to: '/settings/invoicing',
    title: 'Invoice and tax settings',
    description: 'VAT registration, bank details for EFT, payment terms and the invoice footer.',
    icon: Receipt,
    viewOnlyFor: 'manager',
  },
  {
    to: '/team',
    title: 'Users',
    description: 'Invite people, change their role, and deactivate those who leave.',
    icon: Users,
  },
  {
    to: '/settings/roles',
    title: 'Roles and permissions',
    description: 'What administrators, managers, staff and customers can each do.',
    icon: UserCog,
  },
  {
    to: '/settings/categories',
    title: 'Categories',
    description: 'The ticket categories customers choose from, and product categories.',
    icon: Tags,
  },
  {
    to: '/notifications/settings',
    title: 'Notification preferences',
    description: 'Which notifications you get in the app and by email.',
    icon: Bell,
  },
  {
    to: '/automations',
    title: 'Automations',
    description: 'Overdue invoice alerts, reminders and customer emails that run by themselves.',
    icon: Zap,
  },
  {
    to: '/account/security',
    title: 'Your password and sign-in',
    description: 'Change your password and sign out of other devices.',
    icon: KeyRound,
  },
  {
    to: '/settings/audit',
    title: 'Audit log',
    description: 'Who changed what, and when, across the system.',
    icon: FileClock,
  },
  {
    to: '/settings/privacy',
    title: 'Data and privacy',
    description: 'How long records are kept, and erasing a customer’s details on request (POPIA).',
    icon: ShieldCheck,
  },
]

/** Everything an administrator or manager can set up, in one place. */
export default function SettingsScreen() {
  const { profile } = useAuth()
  const role = profile?.role ?? 'staff'
  const cards = CARDS.filter((c) => canAccess(role, c.to))
  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Your business details, people and access, categories, notifications and records."
      />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <li key={c.to}>
            <Link
              to={c.to}
              className="flex h-full flex-col rounded-lg border border-outline-variant bg-surface p-5 shadow-card transition-colors hover:border-primary"
            >
              <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary-container text-primary">
                <c.icon size={18} aria-hidden="true" />
              </span>
              <span className="text-title-md font-semibold text-on-surface">{c.title}</span>
              <span className="mt-1 flex-1 text-body-md text-on-surface-variant">
                {c.description}
              </span>
              <span className="mt-3 inline-flex items-center gap-1 text-label-md font-semibold text-secondary">
                {c.viewOnlyFor === role ? 'View' : 'Open'}{' '}
                <ArrowRight size={14} aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  )
}

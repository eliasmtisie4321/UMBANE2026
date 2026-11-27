import {
  Activity,
  Building2,
  CalendarPlus,
  ClipboardList,
  Gauge,
  Package,
  Receipt,
  ShoppingBag,
  Ticket,
  UserPlus,
  UserSearch,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { canAccess } from '@/auth/permissions'
import type { UserRole } from '@/types/auth'

export interface QuickAddAction {
  to: string
  label: string
  icon: LucideIcon
}

/** Everything that can be created from the top bar, in the order people usually need them. */
export const QUICK_ADD: QuickAddAction[] = [
  { to: '/customers/new', label: 'Customer', icon: Users },
  { to: '/properties/new', label: 'Property', icon: Building2 },
  { to: '/electricity-meters/new', label: 'Meter', icon: Gauge },
  { to: '/electricity-meters/readings/new', label: 'Meter reading', icon: Activity },
  { to: '/leads/new', label: 'Lead', icon: UserSearch },
  { to: '/sales-orders/new', label: 'Sales order', icon: ShoppingBag },
  { to: '/invoices/new', label: 'Invoice', icon: Receipt },
  { to: '/inventory/new', label: 'Product', icon: Package },
  { to: '/support-tickets/new', label: 'Support ticket', icon: Ticket },
  { to: '/tasks/new', label: 'Task', icon: ClipboardList },
  { to: '/calendar?new=1', label: 'Calendar event', icon: CalendarPlus },
  { to: '/team/new', label: 'Employee', icon: UserPlus },
]

/** What this role may create (the same rules as the pages themselves). */
export const quickAddFor = (role: UserRole) =>
  QUICK_ADD.filter((a) => canAccess(role, a.to.split('?')[0]))

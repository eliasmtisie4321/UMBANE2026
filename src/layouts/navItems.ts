import {
  Bell,
  ClipboardList,
  BarChart3,
  CalendarDays,
  Building2,
  Zap,
  Gauge,
  LayoutDashboard,
  Megaphone,
  MessagesSquare,
  Package,
  Receipt,
  Settings,
  ShoppingBag,
  Ticket,
  UserSearch,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

/** Primary navigation, mirroring the Stitch main dashboard sidebar. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/customers', label: 'Customers', icon: Users },
  { to: '/properties', label: 'Properties', icon: Building2 },
  { to: '/electricity-meters', label: 'Electricity & Meters', icon: Gauge },
  { to: '/leads', label: 'Leads', icon: UserSearch },
  { to: '/sales-orders', label: 'Sales & Orders', icon: ShoppingBag },
  { to: '/invoices', label: 'Invoices', icon: Receipt },
  { to: '/inventory', label: 'Inventory', icon: Package },
  { to: '/support-tickets', label: 'Support Tickets', icon: Ticket },
  { to: '/marketing', label: 'Marketing', icon: Megaphone },
  { to: '/communications', label: 'Communications', icon: MessagesSquare },
  { to: '/team', label: 'Team', icon: UsersRound },
  { to: '/tasks', label: 'Tasks', icon: ClipboardList },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/automations', label: 'Automations', icon: Zap },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
]

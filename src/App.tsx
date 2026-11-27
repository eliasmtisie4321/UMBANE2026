import { lazyScreen } from '@/utils/lazyScreen'
import { Route, Routes } from 'react-router-dom'
import { ProtectedShell } from '@/layouts/ProtectedShell'
import { NAV_ITEMS } from '@/layouts/navItems'
import ComingSoonScreen from '@/screens/ComingSoonScreen'
import CreateAccountScreen from '@/screens/CreateAccountScreen'
import ForgotPasswordScreen from '@/screens/ForgotPasswordScreen'
import LoginScreen from '@/screens/LoginScreen'
import NotFoundScreen from '@/screens/NotFoundScreen'
import ResetPasswordScreen from '@/screens/ResetPasswordScreen'
import WelcomeScreen from '@/screens/WelcomeScreen'

// Each signed-in screen is its own chunk, loaded the first time it is opened, so the app starts
// with only what the sign-in page and the shell need (see docs/QA.md).
const NotificationSettingsScreen = lazyScreen(() => import('@/screens/NotificationSettingsScreen'))
const NotificationsScreen = lazyScreen(() => import('@/screens/NotificationsScreen'))
const AutomationDetailScreen = lazyScreen(
  () => import('@/screens/automations/AutomationDetailScreen'),
)
const AutomationsScreen = lazyScreen(() => import('@/screens/automations/AutomationsScreen'))
const OverviewScreen = lazyScreen(() => import('@/screens/OverviewScreen'))
const CustomerReportScreen = lazyScreen(() => import('@/screens/reports/CustomerReportScreen'))
const ElectricityReportScreen = lazyScreen(
  () => import('@/screens/reports/ElectricityReportScreen'),
)
const InventoryReportScreen = lazyScreen(() => import('@/screens/reports/InventoryReportScreen'))
const PropertyReportScreen = lazyScreen(() => import('@/screens/reports/PropertyReportScreen'))
const ReportsScreen = lazyScreen(() => import('@/screens/reports/ReportsScreen'))
const RevenueReportScreen = lazyScreen(() => import('@/screens/reports/RevenueReportScreen'))
const SalesReportScreen = lazyScreen(() => import('@/screens/reports/SalesReportScreen'))
const SupportReportScreen = lazyScreen(() => import('@/screens/reports/SupportReportScreen'))
const TeamReportScreen = lazyScreen(() => import('@/screens/reports/TeamReportScreen'))
const CommunicationsScreen = lazyScreen(
  () => import('@/screens/communications/CommunicationsScreen'),
)
const MessageDetailScreen = lazyScreen(() => import('@/screens/communications/MessageDetailScreen'))
const TemplatesScreen = lazyScreen(() => import('@/screens/communications/TemplatesScreen'))
const CustomerProfileScreen = lazyScreen(() => import('@/screens/customers/CustomerProfileScreen'))
const EditCustomerScreen = lazyScreen(() =>
  import('@/screens/customers/CustomerFormScreen').then((m) => ({ default: m.EditCustomerScreen })),
)
const NewCustomerScreen = lazyScreen(() =>
  import('@/screens/customers/CustomerFormScreen').then((m) => ({ default: m.NewCustomerScreen })),
)
const CustomersScreen = lazyScreen(() => import('@/screens/customers/CustomersScreen'))
const EditInvoiceScreen = lazyScreen(() =>
  import('@/screens/invoices/InvoiceFormScreen').then((m) => ({ default: m.EditInvoiceScreen })),
)
const NewInvoiceScreen = lazyScreen(() =>
  import('@/screens/invoices/InvoiceFormScreen').then((m) => ({ default: m.NewInvoiceScreen })),
)
const InvoiceDetailScreen = lazyScreen(() => import('@/screens/invoices/InvoiceDetailScreen'))
const InvoicesScreen = lazyScreen(() => import('@/screens/invoices/InvoicesScreen'))
const PaymentsScreen = lazyScreen(() => import('@/screens/invoices/PaymentsScreen'))
const InvoiceSettingsScreen = lazyScreen(() => import('@/screens/settings/InvoiceSettingsScreen'))
const AccountSecurityScreen = lazyScreen(() => import('@/screens/account/AccountSecurityScreen'))
const AuditLogScreen = lazyScreen(() => import('@/screens/settings/AuditLogScreen'))
const BusinessProfileScreen = lazyScreen(() => import('@/screens/settings/BusinessProfileScreen'))
const CategoriesScreen = lazyScreen(() => import('@/screens/settings/CategoriesScreen'))
const PrivacyScreen = lazyScreen(() => import('@/screens/settings/PrivacyScreen'))
const RolesScreen = lazyScreen(() => import('@/screens/settings/RolesScreen'))
const SettingsScreen = lazyScreen(() => import('@/screens/settings/SettingsScreen'))
const IntegrationsScreen = lazyScreen(() => import('@/screens/settings/IntegrationsScreen'))
const MarketingScreen = lazyScreen(() => import('@/screens/marketing/MarketingScreen'))
const InventoryHistoryScreen = lazyScreen(
  () => import('@/screens/inventory/InventoryHistoryScreen'),
)
const InventoryScreen = lazyScreen(() => import('@/screens/inventory/InventoryScreen'))
const ProductDetailScreen = lazyScreen(() => import('@/screens/inventory/ProductDetailScreen'))
const EditProductScreen = lazyScreen(() =>
  import('@/screens/inventory/ProductFormScreen').then((m) => ({ default: m.EditProductScreen })),
)
const NewProductScreen = lazyScreen(() =>
  import('@/screens/inventory/ProductFormScreen').then((m) => ({ default: m.NewProductScreen })),
)
const LeadDetailScreen = lazyScreen(() => import('@/screens/leads/LeadDetailScreen'))
const EditLeadScreen = lazyScreen(() =>
  import('@/screens/leads/LeadFormScreen').then((m) => ({ default: m.EditLeadScreen })),
)
const NewLeadScreen = lazyScreen(() =>
  import('@/screens/leads/LeadFormScreen').then((m) => ({ default: m.NewLeadScreen })),
)
const LeadsScreen = lazyScreen(() => import('@/screens/leads/LeadsScreen'))
const OrderDetailScreen = lazyScreen(() => import('@/screens/orders/OrderDetailScreen'))
const EditOrderScreen = lazyScreen(() =>
  import('@/screens/orders/OrderFormScreen').then((m) => ({ default: m.EditOrderScreen })),
)
const NewOrderScreen = lazyScreen(() =>
  import('@/screens/orders/OrderFormScreen').then((m) => ({ default: m.NewOrderScreen })),
)
const OrdersScreen = lazyScreen(() => import('@/screens/orders/OrdersScreen'))
const MaintenanceScreen = lazyScreen(() => import('@/screens/meters/MaintenanceScreen'))
const MeterDetailScreen = lazyScreen(() => import('@/screens/meters/MeterDetailScreen'))
const EditMeterScreen = lazyScreen(() =>
  import('@/screens/meters/MeterFormScreen').then((m) => ({ default: m.EditMeterScreen })),
)
const NewMeterScreen = lazyScreen(() =>
  import('@/screens/meters/MeterFormScreen').then((m) => ({ default: m.NewMeterScreen })),
)
const MetersScreen = lazyScreen(() => import('@/screens/meters/MetersScreen'))
const RecordReadingScreen = lazyScreen(() => import('@/screens/meters/RecordReadingScreen'))
const PropertiesScreen = lazyScreen(() => import('@/screens/properties/PropertiesScreen'))
const SupportTicketsScreen = lazyScreen(() => import('@/screens/support/SupportTicketsScreen'))
const TicketDetailScreen = lazyScreen(() => import('@/screens/support/TicketDetailScreen'))
const EditTicketScreen = lazyScreen(() =>
  import('@/screens/support/TicketFormScreen').then((m) => ({ default: m.EditTicketScreen })),
)
const NewTicketScreen = lazyScreen(() =>
  import('@/screens/support/TicketFormScreen').then((m) => ({ default: m.NewTicketScreen })),
)
const TaskDetailScreen = lazyScreen(() => import('@/screens/tasks/TaskDetailScreen'))
const EditTaskScreen = lazyScreen(() =>
  import('@/screens/tasks/TaskFormScreen').then((m) => ({ default: m.EditTaskScreen })),
)
const NewTaskScreen = lazyScreen(() =>
  import('@/screens/tasks/TaskFormScreen').then((m) => ({ default: m.NewTaskScreen })),
)
const TasksScreen = lazyScreen(() => import('@/screens/tasks/TasksScreen'))
const EmployeeProfileScreen = lazyScreen(() => import('@/screens/team/EmployeeProfileScreen'))
const EditEmployeeScreen = lazyScreen(() =>
  import('@/screens/team/EmployeeFormScreen').then((m) => ({ default: m.EditEmployeeScreen })),
)
const NewEmployeeScreen = lazyScreen(() =>
  import('@/screens/team/EmployeeFormScreen').then((m) => ({ default: m.NewEmployeeScreen })),
)
const TeamScreen = lazyScreen(() => import('@/screens/team/TeamScreen'))
const PropertyDetailScreen = lazyScreen(() => import('@/screens/properties/PropertyDetailScreen'))
const EditPropertyScreen = lazyScreen(() =>
  import('@/screens/properties/PropertyFormScreen').then((m) => ({
    default: m.EditPropertyScreen,
  })),
)
const NewPropertyScreen = lazyScreen(() =>
  import('@/screens/properties/PropertyFormScreen').then((m) => ({ default: m.NewPropertyScreen })),
)

// Sections that have real screens; every other nav item still shows the placeholder.
const BUILT = [
  '/customers',
  '/properties',
  '/electricity-meters',
  '/leads',
  '/sales-orders',
  '/invoices',
  '/inventory',
  '/support-tickets',
  '/notifications',
  '/team',
  '/tasks',
  '/communications',
  '/reports',
  '/automations',
  '/settings',
  '/marketing',
]

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/create-account" element={<CreateAccountScreen />} />
      <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
      <Route path="/reset-password" element={<ResetPasswordScreen />} />
      <Route path="/welcome" element={<WelcomeScreen />} />
      <Route element={<ProtectedShell />}>
        <Route index element={<OverviewScreen />} />
        <Route path="/customers" element={<CustomersScreen />} />
        <Route path="/customers/new" element={<NewCustomerScreen />} />
        <Route path="/customers/:id" element={<CustomerProfileScreen />} />
        <Route path="/customers/:id/edit" element={<EditCustomerScreen />} />
        <Route path="/properties" element={<PropertiesScreen />} />
        <Route path="/properties/new" element={<NewPropertyScreen />} />
        <Route path="/properties/:id" element={<PropertyDetailScreen />} />
        <Route path="/properties/:id/edit" element={<EditPropertyScreen />} />
        <Route path="/electricity-meters" element={<MetersScreen />} />
        <Route path="/electricity-meters/new" element={<NewMeterScreen />} />
        <Route path="/electricity-meters/maintenance" element={<MaintenanceScreen />} />
        <Route path="/electricity-meters/readings/new" element={<RecordReadingScreen />} />
        <Route path="/electricity-meters/:id" element={<MeterDetailScreen />} />
        <Route path="/electricity-meters/:id/edit" element={<EditMeterScreen />} />
        <Route path="/leads" element={<LeadsScreen />} />
        <Route path="/leads/new" element={<NewLeadScreen />} />
        <Route path="/leads/:id" element={<LeadDetailScreen />} />
        <Route path="/leads/:id/edit" element={<EditLeadScreen />} />
        <Route path="/sales-orders" element={<OrdersScreen />} />
        <Route path="/sales-orders/new" element={<NewOrderScreen />} />
        <Route path="/sales-orders/:id" element={<OrderDetailScreen />} />
        <Route path="/sales-orders/:id/edit" element={<EditOrderScreen />} />
        <Route path="/invoices" element={<InvoicesScreen />} />
        <Route path="/invoices/new" element={<NewInvoiceScreen />} />
        <Route path="/invoices/payments" element={<PaymentsScreen />} />
        <Route path="/invoices/:id" element={<InvoiceDetailScreen />} />
        <Route path="/invoices/:id/edit" element={<EditInvoiceScreen />} />
        <Route path="/inventory" element={<InventoryScreen />} />
        <Route path="/inventory/new" element={<NewProductScreen />} />
        <Route path="/inventory/history" element={<InventoryHistoryScreen />} />
        <Route path="/inventory/:id" element={<ProductDetailScreen />} />
        <Route path="/inventory/:id/edit" element={<EditProductScreen />} />
        <Route path="/support-tickets" element={<SupportTicketsScreen />} />
        <Route path="/support-tickets/new" element={<NewTicketScreen />} />
        <Route path="/support-tickets/:id" element={<TicketDetailScreen />} />
        <Route path="/support-tickets/:id/edit" element={<EditTicketScreen />} />
        <Route path="/notifications" element={<NotificationsScreen />} />
        <Route path="/notifications/settings" element={<NotificationSettingsScreen />} />
        <Route path="/automations" element={<AutomationsScreen />} />
        <Route path="/automations/:key" element={<AutomationDetailScreen />} />
        <Route path="/team" element={<TeamScreen />} />
        <Route path="/team/new" element={<NewEmployeeScreen />} />
        <Route path="/team/:id" element={<EmployeeProfileScreen />} />
        <Route path="/team/:id/edit" element={<EditEmployeeScreen />} />
        <Route path="/tasks" element={<TasksScreen />} />
        <Route path="/tasks/new" element={<NewTaskScreen />} />
        <Route path="/tasks/:id" element={<TaskDetailScreen />} />
        <Route path="/tasks/:id/edit" element={<EditTaskScreen />} />
        <Route path="/communications" element={<CommunicationsScreen />} />
        <Route path="/communications/templates" element={<TemplatesScreen />} />
        <Route path="/communications/:id" element={<MessageDetailScreen />} />
        <Route path="/reports" element={<ReportsScreen />} />
        <Route path="/reports/customers" element={<CustomerReportScreen />} />
        <Route path="/reports/properties" element={<PropertyReportScreen />} />
        <Route path="/reports/electricity" element={<ElectricityReportScreen />} />
        <Route path="/reports/sales" element={<SalesReportScreen />} />
        <Route path="/reports/revenue" element={<RevenueReportScreen />} />
        <Route path="/reports/inventory" element={<InventoryReportScreen />} />
        <Route path="/reports/support" element={<SupportReportScreen />} />
        <Route path="/reports/team" element={<TeamReportScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
        <Route path="/settings/invoicing" element={<InvoiceSettingsScreen />} />
        <Route path="/settings/business" element={<BusinessProfileScreen />} />
        <Route path="/settings/categories" element={<CategoriesScreen />} />
        <Route path="/settings/roles" element={<RolesScreen />} />
        <Route path="/settings/audit" element={<AuditLogScreen />} />
        <Route path="/settings/privacy" element={<PrivacyScreen />} />
        <Route path="/settings/integrations" element={<IntegrationsScreen />} />
        <Route path="/marketing" element={<MarketingScreen />} />
        <Route path="/account/security" element={<AccountSecurityScreen />} />
        {NAV_ITEMS.filter((i) => i.to !== '/' && !BUILT.includes(i.to)).map((item) => (
          <Route
            key={item.to}
            path={`${item.to}/*`}
            element={<ComingSoonScreen title={item.label} />}
          />
        ))}
        <Route path="*" element={<NotFoundScreen />} />
      </Route>
    </Routes>
  )
}

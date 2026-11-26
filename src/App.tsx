import { Route, Routes } from 'react-router-dom'
import { ProtectedShell } from '@/layouts/ProtectedShell'
import { NAV_ITEMS } from '@/layouts/navItems'
import ComingSoonScreen from '@/screens/ComingSoonScreen'
import CreateAccountScreen from '@/screens/CreateAccountScreen'
import ForgotPasswordScreen from '@/screens/ForgotPasswordScreen'
import LoginScreen from '@/screens/LoginScreen'
import NotFoundScreen from '@/screens/NotFoundScreen'
import NotificationSettingsScreen from '@/screens/NotificationSettingsScreen'
import NotificationsScreen from '@/screens/NotificationsScreen'
import AutomationDetailScreen from '@/screens/automations/AutomationDetailScreen'
import AutomationsScreen from '@/screens/automations/AutomationsScreen'
import OverviewScreen from '@/screens/OverviewScreen'
import ResetPasswordScreen from '@/screens/ResetPasswordScreen'
import CustomerReportScreen from '@/screens/reports/CustomerReportScreen'
import ElectricityReportScreen from '@/screens/reports/ElectricityReportScreen'
import InventoryReportScreen from '@/screens/reports/InventoryReportScreen'
import PropertyReportScreen from '@/screens/reports/PropertyReportScreen'
import ReportsScreen from '@/screens/reports/ReportsScreen'
import RevenueReportScreen from '@/screens/reports/RevenueReportScreen'
import SalesReportScreen from '@/screens/reports/SalesReportScreen'
import SupportReportScreen from '@/screens/reports/SupportReportScreen'
import TeamReportScreen from '@/screens/reports/TeamReportScreen'
import CommunicationsScreen from '@/screens/communications/CommunicationsScreen'
import MessageDetailScreen from '@/screens/communications/MessageDetailScreen'
import TemplatesScreen from '@/screens/communications/TemplatesScreen'
import CustomerProfileScreen from '@/screens/customers/CustomerProfileScreen'
import { EditCustomerScreen, NewCustomerScreen } from '@/screens/customers/CustomerFormScreen'
import CustomersScreen from '@/screens/customers/CustomersScreen'
import { EditInvoiceScreen, NewInvoiceScreen } from '@/screens/invoices/InvoiceFormScreen'
import InvoiceDetailScreen from '@/screens/invoices/InvoiceDetailScreen'
import InvoicesScreen from '@/screens/invoices/InvoicesScreen'
import PaymentsScreen from '@/screens/invoices/PaymentsScreen'
import InvoiceSettingsScreen from '@/screens/settings/InvoiceSettingsScreen'
import AccountSecurityScreen from '@/screens/account/AccountSecurityScreen'
import AuditLogScreen from '@/screens/settings/AuditLogScreen'
import BusinessProfileScreen from '@/screens/settings/BusinessProfileScreen'
import CategoriesScreen from '@/screens/settings/CategoriesScreen'
import PrivacyScreen from '@/screens/settings/PrivacyScreen'
import RolesScreen from '@/screens/settings/RolesScreen'
import SettingsScreen from '@/screens/settings/SettingsScreen'
import InventoryHistoryScreen from '@/screens/inventory/InventoryHistoryScreen'
import InventoryScreen from '@/screens/inventory/InventoryScreen'
import ProductDetailScreen from '@/screens/inventory/ProductDetailScreen'
import { EditProductScreen, NewProductScreen } from '@/screens/inventory/ProductFormScreen'
import LeadDetailScreen from '@/screens/leads/LeadDetailScreen'
import { EditLeadScreen, NewLeadScreen } from '@/screens/leads/LeadFormScreen'
import LeadsScreen from '@/screens/leads/LeadsScreen'
import OrderDetailScreen from '@/screens/orders/OrderDetailScreen'
import { EditOrderScreen, NewOrderScreen } from '@/screens/orders/OrderFormScreen'
import OrdersScreen from '@/screens/orders/OrdersScreen'
import MaintenanceScreen from '@/screens/meters/MaintenanceScreen'
import MeterDetailScreen from '@/screens/meters/MeterDetailScreen'
import { EditMeterScreen, NewMeterScreen } from '@/screens/meters/MeterFormScreen'
import MetersScreen from '@/screens/meters/MetersScreen'
import RecordReadingScreen from '@/screens/meters/RecordReadingScreen'
import PropertiesScreen from '@/screens/properties/PropertiesScreen'
import SupportTicketsScreen from '@/screens/support/SupportTicketsScreen'
import TicketDetailScreen from '@/screens/support/TicketDetailScreen'
import { EditTicketScreen, NewTicketScreen } from '@/screens/support/TicketFormScreen'
import TaskDetailScreen from '@/screens/tasks/TaskDetailScreen'
import { EditTaskScreen, NewTaskScreen } from '@/screens/tasks/TaskFormScreen'
import TasksScreen from '@/screens/tasks/TasksScreen'
import EmployeeProfileScreen from '@/screens/team/EmployeeProfileScreen'
import { EditEmployeeScreen, NewEmployeeScreen } from '@/screens/team/EmployeeFormScreen'
import TeamScreen from '@/screens/team/TeamScreen'
import PropertyDetailScreen from '@/screens/properties/PropertyDetailScreen'
import { EditPropertyScreen, NewPropertyScreen } from '@/screens/properties/PropertyFormScreen'

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
]

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
      <Route path="/create-account" element={<CreateAccountScreen />} />
      <Route path="/forgot-password" element={<ForgotPasswordScreen />} />
      <Route path="/reset-password" element={<ResetPasswordScreen />} />
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

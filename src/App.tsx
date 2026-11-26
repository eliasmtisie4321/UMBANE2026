import { Route, Routes } from 'react-router-dom'
import { ProtectedShell } from '@/layouts/ProtectedShell'
import { NAV_ITEMS } from '@/layouts/navItems'
import ComingSoonScreen from '@/screens/ComingSoonScreen'
import CreateAccountScreen from '@/screens/CreateAccountScreen'
import ForgotPasswordScreen from '@/screens/ForgotPasswordScreen'
import LoginScreen from '@/screens/LoginScreen'
import NotFoundScreen from '@/screens/NotFoundScreen'
import OverviewScreen from '@/screens/OverviewScreen'
import ResetPasswordScreen from '@/screens/ResetPasswordScreen'
import CustomerProfileScreen from '@/screens/customers/CustomerProfileScreen'
import { EditCustomerScreen, NewCustomerScreen } from '@/screens/customers/CustomerFormScreen'
import CustomersScreen from '@/screens/customers/CustomersScreen'
import { EditInvoiceScreen, NewInvoiceScreen } from '@/screens/invoices/InvoiceFormScreen'
import InvoiceDetailScreen from '@/screens/invoices/InvoiceDetailScreen'
import InvoicesScreen from '@/screens/invoices/InvoicesScreen'
import PaymentsScreen from '@/screens/invoices/PaymentsScreen'
import InvoiceSettingsScreen from '@/screens/settings/InvoiceSettingsScreen'
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
        <Route path="/settings/invoicing" element={<InvoiceSettingsScreen />} />
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

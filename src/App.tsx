import { Route, Routes } from 'react-router-dom'
import { ProtectedShell } from '@/layouts/ProtectedShell'
import { NAV_ITEMS } from '@/layouts/navItems'
import ComingSoonScreen from '@/screens/ComingSoonScreen'
import ForgotPasswordScreen from '@/screens/ForgotPasswordScreen'
import LoginScreen from '@/screens/LoginScreen'
import NotFoundScreen from '@/screens/NotFoundScreen'
import OverviewScreen from '@/screens/OverviewScreen'
import ResetPasswordScreen from '@/screens/ResetPasswordScreen'
import CustomerProfileScreen from '@/screens/customers/CustomerProfileScreen'
import { EditCustomerScreen, NewCustomerScreen } from '@/screens/customers/CustomerFormScreen'
import CustomersScreen from '@/screens/customers/CustomersScreen'
import PropertiesScreen from '@/screens/properties/PropertiesScreen'
import PropertyDetailScreen from '@/screens/properties/PropertyDetailScreen'
import { EditPropertyScreen, NewPropertyScreen } from '@/screens/properties/PropertyFormScreen'

// Sections that have real screens; every other nav item still shows the placeholder.
const BUILT = ['/customers', '/properties']

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginScreen />} />
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

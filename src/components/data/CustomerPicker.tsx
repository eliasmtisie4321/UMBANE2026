import { searchCustomerOptions } from '@/services/properties'
import type { CustomerOption } from '@/types/properties'
import { OptionPicker } from './OptionPicker'

interface CustomerPickerProps {
  id: string
  label: string
  selected: CustomerOption | null
  error?: string
  onSelect: (customer: CustomerOption | null) => void
}

export function CustomerPicker(props: CustomerPickerProps) {
  return (
    <OptionPicker
      {...props}
      noun="customers"
      placeholder="Search customer by name, email or company"
      search={(text) => searchCustomerOptions(text)}
      title={(c) => (c.companyName ? `${c.name} (${c.companyName})` : c.name)}
      detail={(c) => c.email}
    />
  )
}

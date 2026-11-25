import { OptionPicker } from '@/components/data/OptionPicker'
import { searchMeterOptions } from '@/services/meters'
import type { MeterOption } from '@/types/meters'

interface MeterPickerProps {
  id: string
  selected: MeterOption | null
  error?: string
  onSelect: (meter: MeterOption | null) => void
}

export function MeterPicker(props: MeterPickerProps) {
  return (
    <OptionPicker
      {...props}
      label="Meter"
      noun="meters"
      placeholder="Search by serial number, property or customer"
      search={(text) => searchMeterOptions(text)}
      title={(m) => m.serialNumber}
      detail={(m) => [m.propertyName, m.customerName].filter(Boolean).join(' · ')}
    />
  )
}

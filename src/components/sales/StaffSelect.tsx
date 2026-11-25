import { Select } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { listStaffOptions } from '@/services/maintenance'

interface StaffSelectProps {
  id: string
  label: string
  value: string
  /** Name of the person already chosen, so they stay listed after leaving the team. */
  currentName?: string | null
  emptyLabel?: string
  error?: string
  onChange: (id: string) => void
}

export function StaffSelect({
  id,
  label,
  value,
  currentName,
  emptyLabel = 'Not assigned',
  error,
  onChange,
}: StaffSelectProps) {
  const staff = useResource(() => listStaffOptions(), 'staff-options')
  const people = staff.data ?? []
  return (
    <Select
      id={id}
      label={label}
      value={value}
      error={error ?? (staff.status === 'error' ? 'The team list could not be loaded.' : undefined)}
      options={[
        { value: '', label: emptyLabel },
        ...people.map((p) => ({ value: p.id, label: p.name })),
        ...(value && !people.some((p) => p.id === value)
          ? [{ value, label: currentName ?? 'Current choice' }]
          : []),
      ]}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

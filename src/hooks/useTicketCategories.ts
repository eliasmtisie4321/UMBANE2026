import { listTicketCategories } from '@/services/settings'
import { TICKET_CATEGORIES } from '@/types/support'
import { humanize } from '@/utils/format'
import { useResource } from './useResource'

export interface CategoryOption {
  value: string
  label: string
}

/**
 * The business's ticket categories (Settings → Categories). Until they load, or if they cannot,
 * the six standard ones are used, so forms and filters always have something to offer.
 */
export function useTicketCategories() {
  const state = useResource(() => listTicketCategories(), 'ticket-categories')
  const loaded = state.data && state.data.length > 0 ? state.data : null
  const all: Array<CategoryOption & { isActive: boolean }> = loaded
    ? loaded.map((c) => ({ value: c.key, label: c.label, isActive: c.isActive }))
    : TICKET_CATEGORIES.map((c) => ({ value: c.value, label: c.label, isActive: true }))
  /** Categories that can be chosen now. */
  const options: CategoryOption[] = all
    .filter((c) => c.isActive)
    .map(({ value, label }) => ({ value, label }))
  /** Every category, switched off ones too (for filters and old tickets). */
  const every: CategoryOption[] = all.map(({ value, label }) => ({ value, label }))
  const label = (key: string | null | undefined) =>
    key ? (all.find((c) => c.value === key)?.label ?? humanize(key)) : ''
  return { options, every, label }
}

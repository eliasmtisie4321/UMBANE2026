import { Badge } from '@/components/ui'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const TONES: Record<string, { tone: Tone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  pending: { tone: 'warning', label: 'Pending' },
  inactive: { tone: 'neutral', label: 'Inactive' },
  maintenance: { tone: 'warning', label: 'Maintenance' },
  offline: { tone: 'error', label: 'Offline' },
}

/** Status as a word, never colour alone. Unknown statuses are shown as stored. */
export function StatusBadge({ status }: { status: string }) {
  const known = TONES[status]
  return <Badge tone={known?.tone ?? 'neutral'}>{known?.label ?? status}</Badge>
}

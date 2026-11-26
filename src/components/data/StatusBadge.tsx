import { Badge } from '@/components/ui'

type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'error'

const TONES: Record<string, { tone: Tone; label: string }> = {
  active: { tone: 'success', label: 'Active' },
  pending: { tone: 'warning', label: 'Pending' },
  inactive: { tone: 'neutral', label: 'Inactive' },
  maintenance: { tone: 'warning', label: 'Maintenance' },
  faulty: { tone: 'error', label: 'Faulty' },
  replaced: { tone: 'neutral', label: 'Replaced' },
  decommissioned: { tone: 'neutral', label: 'Decommissioned' },
  scheduled: { tone: 'info', label: 'Scheduled' },
  in_progress: { tone: 'warning', label: 'In Progress' },
  completed: { tone: 'success', label: 'Completed' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  urgent: { tone: 'error', label: 'Urgent' },
  high: { tone: 'warning', label: 'High' },
  medium: { tone: 'info', label: 'Medium' },
  routine: { tone: 'neutral', label: 'Routine' },
  new: { tone: 'info', label: 'New' },
  contacted: { tone: 'info', label: 'Contacted' },
  qualified: { tone: 'warning', label: 'Qualified' },
  proposal: { tone: 'warning', label: 'Proposal' },
  negotiation: { tone: 'warning', label: 'Negotiation' },
  converted: { tone: 'success', label: 'Converted' },
  lost: { tone: 'neutral', label: 'Lost' },
  confirmed: { tone: 'info', label: 'Confirmed' },
  fulfilled: { tone: 'success', label: 'Fulfilled' },
  in: { tone: 'success', label: 'In stock' },
  low: { tone: 'warning', label: 'Low stock' },
  out: { tone: 'error', label: 'Out of stock' },
  service: { tone: 'neutral', label: 'Service' },
  offline: { tone: 'error', label: 'Offline' },
}

/** Status or priority as a word, never colour alone. Unknown statuses are shown as stored. */
export function StatusBadge({ status }: { status: string }) {
  const known = TONES[status]
  return <Badge tone={known?.tone ?? 'neutral'}>{known?.label ?? status}</Badge>
}

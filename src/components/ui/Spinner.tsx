import { Loader2 } from 'lucide-react'

export function Spinner({ size = 20, label = 'Loading' }: { size?: number; label?: string }) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <Loader2 size={size} className="animate-spin" aria-hidden="true" />
    </span>
  )
}

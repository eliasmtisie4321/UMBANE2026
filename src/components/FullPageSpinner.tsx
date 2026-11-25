import { Spinner } from '@/components/ui'

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-container-low text-primary">
      <Spinner size={32} label={label} />
    </div>
  )
}

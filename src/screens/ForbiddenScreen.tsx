import { ShieldAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Card } from '@/components/ui'

export default function ForbiddenScreen() {
  return (
    <Card className="mx-auto mt-8 max-w-lg text-center">
      <ShieldAlert size={36} className="mx-auto mb-3 text-error" aria-hidden="true" />
      <h1 className="mb-2 text-headline-md font-semibold">You do not have access to this page</h1>
      <p className="mb-4 text-on-surface-variant">
        Your role does not include this area. If you think this is a mistake, contact an
        administrator.
      </p>
      <Link to="/" className="text-label-md font-medium text-secondary hover:text-primary">
        Back to Overview
      </Link>
    </Card>
  )
}

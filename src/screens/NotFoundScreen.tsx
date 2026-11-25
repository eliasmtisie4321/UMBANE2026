import { Link } from 'react-router-dom'
import { Card } from '@/components/ui'

export default function NotFoundScreen() {
  return (
    <Card className="mx-auto mt-8 max-w-lg text-center">
      <h1 className="mb-2 text-headline-md font-semibold">Page not found</h1>
      <p className="mb-4 text-on-surface-variant">The page you are looking for does not exist.</p>
      <Link to="/" className="text-label-md font-medium text-secondary hover:text-primary">
        Back to Overview
      </Link>
    </Card>
  )
}

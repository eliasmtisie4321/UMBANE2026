import { Card } from '@/components/ui'
import { AppLayout } from '@/layouts/AppLayout'

export default function App() {
  return (
    <AppLayout>
      <h1 className="mb-6 text-headline-md font-semibold text-on-surface">Umbane CRM</h1>
      <Card>
        <p className="text-on-surface-variant">
          The foundation is in place. Features arrive phase by phase.
        </p>
      </Card>
    </AppLayout>
  )
}

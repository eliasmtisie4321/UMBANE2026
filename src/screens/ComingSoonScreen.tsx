import { Card } from '@/components/ui'

/** Placeholder for sections that are built in later phases, so every nav link resolves. */
export default function ComingSoonScreen({ title }: { title: string }) {
  return (
    <>
      <h1 className="mb-6 text-headline-md font-semibold text-on-surface">{title}</h1>
      <Card>
        <p className="text-on-surface-variant">This section is coming in a later phase.</p>
      </Card>
    </>
  )
}

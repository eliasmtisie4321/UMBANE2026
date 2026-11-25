import { Badge } from '@/components/ui'
import type { ReadingFlag } from '@/types/meters'
import { FLAG_LABEL } from '@/utils/consumption'

export function EstimateBadge() {
  return <Badge tone="warning">Estimate</Badge>
}

export function FlagBadge({ flag }: { flag: ReadingFlag }) {
  return <Badge tone={flag === 'high' ? 'error' : 'warning'}>{FLAG_LABEL[flag]}</Badge>
}

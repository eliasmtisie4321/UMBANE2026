import { useSearchParams } from 'react-router-dom'
import { businessToday } from '@/utils/consumption'
import { patchParams } from '@/utils/listParams'
import { readRange } from '@/utils/reportRange'

/**
 * A report's period and filters live in the address (?range=last-month&segment=commercial), so a
 * report can be bookmarked or shared and the browser's back button undoes a change.
 */
export function useReportParams() {
  const [params, setParams] = useSearchParams()
  const today = businessToday()
  const { preset, range, problem, entered } = readRange(params, today)
  const filter = (name: string) => params.get(name) ?? ''
  const update = (patch: Record<string, string | undefined>) =>
    setParams(patchParams(params, patch), { replace: true })
  return { today, preset, range, problem, entered, filter, update }
}

export type ReportParams = ReturnType<typeof useReportParams>

import type { AutomationInfo } from '@/types/automations'

/** Whole numbers within each setting's limits, or the reason they are not, by setting name. */
export function settingsProblems(
  info: AutomationInfo,
  values: Record<string, string>,
): Record<string, string> {
  const problems: Record<string, string> = {}
  for (const f of info.fields) {
    const raw = (values[f.name] ?? '').trim()
    const n = Number(raw)
    if (raw === '' || !/^\d+$/.test(raw) || !Number.isInteger(n) || n < f.min || n > f.max) {
      problems[f.name] =
        `Enter a whole number from ${f.min.toLocaleString('en-US')} to ${f.max.toLocaleString('en-US')}.`
    }
  }
  return problems
}

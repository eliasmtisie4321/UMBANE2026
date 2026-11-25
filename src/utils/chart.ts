/** Round the top of an axis up to a tidy number so ticks read 0 / 500 / 1,000 rather than 0 / 437 / 874. */
export function niceMax(max: number, ticks = 4): number {
  if (max <= 0) return 1
  const raw = max / ticks
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw
  return step * ticks
}

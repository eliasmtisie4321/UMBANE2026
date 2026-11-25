import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Table, Td, Th } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { niceMax } from '@/utils/chart'
import { monthLabel } from '@/utils/format'

export interface MonthlyPoint {
  month: string
  total: number
  /** Shown with the value when it needs a caveat, e.g. "Partial: 9 of 30 days". */
  note?: string | null
}

interface MonthlyChartProps {
  points: MonthlyPoint[]
  /** What is measured, e.g. "Revenue". Used in labels and as the table column. */
  measure: string
  /** Caption of the table view. */
  caption: string
  format: (value: number) => string
  formatAxis: (value: number) => string
  /** Show the data as a table instead of the chart. */
  asTable?: boolean
}

const HEIGHT = 240
const MARGIN = { top: 20, right: 28, bottom: 32, left: 56 }
const DEFAULT_WIDTH = 640

function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    // ResizeObserver reports the initial size as soon as it starts observing.
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.round(entries[0].contentRect.width)),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/**
 * Single-series line chart with a light area wash. One series, so no legend: the panel title names
 * it. Hover, touch and arrow keys all move the same crosshair and tooltip; the table view carries
 * every value for anyone who cannot use the chart.
 */
export function MonthlyChart({
  points,
  measure,
  caption,
  format,
  formatAxis,
  asTable = false,
}: MonthlyChartProps) {
  const [wrapRef, measured] = useElementWidth()
  const [active, setActive] = useState<number | null>(null)
  const tooltipId = useId()
  const width = measured > 0 ? measured : DEFAULT_WIDTH

  const hasNotes = points.some((p) => p.note)

  if (asTable) {
    return (
      <Table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <Th>Month</Th>
            <Th className="text-right">{measure}</Th>
            {hasNotes && <Th>Note</Th>}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <Td>{monthLabel(p.month, 'long')}</Td>
              <Td className="text-right">{format(p.total)}</Td>
              {hasNotes && <Td>{p.note ?? '-'}</Td>}
            </tr>
          ))}
        </tbody>
      </Table>
    )
  }

  const plotW = width - MARGIN.left - MARGIN.right
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom
  const top = niceMax(Math.max(...points.map((p) => p.total)))
  const x = (i: number) =>
    MARGIN.left + (points.length === 1 ? plotW / 2 : (plotW * i) / (points.length - 1))
  const y = (v: number) => MARGIN.top + plotH - (v / top) * plotH
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i)

  const line = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`)
    .join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`
  const last = points.length - 1

  // A line falling to its end passes through the space above the dot, so the label goes below it
  // (unless that would run into the month names).
  const labelBelow =
    last > 0 &&
    points[last - 1].total > points[last].total &&
    y(points[last].total) + 26 < HEIGHT - MARGIN.bottom

  const nearest = (clientX: number, left: number) => {
    const rel = clientX - left
    let best = 0
    for (let i = 1; i < points.length; i++) {
      if (Math.abs(x(i) - rel) < Math.abs(x(best) - rel)) best = i
    }
    return best
  }

  const onPointerMove = (e: PointerEvent<SVGRectElement>) =>
    setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect().left))

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const move = (to: number) => {
      e.preventDefault()
      setActive(Math.max(0, Math.min(last, to)))
    }
    if (e.key === 'ArrowRight') move((active ?? -1) + 1)
    else if (e.key === 'ArrowLeft') move((active ?? last + 1) - 1)
    else if (e.key === 'Home') move(0)
    else if (e.key === 'End') move(last)
    else if (e.key === 'Escape') setActive(null)
  }

  const summary = points
    .map((p) => `${monthLabel(p.month)} ${format(p.total)}${p.note ? ` (${p.note})` : ''}`)
    .join(', ')
  const activePoint = active === null ? null : points[active]
  const tooltipLeft = active === null ? 0 : Math.max(70, Math.min(width - 70, x(active)))

  return (
    <div
      ref={wrapRef}
      className="relative outline-offset-4"
      tabIndex={0}
      role="group"
      aria-label={`${measure} by month. Use the left and right arrow keys to read each month.`}
      aria-describedby={activePoint ? tooltipId : undefined}
      onKeyDown={onKeyDown}
      onBlur={() => setActive(null)}
    >
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${measure} by month: ${summary}`}
        className="block"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={MARGIN.left}
              x2={width - MARGIN.right}
              y1={y(t)}
              y2={y(t)}
              className="stroke-outline-variant"
              strokeWidth={1}
            />
            <text
              x={MARGIN.left - 10}
              y={y(t)}
              dy="0.32em"
              textAnchor="end"
              className="fill-on-surface-variant text-[11px] tabular-nums"
            >
              {formatAxis(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) => (
          <text
            key={p.month}
            x={x(i)}
            y={HEIGHT - 10}
            textAnchor="middle"
            className="fill-on-surface-variant text-[11px]"
          >
            {monthLabel(p.month)}
          </text>
        ))}

        <path d={area} className="fill-primary" fillOpacity={0.1} />
        <path
          d={line}
          fill="none"
          className="stroke-primary"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {active !== null && (
          <line
            x1={x(active)}
            x2={x(active)}
            y1={MARGIN.top}
            y2={y(0)}
            className="stroke-outline"
            strokeWidth={1}
          />
        )}
        {/* End marker: 8px+ dot with a 2px surface ring so it stays legible over the line. */}
        <circle
          cx={x(last)}
          cy={y(points[last].total)}
          r={5}
          className="fill-primary stroke-surface"
          strokeWidth={2}
        />
        {active !== null && active !== last && (
          <circle
            cx={x(active)}
            cy={y(points[active].total)}
            r={5}
            className="fill-primary stroke-surface"
            strokeWidth={2}
          />
        )}
        {/* Label the end point only; every other value lives in the tooltip and the table view. */}
        {active === null && (
          <text
            x={x(last)}
            y={y(points[last].total) + (labelBelow ? 22 : -12)}
            textAnchor="end"
            className="fill-on-surface text-[12px] font-semibold tabular-nums"
          >
            {formatAxis(points[last].total)}
          </text>
        )}

        {/* Hit area spans the full plot so the pointer only has to be near a month, not on the line. */}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={onPointerMove}
          onPointerDown={onPointerMove}
          onPointerLeave={() => setActive(null)}
        />
      </svg>

      {activePoint && (
        <div
          id={tooltipId}
          role="status"
          className={cn(
            'pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-outline-variant bg-surface px-3 py-2 shadow-card',
          )}
          style={{ left: tooltipLeft }}
        >
          <p className="text-label-md font-semibold text-on-surface tabular-nums">
            {format(activePoint.total)}
          </p>
          <p className="flex items-center gap-1.5 text-label-sm text-on-surface-variant">
            <span className="inline-block h-0.5 w-3 rounded bg-primary" aria-hidden="true" />
            {monthLabel(activePoint.month, 'long')}
          </p>
          {activePoint.note && (
            <p className="text-label-sm text-on-surface-variant">{activePoint.note}</p>
          )}
        </div>
      )}
    </div>
  )
}

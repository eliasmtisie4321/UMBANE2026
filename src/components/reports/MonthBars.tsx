import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Table, Td, Th } from '@/components/ui'
import { cn } from '@/components/ui/cn'
import { niceMax } from '@/utils/chart'
import { monthLabel } from '@/utils/format'

export interface MonthValues {
  month: string
  values: number[]
}

export interface Series {
  name: string
}

interface MonthBarsProps {
  points: MonthValues[]
  /** One or two series, drawn in the order chart-1, chart-2. */
  series: Series[]
  caption: string
  format: (value: number) => string
  formatAxis: (value: number) => string
  asTable?: boolean
}

const FILL = ['fill-chart-1', 'fill-chart-2']
const SWATCH = ['bg-chart-1', 'bg-chart-2']
const HEIGHT = 240
const MARGIN = { top: 16, right: 12, bottom: 32, left: 56 }
const DEFAULT_WIDTH = 640

function useElementWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) =>
      setWidth(Math.round(entries[0].contentRect.width)),
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** "Mar", with the year on January and on the first month so a long period stays readable. */
const tickLabel = (month: string, i: number) =>
  i === 0 || month.slice(5, 7) === '01'
    ? `${monthLabel(month)} ${month.slice(2, 4)}`
    : monthLabel(month)

/** Bar with a 4px rounded top, square where it meets the baseline. */
function barPath(x: number, y: number, w: number, base: number) {
  const h = base - y
  if (h <= 0) return ''
  const r = Math.min(4, w / 2, h)
  return `M${x},${base} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${base} Z`
}

/**
 * Monthly bars for one or two series side by side (never two scales: both series share one axis).
 * With two series there is a legend; hover, touch and arrow keys show each month's values, and the
 * table view carries every number.
 */
export function MonthBars({
  points,
  series,
  caption,
  format,
  formatAxis,
  asTable,
}: MonthBarsProps) {
  const [wrapRef, measured] = useElementWidth()
  const [active, setActive] = useState<number | null>(null)
  const tooltipId = useId()
  const width = measured > 0 ? measured : DEFAULT_WIDTH

  if (asTable) {
    return (
      <Table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <Th>Month</Th>
            {series.map((s) => (
              <Th key={s.name} className="text-right">
                {s.name}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <Td>{monthLabel(p.month, 'long')}</Td>
              {series.map((s, i) => (
                <Td key={s.name} className="text-right">
                  {format(p.values[i] ?? 0)}
                </Td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
    )
  }

  const plotW = width - MARGIN.left - MARGIN.right
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom
  const base = MARGIN.top + plotH
  const top = niceMax(Math.max(0, ...points.flatMap((p) => p.values)))
  const y = (v: number) => base - (Math.max(0, v) / top) * plotH
  const slot = plotW / Math.max(points.length, 1)
  const groupW = Math.min(slot * 0.7, 48)
  const gap = series.length > 1 ? 2 : 0
  const barW = (groupW - gap * (series.length - 1)) / series.length
  const ticks = [0, 1, 2, 3, 4].map((i) => (top / 4) * i)
  // Leave room between month names: label every nth month when they would collide.
  const every = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 44))))
  const last = points.length - 1

  const nearest = (clientX: number, left: number) =>
    Math.max(0, Math.min(last, Math.floor((clientX - left - MARGIN.left) / slot)))
  const onPointerMove = (e: PointerEvent<SVGRectElement>) =>
    setActive(nearest(e.clientX, e.currentTarget.ownerSVGElement!.getBoundingClientRect().left))
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
    .map(
      (p) =>
        `${monthLabel(p.month, 'long')}: ${series.map((s, i) => `${s.name} ${format(p.values[i] ?? 0)}`).join(', ')}`,
    )
    .join('; ')
  const activePoint = active === null ? null : points[active]
  const tipLeft =
    active === null ? 0 : Math.max(80, Math.min(width - 80, MARGIN.left + slot * (active + 0.5)))

  return (
    <div>
      {series.length > 1 && (
        <ul className="mb-2 flex flex-wrap gap-4 text-label-md text-on-surface-variant">
          {series.map((s, i) => (
            <li key={s.name} className="flex items-center gap-1.5">
              <span
                className={cn('inline-block h-2.5 w-2.5 rounded-sm', SWATCH[i])}
                aria-hidden="true"
              />
              {s.name}
            </li>
          ))}
        </ul>
      )}
      <div
        ref={wrapRef}
        className="relative outline-offset-4"
        tabIndex={0}
        role="group"
        aria-label={`${caption}. Use the left and right arrow keys to read each month.`}
        aria-describedby={activePoint ? tooltipId : undefined}
        onKeyDown={onKeyDown}
        onBlur={() => setActive(null)}
      >
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`${caption}: ${summary}`}
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
          {active !== null && (
            <rect
              x={MARGIN.left + slot * active}
              y={MARGIN.top}
              width={slot}
              height={plotH}
              className="fill-surface-container"
            />
          )}
          {points.map((p, i) => {
            const x0 = MARGIN.left + slot * i + (slot - groupW) / 2
            return (
              <g key={p.month}>
                {series.map((s, si) => (
                  <path
                    key={s.name}
                    d={barPath(x0 + si * (barW + gap), y(p.values[si] ?? 0), barW, base)}
                    className={FILL[si]}
                  />
                ))}
                {i % every === 0 && (
                  <text
                    x={MARGIN.left + slot * (i + 0.5)}
                    y={HEIGHT - 10}
                    textAnchor="middle"
                    className="fill-on-surface-variant text-[11px]"
                  >
                    {tickLabel(p.month, i)}
                  </text>
                )}
              </g>
            )
          })}
          <line
            x1={MARGIN.left}
            x2={width - MARGIN.right}
            y1={base}
            y2={base}
            className="stroke-outline"
            strokeWidth={1}
          />
          {/* The hit area covers the whole plot, so a pointer only has to be near a month. */}
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
            className="pointer-events-none absolute top-0 -translate-x-1/2 rounded-md border border-outline-variant bg-surface px-3 py-2 shadow-card"
            style={{ left: tipLeft }}
          >
            <p className="text-label-md font-semibold text-on-surface">
              {monthLabel(activePoint.month, 'long')}
            </p>
            {series.map((s, i) => (
              <p
                key={s.name}
                className="flex items-center gap-1.5 text-label-sm text-on-surface-variant"
              >
                <span
                  className={cn('inline-block h-2 w-2 rounded-sm', SWATCH[i])}
                  aria-hidden="true"
                />
                {s.name}:{' '}
                <span className="font-semibold text-on-surface tabular-nums">
                  {format(activePoint.values[i] ?? 0)}
                </span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

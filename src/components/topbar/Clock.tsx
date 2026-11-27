import { useEffect, useState } from 'react'

const TIME = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
const DATE = new Intl.DateTimeFormat('en-ZA', {
  timeZone: 'Africa/Johannesburg',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

/**
 * The current South African time and date, in the top bar. It updates on the minute; it is not
 * announced to screen readers each time (it would interrupt), but reads normally when reached.
 */
export function Clock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer = 0
    const schedule = () => {
      // Wake just after the next whole minute, so the clock changes when the minute does.
      timer = window.setTimeout(
        () => {
          setNow(new Date())
          schedule()
        },
        60_000 - (Date.now() % 60_000) + 50,
      )
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [])
  const time = TIME.format(now)
  const date = DATE.format(now)
  return (
    <time
      dateTime={now.toISOString()}
      title="South African time"
      className="hidden shrink-0 flex-col items-end leading-tight sm:flex"
    >
      <span className="text-label-md font-semibold tabular-nums text-on-surface">{time}</span>
      <span className="hidden text-label-sm text-on-surface-variant lg:block">{date}</span>
    </time>
  )
}

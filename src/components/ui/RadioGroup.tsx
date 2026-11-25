import { useId } from 'react'

interface RadioGroupProps<T extends string> {
  legend: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}

/** A labelled set of mutually exclusive choices: a fieldset, so screen readers announce the group. */
export function RadioGroup<T extends string>({
  legend,
  value,
  options,
  onChange,
}: RadioGroupProps<T>) {
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-label-md font-semibold text-on-surface">{legend}</legend>
      <div className="flex flex-wrap gap-3">
        {options.map((o) => (
          <label
            key={o.value}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-outline-variant bg-surface px-3.5 py-2.5 text-body-md has-[:checked]:border-secondary has-[:checked]:bg-primary-container"
          >
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="h-4 w-4 accent-primary"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

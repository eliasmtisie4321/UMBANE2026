# Meters: rules and calculation assumptions

The rules live in the database (`supabase/migrations/20261125000006_meter_management.sql`).
`src/utils/consumption.ts` repeats the reading rules so people see a problem before submitting. If one
changes, change both; their tests use the same figures.

## Readings

A reading is refused when it is:

- below the reading before it, or above the one after it (when backdated);
- dated in the future (South African date), before installation, or after the meter was retired;
- a second reading for the same meter on the same day.

A reading is **flagged, not refused**, when daily use since the previous reading is more than three times,
or less than a fifth of, the meter's average over up to its six previous intervals. It needs at least
three earlier readings. The person recording it must confirm it first. The flag is set when the reading
is saved and is not recalculated if an earlier reading is later added or removed.

Readings cannot be edited. To correct one, a manager or administrator removes it and it is recorded again.

## Consumption

- **Consumption** is the difference between consecutive readings. The first reading has none.
- **Estimates:** a reading can be marked as an estimate. Consumption is labelled an estimate when the
  reading at either end of the interval is one.
- **Per month:** each interval's consumption is spread evenly over its days. A reading on the 10th counts
  use up to the end of the 9th. Months only partly covered by readings are labelled "Partial".
- **Estimated monthly use** is the average daily use over the last three intervals, times 30.
- A chart covers only months with readings. A missing month means "not known", not zero.
- The total across all meters can look low for the latest month until every meter has been read.

## Replacing and decommissioning

Replacing records the old meter's final reading, retires it, registers the new meter on the same property
with its first reading, and adds a completed maintenance record: all of it, or none. Open work orders on
the old meter are cancelled. Consumption never runs across two meters. The final reading may be left empty
when a meter cannot be read; use since its last reading is then unknown.

## Known limits

- **Register rollover** (a mechanical meter passing 99999 and starting again) is not supported: the lower
  reading is refused. Replace the meter record instead.
- Consumption is in kWh only. There is no tariff, so no rand value is shown.
- Prepaid token purchases, live telemetry and photo uploads are not built.

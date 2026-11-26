# Reports

**Reports** in the menu: a summary for the chosen period and eight reports. Managers and administrators
only. Each report is one database function in `supabase/migrations/20261128000013_reports.sql`
(`report_overview`, `report_customers`, `report_properties`, `report_electricity`, `report_sales`,
`report_revenue`, `report_inventory`, `report_support`, `report_team`).

## Periods

- Choose **This month**, **Last month**, **Last 3 months**, **Last 12 months** (the default), **This year**,
  **Last year** or **Custom dates**. The period and filters are kept in the page address, so a report can
  be bookmarked or sent to a colleague, and opening a report from the summary keeps the period.
- Dates are South African calendar dates, and both ends are included. A payment at 23:30 on 31 March
  counts in March, even though it is already 1 April in some other time zones.
- A period can be up to five years long.
- Charts show every month the period touches. When the period starts or ends part-way through a month,
  that month only counts the days inside the period, so the months always add up to the total.
- **On the previous period** compares with the same number of days just before. For March (31 days),
  that is the 31 days ending on the last day of February.

## What the figures mean

Some figures are **for the period** (what happened between the two dates) and some are **as they are
now** (a balance, a stock level, a status). Each report says which.

### Money

- **Invoiced**: invoices issued in the period (by issue date). Drafts and cancelled invoices never count.
- **Payments received / Collected**: payments recorded in the period (by payment date), whichever invoice
  they belong to.
- **Collection rate** (summary): of the amount invoiced in the period, how much has been paid so far.
- **Outstanding now**: the unpaid balance on all issued invoices today.
- **Paid / Unpaid / Overdue** (sales report): the invoices issued in the period, by their status now.
  Unpaid means within its payment terms; overdue means past its due date with a balance.
- **Paid in N days on average**: for invoices issued in the period and now fully paid, the days from the
  issue date to the last payment.
- **Orders**: orders dated in the period, not counting cancelled orders. Values include VAT, as on the
  order.

### Customers and properties

- **Customers / Properties**: those registered by the end of the period. **New** means registered in it.
- Status (active, inactive, pending) is the status now; the system does not keep a status history.
- **Billed / Paid** per customer: invoices issued to them and payments received from them in the period.
  **Balance now** is what they owe today.
- **Last activity**: their most recent invoice, payment or support ticket.

### Electricity

- Use between two readings is spread evenly over the days between them (as on the meter pages), and only
  the days inside the period count. So a reading taken on 10 April still adds the right share to March.
- **Estimated**: the part of the use that comes from an estimated reading (either end of the interval).
- **Readings** lists every reading taken in the period. A meter's first reading has nothing to compare
  with, so its use shows as "First reading".
- **Same period last year** uses the same dates a year earlier.

### Inventory

- Stock value, stock levels, low stock and out of stock are **as they are now** (stock history is in
  **Inventory → History**). Stock value is quantity × cost price; products with stock but no cost price are
  counted separately and add nothing to the value.
- **Units in / out**: stock movements in the period. Receipts and returns are in; sales and downward
  adjustments are out.
- **Fastest-moving**: most units out in the period. **Slowest-moving**: products in stock with the fewest
  units out, then the longest since anything went out.

### Support

- Tickets **opened** in the period, with their status now. **Resolved** counts tickets resolved in the
  period, whenever they were opened.
- **First response** and **Time to resolve** are averages over the tickets opened in the period that have
  had a response or been resolved.
- **Open now**, **urgent** and **not assigned** are as they are now, for all tickets.

### Team

- **Given**: tasks created in the period and assigned to the person (not cancelled). **Finished**: tasks
  they completed in the period.
- **On time**: of the finished tasks that had a due date, the share finished on or before it.
- **Open now**, **Overdue now** and **Field jobs open** (maintenance and installation tasks) are as they
  are now.
- **Tickets resolved**: support tickets assigned to the person and resolved in the period.
- People who have left still appear if they had tasks in the period, marked "no longer active".
  Unassigned tasks are not counted against anyone; the number of open unassigned tasks is shown.

## Filters

Segment, province, property type, property, meter type, payment method, product category, ticket
category and priority, and department. **All** turns a filter off; **Not recorded** finds records where
that detail was never filled in.

## Exports

- **Export CSV**: the report's detail table, every row. Amounts are plain numbers (no "R" or thousands
  separators) and dates are YYYY-MM-DD, so a spreadsheet can add and sort them. Text that a spreadsheet
  could mistake for a formula is written with a leading apostrophe.
- **Export PDF**: the business name, period, filters, who made it and when, then the headline figures, the
  breakdowns and the detail table (up to 2,000 rows; the CSV has the rest).
- A report shows up to 5,000 detail rows; choose a shorter period if it says some are left out.

## How the figures are checked

`npm run test:db` builds known records for February to April 2024 and checks each report's figures to
the cent and kWh, including the period edges (23:30 on the last day, a reading part-way through a month),
cancelled and draft records, every filter, and that another business's records never appear. It then
runs every report over the last five years of all test data and checks the totals against the source
tables: payments, invoices, orders, customers, properties, readings, stock and movements, tickets and
tasks.

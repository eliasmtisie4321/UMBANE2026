# Leads, orders and sales: rules and assumptions

The rules live in the database (`supabase/migrations/20261125000007_sales.sql`). `src/utils/orderMath.ts`
repeats the totals so people see them while typing. If one changes, change both; their tests use the same
figures.

## Leads

- Stages: New, Contacted, Qualified, Proposal, Negotiation, then Converted or Lost.
- A lead is **approved** for conversion from Qualified onwards.
- Marking a lead as lost needs a reason. A lost lead can be reopened; a converted one cannot be undone.
- **Converting** looks for existing customers with the same email, phone (last nine digits) or company.
  - Same email: the lead must be linked to that customer. A second one is never created.
  - Same phone or company only: a person chooses to link, or confirms it is someone new.
- A lead with a company name becomes a business customer, otherwise an individual.

## Orders

- Pending, then Confirmed, then Fulfilled. Pending and Confirmed orders can be Cancelled, with a reason.
- Only a pending order can be edited. Fulfilled and Cancelled are final.
- A line is a catalogue product or a described service. The description and price are kept on the line,
  so later catalogue changes do not alter old orders.
- An order created from a lead can only be for the customer that lead became.
- Order notes are visible to the customer.

## Totals

1. Line total = quantity x unit price. **Prices exclude VAT.**
2. Subtotal = sum of the lines.
3. Discount = a percentage of the subtotal.
4. VAT = 15% (or 0%) of the subtotal after discount.
5. Total = subtotal - discount + VAT.

Each step rounds half a cent up. Totals sent by the browser are ignored.

## Sales

- A sale is recorded when an order is fulfilled, for the amount **excluding VAT**, on that day. It cannot be
  added or changed by hand.
- The Sales chart shows fulfilled orders. The dashboard's Revenue chart shows payments received, including
  VAT. They answer different questions and will not match.

## Known limits

- Stock is not reduced by orders (Phase 7). Invoices and payment status come with Phase 6.
- VAT is always 15% or 0% for the whole order, not per line. There is no setting yet for a business that is
  not VAT registered: choose "No VAT" on each order.
- No file attachments, quotes, or email and SMS sending. No "sales by service" or "top customers" panels.

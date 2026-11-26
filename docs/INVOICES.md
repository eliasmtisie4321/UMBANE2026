# Invoices and payments: rules and assumptions

The rules live in the database (`supabase/migrations/20261126000008_invoices.sql`). The app shows the same
figures while typing, but the database's are the ones that count.

## Life of an invoice

1. **Draft.** It can be edited freely. It has no number, and clients cannot see it.
2. **Issued** ("Unpaid" on screen). Issuing does three things:
   - it gives the invoice the next number, for example `INV-2026-00001`;
   - it sets the issue date (today unless an earlier date is chosen) and the due date from the terms;
   - it locks the invoice.
3. **Partially paid** and **Paid** follow from the payments recorded. Nobody can set them by hand.
4. **Overdue** is not stored. An unpaid or part-paid invoice past its due date shows as overdue.
5. **Cancelled.**
   - Staff can cancel a draft.
   - Only a manager or administrator can cancel an issued invoice, and only once it has no payments.
   - A cancelled invoice keeps its number, which is never reused.

An issued invoice is never edited. To correct one, cancel it and issue a new one.

## Numbers

- Numbering is sequential per business and per calendar year of the issue date, with no gaps. Numbers are
  given out in a single locked step, so two people issuing at once cannot receive the same number.
- Invoices that existed before this change keep their numbers.

## Totals

Totals are worked out the same way as orders (see `docs/SALES.md`):

1. Line totals: quantity x unit price. Prices exclude VAT.
2. The discount comes off the subtotal.
3. VAT at 15% or 0% is added.
4. Each step rounds half a cent up.

A business that is not VAT registered cannot charge VAT. Its documents say "INVOICE"; otherwise they say
"TAX INVOICE".

## Payments

- A payment can only be recorded against an issued invoice that is not fully paid.
- It cannot be more than the balance, dated in the future, or dated before the issue date.
- A payment is never edited. A manager or administrator removes a wrong one and records it again. The
  audit log keeps the removed amount.

## Creating from an order

A confirmed or fulfilled order can be invoiced once. The order's lines, discount and VAT are copied into a
draft, which can be checked before issuing.

## Sending

Sending email or WhatsApp is not connected yet. "Email Customer" opens the person's own mail program with
the message filled in, and the PDF is attached by hand.

## Known limits

- The PDF uses standard fonts. Characters outside Western European alphabets are shown as "?".
- No customer VAT number field yet. SARS requires the recipient's VAT number on tax invoices over R5,000.
- No credit notes, refunds, recurring invoices, reminders, logo or CSV export.
- Clients see payments on their own invoices but cannot pay online.
- **Untested:** two people recording payments on the same invoice at the same moment are made to take
  turns by a database lock. The test database runs one connection at a time, so this cannot be tested.

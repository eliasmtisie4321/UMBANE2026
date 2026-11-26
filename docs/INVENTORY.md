# Inventory: rules and assumptions

The rules live in the database (`supabase/migrations/20261126000009_inventory.sql`).

## Stock on hand

- Every change is a **movement** in an append-only ledger. Nobody can edit or delete one, not even a
  manager. A mistake is corrected with another movement.
- Each movement records the balance after it, so history shows the count before and after.
- The count on the product is kept by the database from the ledger and cannot be edited directly.
- Movements on one product are made one at a time under a lock, so two people cannot both take the last
  unit. **Untested:** the test database runs one connection at a time, so simultaneous movements cannot
  be tested.

## Movements

| Movement | Who records it              | Change          | Notes                                   |
| -------- | --------------------------- | --------------- | --------------------------------------- |
| Received | Staff and above             | Adds            | A delivery; the note can hold the PO    |
| Returned | Staff and above             | Adds            | Units back from a customer              |
| Adjusted | Staff and above             | Adds or removes | A count, damage or loss; needs a reason |
| Sold     | The database, from an order | Removes         | Never recorded by hand                  |

## Negative stock is not allowed

- A movement that would take a product below zero is refused.
- An order cannot be fulfilled while any of its stocked products is short. Nothing changes until enough
  stock has been received.
- This is a business choice. If you deliver before stock is booked in, receive the stock first.

## Orders

- Stock leaves when an order is **fulfilled**. Pending and confirmed orders do not reserve stock.
- Fulfilling records one "sold" movement per product, linked to the order, together with the sale. Both
  happen or neither does.
- Invoices do not move stock. Sell stocked products through orders so the stock stays right.
- A fulfilled order cannot be cancelled. Record returned units as a return.

## Products

- **SKU:** unique per business whatever the case, using letters, numbers, dots, dashes and slashes.
- **Services:** a product can be a service (installation, call-outs). Services are sold but never
  stocked. Stock tracking can only be switched off while the count is zero.
- **Low stock:** a product is low when its count is **at or below** its minimum level, and out of stock
  at zero.
- **Stock value:** units × cost price. Products without a cost price are left out of the value, and the
  page says how many.
- **Deactivating:** a deactivated product disappears from new orders but keeps its history. Products are
  deactivated rather than deleted.

## Not built

- More than one warehouse, transfers between depots, and purchase orders.
- Product images and supplier records.
- Notifications when stock runs low (the Inventory page and the dashboard show alerts).

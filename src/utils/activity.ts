import type { ActivityEntry } from '@/types/dashboard'

const VERB: Record<string, string> = { INSERT: 'created', UPDATE: 'updated', DELETE: 'deleted' }

const OBJECT: Record<string, string> = {
  customers: 'a customer',
  properties: 'a property',
  electricity_meters: 'a meter',
  meter_readings: 'a meter reading',
  meter_maintenance: 'a maintenance work order',
  leads: 'a lead',
  orders: 'an order',
  sales: 'a sale',
  invoice_items: 'an invoice line',
  access_requests: 'an account request',
  profiles: 'a user',
  invoices: 'an invoice',
  payments: 'a payment',
  inventory_transactions: 'a stock movement',
}

/** Turns an audit row into a plain sentence: "Sam Staff created a payment". */
export function describeActivity(entry: ActivityEntry): string {
  const who = entry.actorName ?? 'The system'
  const verb = VERB[entry.action] ?? entry.action.toLowerCase()
  const what =
    (entry.table && OBJECT[entry.table]) ??
    (entry.table ? `a ${entry.table.replace(/_/g, ' ')} record` : 'a record')
  return `${who} ${verb} ${what}`
}

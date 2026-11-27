import { Ban, Download, Pencil, Send, Share2, Trash2, Wallet } from 'lucide-react'
import { useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { canAccess } from '@/auth/permissions'
import { useAuth } from '@/auth/useAuth'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { ConfirmDialog } from '@/components/data/ConfirmDialog'
import { DetailList } from '@/components/data/DetailList'
import { FormError, Notice } from '@/components/data/ListPanel'
import { inlineLink, secondaryLink } from '@/components/data/linkStyles'
import { PageHeader } from '@/components/data/PageHeader'
import { InvoiceStatusBadge } from '@/components/invoices/InvoiceStatusBadge'
import { PaymentDialog } from '@/components/invoices/PaymentDialog'
import { TimelinePanel } from '@/components/sales/ActivityPanels'
import { OrderTotalsList } from '@/components/sales/OrderTotalsList'
import { ReasonDialog } from '@/components/sales/ReasonDialog'
import { Button, Input, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import {
  cancelInvoice,
  getBillingProfile,
  getInvoice,
  getInvoicePayments,
  issueInvoice,
  removePayment,
} from '@/services/invoices'
import { PAYMENT_METHOD_CODES, PAYMENT_TERMS, type Invoice, type Payment } from '@/types/invoices'
import { businessToday } from '@/utils/consumption'
import { formatDate, formatNumber, formatRand } from '@/utils/format'
import { isRealDate } from '@/utils/meterForm'
import { formatPhone } from '@/utils/phone'
import { err, ok } from '@/utils/result'
import type { Result } from '@/types/api'
import { ShareDialog } from '@/components/share/ShareDialog'

const money = (n: number) => formatRand(n, { cents: true })

/** The values an invoice email's placeholders are filled with. */
const emailValues = (i: Invoice) => ({
  invoice_number: i.invoiceNumber,
  invoice_total: money(i.total),
  balance_due: money(i.balance),
  due_date: i.dueDate ? formatDate(i.dueDate) : 'on receipt',
})

/** Builds the same PDF people download, to attach to the email. */
async function invoiceAttachment(
  inv: Invoice,
): Promise<Result<{ bytes: Uint8Array; name: string }>> {
  const [supplier, payments] = await Promise.all([getBillingProfile(), getInvoicePayments(inv.id)])
  if (!supplier.ok) return supplier
  if (!payments.ok) return payments
  try {
    const { buildInvoicePdf } = await import('@/utils/invoicePdf')
    const bytes = await buildInvoicePdf({
      invoice: inv,
      payments: payments.data,
      supplier: supplier.data,
    })
    return ok({ bytes, name: `${inv.invoiceNumber ?? 'invoice'}.pdf` })
  } catch {
    return err({ code: 'unknown', message: 'The PDF could not be made. Please try again.' })
  }
}

function InvoiceBody({
  invoice: inv,
  version,
  onChanged,
}: {
  invoice: Invoice
  version: number
  onChanged: (notice: string) => void
}) {
  const { profile } = useAuth()
  const role = profile?.role ?? 'client'
  const canWrite = canAccess(role, '/invoices/new')
  const isManager = role === 'administrator' || role === 'manager'
  const payments = useResource(() => getInvoicePayments(inv.id), `payments-${inv.id}-${version}`)
  const [dialog, setDialog] = useState<'issue' | 'pay' | 'cancel' | 'email' | null>(null)
  const [removing, setRemoving] = useState<Payment | null>(null)
  const [issueDate, setIssueDate] = useState(businessToday)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pdfError, setPdfError] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)

  const payable = inv.status === 'sent' || inv.status === 'partially_paid'
  const paidSome = inv.paid > 0
  const canCancel = canWrite && (inv.status === 'draft' || (payable && !paidSome && isManager))

  async function issue() {
    if (!isRealDate(issueDate) || issueDate > businessToday()) {
      return setError('Choose an issue date that is today or earlier.')
    }
    setBusy(true)
    setError(null)
    const result = await issueInvoice(inv.id, issueDate)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setDialog(null)
    onChanged('Invoice issued and numbered.')
  }

  async function remove() {
    if (!removing) return
    setBusy(true)
    setError(null)
    const result = await removePayment(removing.id)
    setBusy(false)
    if (!result.ok) return setError(result.error.message)
    setRemoving(null)
    onChanged('Payment removed.')
  }

  async function download() {
    setDownloading(true)
    setPdfError(null)
    // Payments are part of the document, so use the latest; the supplier details are needed too.
    const [supplier, latest] = await Promise.all([
      getBillingProfile(),
      payments.data ? Promise.resolve(ok(payments.data)) : getInvoicePayments(inv.id),
    ])
    if (!supplier.ok || !latest.ok) {
      setDownloading(false)
      return setPdfError(
        (!supplier.ok ? supplier.error : !latest.ok ? latest.error : null)?.message ??
          'The PDF could not be made.',
      )
    }
    try {
      const { downloadInvoicePdf } = await import('@/utils/invoicePdf')
      await downloadInvoicePdf({ invoice: inv, payments: latest.data, supplier: supplier.data })
    } catch {
      setPdfError('The PDF could not be made. Please try again.')
    }
    setDownloading(false)
  }

  return (
    <>
      <PageHeader
        title={inv.reference}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <InvoiceStatusBadge status={inv.displayStatus} />
            <span>{inv.customerName}</span>
          </span>
        }
        back={{ to: '/invoices', label: 'Invoices' }}
        actions={
          <>
            {canCancel && (
              <Button variant="secondary" onClick={() => setDialog('cancel')}>
                <Ban size={16} aria-hidden="true" /> Cancel Invoice
              </Button>
            )}
            {canWrite && inv.status === 'draft' && (
              <>
                <Link to={`/invoices/${inv.id}/edit`} className={secondaryLink}>
                  <Pencil size={16} aria-hidden="true" /> Edit
                </Link>
                <Button
                  onClick={() => {
                    setError(null)
                    setDialog('issue')
                  }}
                >
                  <Send size={16} aria-hidden="true" /> Issue Invoice
                </Button>
              </>
            )}
            {inv.invoiceNumber && (
              <Button variant="secondary" loading={downloading} onClick={() => void download()}>
                <Download size={16} aria-hidden="true" /> Download PDF
              </Button>
            )}
            {canWrite && inv.invoiceNumber && inv.status !== 'cancelled' && (
              <Button variant="secondary" onClick={() => setDialog('email')}>
                <Share2 size={16} aria-hidden="true" /> Share Invoice
              </Button>
            )}
            {canWrite && payable && (
              <Button onClick={() => setDialog('pay')}>
                <Wallet size={16} aria-hidden="true" /> Record Payment
              </Button>
            )}
          </>
        }
      />
      {pdfError && (
        <div className="mb-4">
          <FormError>{pdfError}</FormError>
        </div>
      )}
      {inv.status === 'cancelled' && (
        <p className="mb-4 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
          Cancelled: {inv.cancelReason}
        </p>
      )}
      {inv.status === 'draft' && (
        <p className="mb-4 rounded-md bg-surface-container px-4 py-3 text-body-md text-on-surface">
          This is a draft. It can be changed until it is issued; issuing gives it a number and locks
          it.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel title="Bill to">
          <p className="text-body-md font-semibold text-on-surface">
            {canAccess(role, '/customers') ? (
              <Link to={`/customers/${inv.customerId}`} className={inlineLink}>
                {inv.billTo.companyName ?? inv.billTo.name}
              </Link>
            ) : (
              (inv.billTo.companyName ?? inv.billTo.name)
            )}
          </p>
          {inv.billTo.companyName && (
            <p className="text-body-md text-on-surface">Attn: {inv.billTo.name}</p>
          )}
          {inv.billTo.address.map((l) => (
            <p key={l} className="text-body-md text-on-surface-variant">
              {l}
            </p>
          ))}
          {(inv.billTo.email || inv.billTo.phone) && (
            <p className="mt-1 text-body-md text-on-surface-variant">
              {[inv.billTo.email, inv.billTo.phone && formatPhone(inv.billTo.phone)]
                .filter(Boolean)
                .join(' · ')}
            </p>
          )}
        </Panel>
        <Panel title="Invoice details">
          <DetailList
            items={[
              { label: 'Issue date', value: inv.issueDate ? formatDate(inv.issueDate) : null },
              {
                label: 'Due date',
                value: inv.dueDate
                  ? formatDate(inv.dueDate)
                  : inv.status === 'draft'
                    ? 'Set when issued'
                    : null,
              },
              {
                label: 'Terms',
                value: PAYMENT_TERMS.find((t) => t.value === inv.paymentTerms)?.label,
              },
              {
                label: 'Order',
                value: inv.orderId && inv.orderReference && (
                  <Link to={`/sales-orders/${inv.orderId}`} className={inlineLink}>
                    {inv.orderReference}
                  </Link>
                ),
              },
              { label: 'Property', value: inv.propertyName },
            ]}
          />
          {inv.notes && (
            <p className="mt-4 whitespace-pre-wrap border-t border-outline-variant pt-4 text-body-md text-on-surface">
              {inv.notes}
            </p>
          )}
        </Panel>

        <Panel title="Products and services" className="lg:col-span-2">
          <Table>
            <caption className="sr-only">Invoice lines</caption>
            <thead>
              <tr>
                <Th>Description</Th>
                <Th className="text-right">Quantity</Th>
                <Th className="text-right">Unit price</Th>
                <Th className="text-right">Amount</Th>
              </tr>
            </thead>
            <tbody>
              {inv.items.map((i) => (
                <tr key={i.id}>
                  <Td>{i.description}</Td>
                  <Td className="text-right">{formatNumber(i.quantity)}</Td>
                  <Td className="whitespace-nowrap text-right">{money(i.unitPrice)}</Td>
                  <Td className="whitespace-nowrap text-right">
                    {money(Math.round(i.quantity * i.unitPrice * 100) / 100)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-4 ml-auto max-w-sm">
            <OrderTotalsList
              totals={inv}
              discountPercent={inv.discountPercent}
              vatRate={inv.vatRate}
            />
            {inv.status !== 'draft' && inv.status !== 'cancelled' && (
              <dl className="mt-2 flex flex-col gap-2 border-t border-outline-variant pt-2">
                <div className="flex justify-between gap-4">
                  <dt className="text-body-md text-on-surface-variant">Paid</dt>
                  <dd className="text-body-md tabular-nums">{money(inv.paid)}</dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-title-md font-semibold">Balance due</dt>
                  <dd className="text-title-md font-bold tabular-nums">{money(inv.balance)}</dd>
                </div>
              </dl>
            )}
          </div>
        </Panel>

        {inv.status !== 'draft' && (
          <Panel title="Payments" className={canWrite ? undefined : 'lg:col-span-2'}>
            <ResourceBoundary
              state={payments}
              isEmpty={(rows) => rows.length === 0}
              empty="No payments have been received for this invoice."
            >
              {(rows) => (
                <ul className="divide-y divide-outline-variant">
                  {rows.map((p) => (
                    <li key={p.id} className="flex items-start justify-between gap-3 py-3">
                      <div>
                        <p className="text-body-md font-medium text-on-surface">
                          {money(p.amount)}{' '}
                          <span className="font-normal text-on-surface-variant">
                            ·{' '}
                            {PAYMENT_METHOD_CODES.find((m) => m.value === p.method)?.label ??
                              p.method}
                          </span>
                        </p>
                        <p className="text-label-md text-on-surface-variant">
                          {[
                            formatDate(p.paidOn),
                            p.referenceNumber,
                            p.reference,
                            canWrite ? p.recordedByName : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                      {canWrite && isManager && (
                        <button
                          type="button"
                          aria-label={`Remove payment ${p.referenceNumber}`}
                          onClick={() => {
                            setError(null)
                            setRemoving(p)
                          }}
                          className="rounded-md p-2 text-on-surface-variant hover:bg-surface-container hover:text-error"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </ResourceBoundary>
          </Panel>
        )}
        {canWrite && <TimelinePanel subject={{ invoiceId: inv.id }} version={version} />}
      </div>

      {dialog === 'issue' && (
        <ConfirmDialog
          open
          title="Issue this invoice?"
          confirmLabel="Issue invoice"
          busy={busy}
          error={error}
          onConfirm={() => void issue()}
          onCancel={() => setDialog(null)}
        >
          <p className="mb-4">
            It gets the next invoice number and can no longer be changed. Total:{' '}
            <strong>{money(inv.total)}</strong>.
          </p>
          <Input
            id="issue-date"
            label="Issue date"
            type="date"
            max={businessToday()}
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
          />
        </ConfirmDialog>
      )}
      {dialog === 'email' && (
        <ShareDialog
          context={{
            title: `Share invoice ${inv.invoiceNumber}`,
            customer: { id: inv.customerId, name: inv.billTo.name },
            allowTeam: true,
            allowAddress: true,
            templateKey: inv.isOverdue ? 'payment_reminder' : 'invoice_issued',
            values: emailValues(inv),
            invoiceId: inv.id,
            attachment: {
              label: `the invoice PDF (${inv.invoiceNumber}.pdf)`,
              build: () => invoiceAttachment(inv),
            },
          }}
          onClose={() => setDialog(null)}
          onDone={(notice) => {
            setDialog(null)
            onChanged(notice)
          }}
        />
      )}
      {dialog === 'pay' && (
        <PaymentDialog
          invoice={inv}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null)
            onChanged('Payment recorded.')
          }}
        />
      )}
      {dialog === 'cancel' && (
        <ReasonDialog
          title="Cancel this invoice?"
          description={
            inv.status === 'draft'
              ? 'The draft is kept for the record but can no longer be issued.'
              : 'Its number stays used and the invoice stays on record as cancelled. This cannot be undone.'
          }
          confirmLabel="Cancel invoice"
          submit={(reason) => cancelInvoice(inv.id, reason)}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null)
            onChanged('Invoice cancelled.')
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title="Remove this payment?"
        confirmLabel="Remove payment"
        danger
        busy={busy}
        error={error}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      >
        {removing && (
          <p>
            {money(removing.amount)} received on {formatDate(removing.paidOn)} will be removed and
            the balance increased. The removal is kept in the audit log.
          </p>
        )}
      </ConfirmDialog>
    </>
  )
}

export default function InvoiceDetailScreen() {
  const { id = '' } = useParams()
  return <InvoiceDetail key={id} id={id} />
}

function InvoiceDetail({ id }: { id: string }) {
  const location = useLocation()
  const [notice, setNotice] = useState<string | null>(
    (location.state as { notice?: string } | null)?.notice ?? null,
  )
  const [version, setVersion] = useState(0)
  const state = useResource(() => getInvoice(id), `invoice-${id}`)
  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={state} skeletonLines={6}>
        {(invoice) => (
          <InvoiceBody
            invoice={invoice}
            version={version}
            onChanged={(text) => {
              setNotice(text)
              setVersion((v) => v + 1)
              state.reload()
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}

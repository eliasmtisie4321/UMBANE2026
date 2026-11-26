import { useState, type FormEvent } from 'react'
import { Panel, ResourceBoundary } from '@/components/dashboard/Panel'
import { FormError, Notice } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { Button, Input, Table, Td, Th } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import type { Result } from '@/types/api'
import {
  addProductCategory,
  addTicketCategory,
  deleteProductCategory,
  deleteTicketCategory,
  listProductCategoryRecords,
  listTicketCategories,
  updateProductCategory,
  updateTicketCategory,
} from '@/services/settings'

interface Item {
  id: string
  name: string
  isActive: boolean
  /** Shown under the name, e.g. the stored key. */
  note?: string
}

interface ListProps {
  title: string
  subtitle: string
  noun: string
  items: Item[]
  onAdd: (name: string) => Promise<Result<null>>
  onRename: (id: string, name: string) => Promise<Result<null>>
  onToggle: (id: string, active: boolean) => Promise<Result<null>>
  onDelete: (id: string) => Promise<Result<null>>
  onChanged: () => void
}

/** Add, rename, switch off and delete categories. Problems come back from the database in words. */
function CategoryList({
  title,
  subtitle,
  noun,
  items,
  onAdd,
  onRename,
  onToggle,
  onDelete,
  onChanged,
}: ListProps) {
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(key: string, run: () => Promise<Result<null>>, done: string) {
    setBusy(key)
    setError(null)
    setNotice(null)
    const result = await run()
    setBusy(null)
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    setNotice(done)
    onChanged()
    return true
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const n = name.trim()
    if (n.length < 2 || n.length > 60) return setNameError('Use 2 to 60 characters.')
    if (items.some((i) => i.name.toLowerCase() === n.toLowerCase())) {
      return setNameError(`There is already a ${noun} with this name.`)
    }
    setNameError(null)
    if (await act('add', () => onAdd(n), `“${n}” added.`)) setName('')
  }

  async function rename(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const n = editing.name.trim()
    if (n.length < 2 || n.length > 60) return setError('Use 2 to 60 characters.')
    if (await act(editing.id, () => onRename(editing.id, n), `Renamed to “${n}”.`)) setEditing(null)
  }

  return (
    <Panel title={title} subtitle={subtitle}>
      {notice && <Notice>{notice}</Notice>}
      {error && (
        <div className="mb-3">
          <FormError>{error}</FormError>
        </div>
      )}
      <Table>
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            <Th>Name</Th>
            <Th>Status</Th>
            <Th className="text-right">Actions</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.id}>
              <Td className="min-w-48">
                {editing?.id === i.id ? (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => void rename(e)}>
                    <div className="w-56">
                      <Input
                        id={`rename-${i.id}`}
                        label={`New name for ${i.name}`}
                        value={editing.name}
                        onChange={(e) => setEditing({ id: i.id, name: e.target.value })}
                      />
                    </div>
                    <Button type="submit" className="px-3 py-1.5" loading={busy === i.id}>
                      Save
                    </Button>
                    <Button
                      variant="ghost"
                      className="px-3 py-1.5"
                      onClick={() => setEditing(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <span className="block font-medium text-on-surface">{i.name}</span>
                    {i.note && (
                      <span className="block text-label-md text-on-surface-variant">{i.note}</span>
                    )}
                  </>
                )}
              </Td>
              <Td className="whitespace-nowrap">{i.isActive ? 'In use' : 'Switched off'}</Td>
              <Td className="whitespace-nowrap text-right">
                <div className="inline-flex flex-nowrap justify-end gap-1">
                  <Button
                    variant="ghost"
                    className="px-2 py-1"
                    onClick={() => setEditing({ id: i.id, name: i.name })}
                    aria-label={`Rename ${i.name}`}
                  >
                    Rename
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1"
                    loading={busy === `toggle-${i.id}`}
                    onClick={() =>
                      void act(
                        `toggle-${i.id}`,
                        () => onToggle(i.id, !i.isActive),
                        `“${i.name}” ${i.isActive ? 'switched off' : 'switched on'}.`,
                      )
                    }
                    aria-label={`${i.isActive ? 'Switch off' : 'Switch on'} ${i.name}`}
                  >
                    {i.isActive ? 'Switch off' : 'Switch on'}
                  </Button>
                  <Button
                    variant="ghost"
                    className="px-2 py-1 text-error"
                    loading={busy === `delete-${i.id}`}
                    onClick={() =>
                      void act(`delete-${i.id}`, () => onDelete(i.id), `“${i.name}” deleted.`)
                    }
                    aria-label={`Delete ${i.name}`}
                  >
                    Delete
                  </Button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(e) => void add(e)}>
        <div className="w-72">
          <Input
            id={`new-${noun.replace(/\s+/g, '-')}`}
            label={`New ${noun}`}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              setNameError(null)
            }}
            error={nameError ?? undefined}
          />
        </div>
        <Button type="submit" variant="secondary" loading={busy === 'add'}>
          Add
        </Button>
      </form>
      <p className="mt-3 text-label-md text-on-surface-variant">
        A {noun} in use cannot be deleted; switch it off instead. Switched-off ones stay on existing
        records but cannot be chosen for new ones.
      </p>
    </Panel>
  )
}

/** Ticket and product categories, managed by managers and administrators. */
export default function CategoriesScreen() {
  const [version, setVersion] = useState(0)
  const tickets = useResource(() => listTicketCategories(), `ticket-categories-${version}`)
  const products = useResource(() => listProductCategoryRecords(), `product-categories-${version}`)
  const reload = () => setVersion((v) => v + 1)
  const nextPosition = Math.max(0, ...(tickets.data ?? []).map((c) => c.position)) + 10
  return (
    <>
      <PageHeader
        title="Categories"
        subtitle="The lists people choose from when they open a support ticket or add a product."
        back={{ to: '/settings', label: 'Settings' }}
      />
      <div className="grid grid-cols-1 gap-6">
        <ResourceBoundary state={tickets} skeletonLines={6}>
          {(rows) => (
            <CategoryList
              title="Ticket categories"
              subtitle="Customers and the team choose one when opening a ticket."
              noun="ticket category"
              items={rows.map((c) => ({ id: c.id, name: c.label, isActive: c.isActive }))}
              onAdd={(n) => addTicketCategory(n, Math.min(nextPosition, 1000))}
              onRename={(id, n) => updateTicketCategory(id, { label: n })}
              onToggle={(id, active) => updateTicketCategory(id, { isActive: active })}
              onDelete={deleteTicketCategory}
              onChanged={reload}
            />
          )}
        </ResourceBoundary>
        <ResourceBoundary state={products} skeletonLines={6}>
          {(rows) => (
            <CategoryList
              title="Product categories"
              subtitle="Group products in Inventory and the inventory report. Renaming renames it on every product."
              noun="product category"
              items={rows.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive }))}
              onAdd={addProductCategory}
              onRename={(id, n) => updateProductCategory(id, { name: n })}
              onToggle={(id, active) => updateProductCategory(id, { isActive: active })}
              onDelete={deleteProductCategory}
              onChanged={reload}
            />
          )}
        </ResourceBoundary>
      </div>
    </>
  )
}

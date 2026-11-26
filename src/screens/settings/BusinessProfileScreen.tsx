import { useState, type FormEvent } from 'react'
import { useAuth } from '@/auth/useAuth'
import { ResourceBoundary } from '@/components/dashboard/Panel'
import { FormSection } from '@/components/data/FormSection'
import { FormError, Notice } from '@/components/data/ListPanel'
import { PageHeader } from '@/components/data/PageHeader'
import { Button, Input, Select, Textarea } from '@/components/ui'
import { useResource } from '@/hooks/useResource'
import { getBusinessProfile, saveBusinessProfile } from '@/services/settings'
import { PROVINCES } from '@/types/customers'
import type { BusinessProfile } from '@/types/settings'
import { validateBusiness, type BusinessErrors } from '@/utils/settingsForm'

function ProfileForm({
  initial,
  readOnly,
  onSaved,
}: {
  initial: BusinessProfile
  readOnly: boolean
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const [values, setValues] = useState(initial)
  const [errors, setErrors] = useState<BusinessErrors>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (key: keyof BusinessProfile, value: string) => {
    setValues((v) => ({ ...v, [key]: value }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }
  const text = (key: keyof BusinessProfile) => values[key] ?? ''

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!profile) return
    const found = validateBusiness(values)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setSaving(true)
    setServerError(null)
    const result = await saveBusinessProfile(profile.business_id, values)
    setSaving(false)
    if (!result.ok) {
      if (result.error.field) setErrors({ [result.error.field]: result.error.message })
      else setServerError(result.error.message)
      return
    }
    onSaved()
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="space-y-6">
      {serverError && <FormError>{serverError}</FormError>}
      <FormSection title="Business" description="How the business is named and described.">
        <Input
          id="business-name"
          label="Business name"
          value={text('name')}
          readOnly={readOnly}
          onChange={(e) => set('name', e.target.value)}
          error={errors.name}
        />
        <Textarea
          id="business-description"
          label="Description (optional)"
          rows={3}
          value={text('description')}
          readOnly={readOnly}
          onChange={(e) => set('description', e.target.value)}
          error={errors.description}
          hint="What the business does, in a sentence or two."
        />
      </FormSection>
      <FormSection title="Contact" description="Shown on invoices and in emails.">
        <Input
          id="business-email"
          label="Email address"
          type="email"
          value={text('email')}
          readOnly={readOnly}
          onChange={(e) => set('email', e.target.value)}
          error={errors.email}
        />
        <Input
          id="business-phone"
          label="Phone number"
          value={text('phone')}
          readOnly={readOnly}
          onChange={(e) => set('phone', e.target.value)}
          error={errors.phone}
        />
        <Input
          id="business-website"
          label="Website (optional)"
          placeholder="https://"
          value={text('website')}
          readOnly={readOnly}
          onChange={(e) => set('website', e.target.value)}
          error={errors.website}
        />
      </FormSection>
      <FormSection title="Address" description="The business's registered or main office address.">
        <Textarea
          id="business-address"
          label="Street address"
          rows={2}
          value={text('address')}
          readOnly={readOnly}
          onChange={(e) => set('address', e.target.value)}
          error={errors.address}
        />
        <Input
          id="business-city"
          label="City"
          value={text('city')}
          readOnly={readOnly}
          onChange={(e) => set('city', e.target.value)}
          error={errors.city}
        />
        <Select
          id="business-province"
          label="Province"
          value={text('province')}
          disabled={readOnly}
          onChange={(e) => set('province', e.target.value)}
          error={errors.province}
          options={[
            { value: '', label: 'Choose a province' },
            ...PROVINCES.map((p) => ({ value: p, label: p })),
          ]}
        />
        <Input
          id="business-postal-code"
          label="Postal code"
          inputMode="numeric"
          value={text('postalCode')}
          readOnly={readOnly}
          onChange={(e) => set('postalCode', e.target.value)}
          error={errors.postalCode}
        />
      </FormSection>
      {!readOnly && (
        <div className="flex gap-3">
          <Button type="submit" loading={saving}>
            Save Changes
          </Button>
        </div>
      )}
    </form>
  )
}

/** The business's own details. Administrators edit; managers see them. */
export default function BusinessProfileScreen() {
  const { profile } = useAuth()
  const [version, setVersion] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const state = useResource(() => getBusinessProfile(), `business-profile-${version}`)
  const readOnly = profile?.role !== 'administrator'
  return (
    <>
      <PageHeader
        title="Business profile"
        subtitle={
          readOnly
            ? 'Only an administrator can change these details.'
            : 'Your business’s name, contact details and address. Tax and bank details are under Invoice and tax settings.'
        }
        back={{ to: '/settings', label: 'Settings' }}
      />
      {notice && <Notice>{notice}</Notice>}
      <ResourceBoundary state={state} skeletonLines={8}>
        {(p) => (
          <ProfileForm
            key={version}
            initial={p}
            readOnly={readOnly}
            onSaved={() => {
              setNotice('Business profile saved.')
              setVersion((v) => v + 1)
            }}
          />
        )}
      </ResourceBoundary>
    </>
  )
}

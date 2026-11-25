import { describe, expect, it } from 'vitest'
import { meterFixture } from '@/test/fixtures'
import {
  emptyMaintenanceForm,
  emptyMeterForm,
  isRealDate,
  meterToForm,
  parseKwh,
  toMeterUpdate,
  toNewMeter,
  toRetireInput,
  validateMaintenanceForm,
  validateMeterForm,
  validateRetireForm,
  type MeterFormValues,
  type RetireFormValues,
} from './meterForm'

const TODAY = '2026-11-25'
const good: MeterFormValues = {
  ...emptyMeterForm,
  propertyId: 'p1',
  serialNumber: ' MTR-ZA-88412 ',
  meterType: 'smart_prepaid',
  category: 'residential_sub',
  installedOn: '2026-11-25',
  initialReading: '12.5',
}

describe('parseKwh', () => {
  it.each([
    ['0', 0],
    ['14850.5', 14850.5],
    [' 14 850.125 ', 14850.125],
  ])('accepts %j', (text, value) => expect(parseKwh(text)).toBe(value))

  it.each(['', '-5', '1,500', '1.2345', 'abc', '1e5', '12.', '.5', '123456789012'])(
    'refuses %j',
    (text) => expect(parseKwh(text)).toBeNull(),
  )
})

describe('isRealDate', () => {
  it('accepts real dates only', () => {
    expect(isRealDate('2028-02-29')).toBe(true)
    for (const bad of ['2026-02-29', '2026-13-01', '25/11/2026', '', '2026-1-1'])
      expect(isRealDate(bad)).toBe(false)
  })
})

describe('meter form', () => {
  it('accepts a complete form, including installation today', () => {
    expect(validateMeterForm(good, 'create', TODAY)).toEqual({})
  })

  it('reports every missing required field', () => {
    expect(Object.keys(validateMeterForm(emptyMeterForm, 'create', TODAY)).sort()).toEqual(
      [
        'category',
        'initialReading',
        'installedOn',
        'meterType',
        'propertyId',
        'serialNumber',
      ].sort(),
    )
  })

  it('refuses a future installation and a bad serial', () => {
    const e = validateMeterForm(
      { ...good, installedOn: '2026-11-26', serialNumber: 'A!' },
      'create',
      TODAY,
    )
    expect(e.installedOn).toMatch(/future/)
    expect(e.serialNumber).toMatch(/3 to 40/)
  })

  it('does not ask for the initial reading when editing', () => {
    expect(validateMeterForm({ ...good, initialReading: '' }, 'edit', TODAY)).toEqual({})
  })

  it('trims and converts for saving', () => {
    expect(toNewMeter({ ...good, location: ' Kitchen ' })).toMatchObject({
      serialNumber: 'MTR-ZA-88412',
      initialReading: 12.5,
      location: 'Kitchen',
      installerName: null,
    })
  })

  it('never sends a status for a retired meter', () => {
    const form = meterToForm(meterFixture({ status: 'replaced', retiredOn: '2026-11-01' }))
    expect(toMeterUpdate(form, true).status).toBeNull()
    expect(toMeterUpdate(meterToForm(meterFixture({ status: 'faulty' })), false).status).toBe(
      'faulty',
    )
  })
})

describe('retire form', () => {
  const v: RetireFormValues = {
    action: 'replace',
    retiredOn: TODAY,
    finalReading: '',
    newSerialNumber: 'MTR-2',
    newInitialReading: '0',
    reason: 'Faulty display',
  }
  it('needs a serial number and first reading only when replacing', () => {
    const blank = { ...v, newSerialNumber: '', newInitialReading: '' }
    expect(Object.keys(validateRetireForm(blank, TODAY)).sort()).toEqual([
      'newInitialReading',
      'newSerialNumber',
    ])
    expect(validateRetireForm({ ...blank, action: 'decommission' }, TODAY)).toEqual({})
  })

  it('checks the date, final reading and reason', () => {
    const e = validateRetireForm(
      { ...v, retiredOn: '2026-11-26', finalReading: '1,800', reason: ' ' },
      TODAY,
    )
    expect(Object.keys(e).sort()).toEqual(['finalReading', 'reason', 'retiredOn'])
  })

  it('drops the new meter when decommissioning, and treats a blank final reading as unknown', () => {
    expect(toRetireInput({ ...v, action: 'decommission' })).toMatchObject({
      newSerialNumber: '',
      finalReading: null,
    })
    // Zero is a real reading, not a blank.
    expect(toRetireInput({ ...v, finalReading: '0' }).finalReading).toBe(0)
  })
})

describe('maintenance form', () => {
  const v = { ...emptyMaintenanceForm, issue: 'Seal check', scheduledFor: '2026-12-01' }
  it('needs a date when scheduled and an outcome when completed', () => {
    expect(validateMaintenanceForm(v)).toEqual({})
    expect(validateMaintenanceForm({ ...v, scheduledFor: '' }).scheduledFor).toBeTruthy()
    expect(validateMaintenanceForm({ ...v, scheduledFor: '', status: 'pending' })).toEqual({})
    expect(validateMaintenanceForm({ ...v, status: 'completed' }).outcome).toBeTruthy()
    expect(validateMaintenanceForm({ ...v, status: 'completed', outcome: 'Done' })).toEqual({})
    expect(validateMaintenanceForm({ ...v, issue: ' ' }).issue).toBeTruthy()
  })
})

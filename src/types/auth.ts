export type UserRole = 'administrator' | 'manager' | 'staff' | 'client'

export interface Profile {
  id: string
  business_id: string
  role: UserRole
  full_name: string
  email: string | null
  is_active: boolean
}

export const ROLE_LABEL: Record<UserRole, string> = {
  administrator: 'Administrator',
  manager: 'Manager',
  staff: 'Staff',
  client: 'Client',
}

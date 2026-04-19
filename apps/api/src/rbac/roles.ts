import { Role } from '@spa/shared';

export const Permissions = {
  CycleOpen: 'cycle.open',
  KraDraft: 'kra.draft',
  KraSubmit: 'kra.submit',
  KraApprove: 'kra.approve',
  KraReject: 'kra.reject',
  StaffReadSelf: 'staff.read.self',
  StaffReadReport: 'staff.read.report',
  StaffReadDept: 'staff.read.dept',
  StaffReadOrg: 'staff.read.org',
  UserManage: 'user.manage',
  AuditRead: 'audit.read',
} as const;
export type Permission = (typeof Permissions)[keyof typeof Permissions];

export const rolePermissions: Record<Role, Permission[]> = {
  staff: ['staff.read.self', 'kra.draft', 'kra.submit'],
  appraiser: ['staff.read.self', 'staff.read.report', 'kra.approve', 'kra.reject', 'kra.draft', 'kra.submit'],
  next_level: ['staff.read.self', 'staff.read.report'],
  department_head: ['staff.read.dept'],
  hr_manager: ['staff.read.org', 'audit.read'],
  hra: ['staff.read.org', 'cycle.open', 'audit.read'],
  it_admin: ['user.manage', 'audit.read'],
};

export function hasPermission(roles: Role[], perm: Permission): boolean {
  for (const r of roles) {
    if (rolePermissions[r]?.includes(perm)) return true;
  }
  return false;
}

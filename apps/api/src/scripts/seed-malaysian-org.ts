#!/usr/bin/env bun
/**
 * Seed the production database with a realistic Malaysian-named organization.
 *
 * Run once: `HRA_EMAIL=... HRA_PASSWORD=... bun apps/api/src/scripts/seed-malaysian-org.ts`
 *
 * Creates:
 *  - 1 organization (Invenio Potential Sdn. Bhd.)
 *  - 5 departments (Executive, Operations, Finance, IT, HR)
 *  - 6 grades (E07–E12)
 *  - ~40 staff across a CEO → VP → Manager → IC reporting tree
 *  - HRA_EMAIL as the CEO with roles [hra, hr_manager, it_admin]
 *    and a working password (sign-in immediately)
 *  - All other staff have user rows but no password — they use
 *    "forgot password" flow to set one on first use.
 *
 * Idempotent: wipes existing data before inserting. DO NOT run in a DB with
 * real records you care about.
 */

import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import { auth } from '../auth/better-auth';
import { db } from '../db/client';
import * as s from '../db/schema';

const HRA_EMAIL = process.env.HRA_EMAIL;
const HRA_NAME = process.env.HRA_NAME ?? 'Daisy Yadiski';
const HRA_PASSWORD = process.env.HRA_PASSWORD;

if (!HRA_EMAIL || !HRA_PASSWORD) {
  console.error('Set HRA_EMAIL and HRA_PASSWORD env vars before running.');
  process.exit(1);
}

type Employee = {
  no: string;
  name: string;
  email: string;
  designation: string;
  departmentCode: string;
  gradeCode: string;
  managerNo: string | null;
  roles: Array<
    'staff' | 'appraiser' | 'next_level' | 'department_head' | 'hr_manager' | 'hra' | 'it_admin'
  >;
};

// Mix of Malay, Chinese-Malaysian, and Indian-Malaysian names matching
// actual Malaysian corporate demographics.
const STAFF: Employee[] = [
  // CEO
  {
    no: 'E0001',
    name: HRA_NAME,
    email: HRA_EMAIL,
    designation: 'Chief Executive Officer',
    departmentCode: 'EXEC',
    gradeCode: 'E12',
    managerNo: null,
    roles: ['hra', 'hr_manager', 'it_admin'],
  },

  // VPs
  {
    no: 'E0101',
    name: 'Muhammad Farid bin Abdullah',
    email: 'farid.abdullah@yadiski.my',
    designation: 'VP, Operations',
    departmentCode: 'OPS',
    gradeCode: 'E11',
    managerNo: 'E0001',
    roles: ['appraiser', 'next_level', 'department_head'],
  },
  {
    no: 'E0102',
    name: 'Tan Wei Ming',
    email: 'weiming.tan@yadiski.my',
    designation: 'VP, Finance',
    departmentCode: 'FIN',
    gradeCode: 'E11',
    managerNo: 'E0001',
    roles: ['appraiser', 'next_level', 'department_head'],
  },
  {
    no: 'E0103',
    name: 'Priya Raj',
    email: 'priya.raj@yadiski.my',
    designation: 'VP, Information Technology',
    departmentCode: 'IT',
    gradeCode: 'E11',
    managerNo: 'E0001',
    roles: ['appraiser', 'next_level', 'department_head'],
  },
  {
    no: 'E0104',
    name: 'Nurul Huda binti Ismail',
    email: 'nurulhuda.ismail@yadiski.my',
    designation: 'VP, Human Resources',
    departmentCode: 'HR',
    gradeCode: 'E11',
    managerNo: 'E0001',
    roles: ['appraiser', 'next_level', 'department_head', 'hr_manager'],
  },

  // Operations — managers + ICs
  {
    no: 'E0201',
    name: 'Siti Nurhaliza binti Ibrahim',
    email: 'siti.ibrahim@yadiski.my',
    designation: 'Manager, Logistics',
    departmentCode: 'OPS',
    gradeCode: 'E09',
    managerNo: 'E0101',
    roles: ['appraiser'],
  },
  {
    no: 'E0202',
    name: 'Khalid bin Osman',
    email: 'khalid.osman@yadiski.my',
    designation: 'Manager, Procurement',
    departmentCode: 'OPS',
    gradeCode: 'E09',
    managerNo: 'E0101',
    roles: ['appraiser'],
  },
  {
    no: 'E0203',
    name: 'Anand Krishnan',
    email: 'anand.krishnan@yadiski.my',
    designation: 'Logistics Analyst',
    departmentCode: 'OPS',
    gradeCode: 'E08',
    managerNo: 'E0201',
    roles: ['staff'],
  },
  {
    no: 'E0204',
    name: 'Lee Siew Yin',
    email: 'siewyin.lee@yadiski.my',
    designation: 'Operations Executive',
    departmentCode: 'OPS',
    gradeCode: 'E07',
    managerNo: 'E0201',
    roles: ['staff'],
  },
  {
    no: 'E0205',
    name: 'Nur Aisyah binti Kamal',
    email: 'aisyah.kamal@yadiski.my',
    designation: 'Operations Executive',
    departmentCode: 'OPS',
    gradeCode: 'E07',
    managerNo: 'E0201',
    roles: ['staff'],
  },
  {
    no: 'E0206',
    name: 'Rajesh Kumar',
    email: 'rajesh.kumar@yadiski.my',
    designation: 'Procurement Analyst',
    departmentCode: 'OPS',
    gradeCode: 'E08',
    managerNo: 'E0202',
    roles: ['staff'],
  },
  {
    no: 'E0207',
    name: 'Chong Bee Hua',
    email: 'beehua.chong@yadiski.my',
    designation: 'Procurement Executive',
    departmentCode: 'OPS',
    gradeCode: 'E07',
    managerNo: 'E0202',
    roles: ['staff'],
  },
  {
    no: 'E0208',
    name: 'Harith bin Zakaria',
    email: 'harith.zakaria@yadiski.my',
    designation: 'Operations Executive',
    departmentCode: 'OPS',
    gradeCode: 'E07',
    managerNo: 'E0202',
    roles: ['staff'],
  },

  // Finance — managers + ICs
  {
    no: 'E0301',
    name: 'Wong Chee Hong',
    email: 'cheehong.wong@yadiski.my',
    designation: 'Manager, Financial Planning',
    departmentCode: 'FIN',
    gradeCode: 'E09',
    managerNo: 'E0102',
    roles: ['appraiser'],
  },
  {
    no: 'E0302',
    name: 'Zulkifli bin Rahman',
    email: 'zulkifli.rahman@yadiski.my',
    designation: 'Manager, Treasury',
    departmentCode: 'FIN',
    gradeCode: 'E09',
    managerNo: 'E0102',
    roles: ['appraiser'],
  },
  {
    no: 'E0303',
    name: 'Devi Nair',
    email: 'devi.nair@yadiski.my',
    designation: 'Finance Analyst',
    departmentCode: 'FIN',
    gradeCode: 'E08',
    managerNo: 'E0301',
    roles: ['staff'],
  },
  {
    no: 'E0304',
    name: 'Lim Mei Ling',
    email: 'meiling.lim@yadiski.my',
    designation: 'Finance Executive',
    departmentCode: 'FIN',
    gradeCode: 'E07',
    managerNo: 'E0301',
    roles: ['staff'],
  },
  {
    no: 'E0305',
    name: 'Fatimah binti Abu Bakar',
    email: 'fatimah.abubakar@yadiski.my',
    designation: 'Finance Executive',
    departmentCode: 'FIN',
    gradeCode: 'E07',
    managerNo: 'E0301',
    roles: ['staff'],
  },
  {
    no: 'E0306',
    name: 'Ng Kok Keong',
    email: 'kokkeong.ng@yadiski.my',
    designation: 'Treasury Analyst',
    departmentCode: 'FIN',
    gradeCode: 'E08',
    managerNo: 'E0302',
    roles: ['staff'],
  },
  {
    no: 'E0307',
    name: 'Kumar Subramaniam',
    email: 'kumar.subramaniam@yadiski.my',
    designation: 'Treasury Executive',
    departmentCode: 'FIN',
    gradeCode: 'E07',
    managerNo: 'E0302',
    roles: ['staff'],
  },

  // IT — managers + ICs
  {
    no: 'E0401',
    name: 'Ahmad Hafiz bin Zainal',
    email: 'hafiz.zainal@yadiski.my',
    designation: 'Manager, Platform Engineering',
    departmentCode: 'IT',
    gradeCode: 'E09',
    managerNo: 'E0103',
    roles: ['appraiser'],
  },
  {
    no: 'E0402',
    name: 'Cheong Li Qin',
    email: 'liqin.cheong@yadiski.my',
    designation: 'Manager, Data Engineering',
    departmentCode: 'IT',
    gradeCode: 'E09',
    managerNo: 'E0103',
    roles: ['appraiser'],
  },
  {
    no: 'E0403',
    name: 'Meena Pillai',
    email: 'meena.pillai@yadiski.my',
    designation: 'Manager, Security',
    departmentCode: 'IT',
    gradeCode: 'E09',
    managerNo: 'E0103',
    roles: ['appraiser'],
  },
  {
    no: 'E0404',
    name: 'Faizal bin Yusof',
    email: 'faizal.yusof@yadiski.my',
    designation: 'Senior Engineer',
    departmentCode: 'IT',
    gradeCode: 'E08',
    managerNo: 'E0401',
    roles: ['staff'],
  },
  {
    no: 'E0405',
    name: 'Ooi Jing Hui',
    email: 'jinghui.ooi@yadiski.my',
    designation: 'Senior Engineer',
    departmentCode: 'IT',
    gradeCode: 'E08',
    managerNo: 'E0401',
    roles: ['staff'],
  },
  {
    no: 'E0406',
    name: 'Ravi Shankar',
    email: 'ravi.shankar@yadiski.my',
    designation: 'Engineer',
    departmentCode: 'IT',
    gradeCode: 'E07',
    managerNo: 'E0401',
    roles: ['staff'],
  },
  {
    no: 'E0407',
    name: 'Nur Syafiqah binti Rahim',
    email: 'syafiqah.rahim@yadiski.my',
    designation: 'Engineer',
    departmentCode: 'IT',
    gradeCode: 'E07',
    managerNo: 'E0401',
    roles: ['staff'],
  },
  {
    no: 'E0408',
    name: 'Tan Hui Xin',
    email: 'huixin.tan@yadiski.my',
    designation: 'Data Engineer',
    departmentCode: 'IT',
    gradeCode: 'E08',
    managerNo: 'E0402',
    roles: ['staff'],
  },
  {
    no: 'E0409',
    name: 'Muhammad Irfan bin Hamid',
    email: 'irfan.hamid@yadiski.my',
    designation: 'Data Analyst',
    departmentCode: 'IT',
    gradeCode: 'E07',
    managerNo: 'E0402',
    roles: ['staff'],
  },
  {
    no: 'E0410',
    name: 'Nisha Devi Pillai',
    email: 'nisha.pillai@yadiski.my',
    designation: 'Data Analyst',
    departmentCode: 'IT',
    gradeCode: 'E07',
    managerNo: 'E0402',
    roles: ['staff'],
  },
  {
    no: 'E0411',
    name: 'Azman bin Ismail',
    email: 'azman.ismail@yadiski.my',
    designation: 'Security Analyst',
    departmentCode: 'IT',
    gradeCode: 'E08',
    managerNo: 'E0403',
    roles: ['staff'],
  },
  {
    no: 'E0412',
    name: 'Aisyah binti Sulaiman',
    email: 'aisyah.sulaiman@yadiski.my',
    designation: 'Security Engineer',
    departmentCode: 'IT',
    gradeCode: 'E07',
    managerNo: 'E0403',
    roles: ['staff'],
  },

  // HR — managers + ICs
  {
    no: 'E0501',
    name: 'Maryam binti Yusuf',
    email: 'maryam.yusuf@yadiski.my',
    designation: 'Manager, Talent Acquisition',
    departmentCode: 'HR',
    gradeCode: 'E09',
    managerNo: 'E0104',
    roles: ['appraiser'],
  },
  {
    no: 'E0502',
    name: 'Raja Kumar',
    email: 'raja.kumar@yadiski.my',
    designation: 'Manager, Employee Relations',
    departmentCode: 'HR',
    gradeCode: 'E09',
    managerNo: 'E0104',
    roles: ['appraiser'],
  },
  {
    no: 'E0503',
    name: 'Lim Hui Lin',
    email: 'huilin.lim@yadiski.my',
    designation: 'Talent Acquisition Executive',
    departmentCode: 'HR',
    gradeCode: 'E07',
    managerNo: 'E0501',
    roles: ['staff'],
  },
  {
    no: 'E0504',
    name: 'Hafsah binti Abdul Rahman',
    email: 'hafsah.rahman@yadiski.my',
    designation: 'HR Business Partner',
    departmentCode: 'HR',
    gradeCode: 'E08',
    managerNo: 'E0501',
    roles: ['staff'],
  },
  {
    no: 'E0505',
    name: 'Cheah Yik Meng',
    email: 'yikmeng.cheah@yadiski.my',
    designation: 'Employee Relations Executive',
    departmentCode: 'HR',
    gradeCode: 'E07',
    managerNo: 'E0502',
    roles: ['staff'],
  },
  {
    no: 'E0506',
    name: 'Indrani Raman',
    email: 'indrani.raman@yadiski.my',
    designation: 'HR Operations Executive',
    departmentCode: 'HR',
    gradeCode: 'E07',
    managerNo: 'E0502',
    roles: ['staff'],
  },
];

async function wipe(): Promise<void> {
  const raw = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    await raw`truncate table audit_log`;
    await raw`truncate table approval_transition, performance_cycle, kra_progress_update, kra cascade`;
    await raw`truncate table staff_role, staff, grade, department, organization cascade`;
    await raw`truncate table two_factor, session, verification, account, "user" cascade`;
  } finally {
    await raw.end({ timeout: 2 });
  }
}

async function main(): Promise<void> {
  console.log('[seed] wiping existing data…');
  await wipe();

  console.log('[seed] creating organization + taxonomy…');
  const [org] = await db
    .insert(s.organization)
    .values({ name: 'Invenio Potential Sdn. Bhd.', fiscalYearStartMonth: '01' })
    .returning();

  const deptRows = [
    { code: 'EXEC', name: 'Executive Office' },
    { code: 'OPS', name: 'Operations' },
    { code: 'FIN', name: 'Finance' },
    { code: 'IT', name: 'Information Technology' },
    { code: 'HR', name: 'Human Resources' },
  ];
  const departments = await db
    .insert(s.department)
    .values(deptRows.map((d) => ({ orgId: org!.id, ...d })))
    .returning();
  const deptByCode = new Map(departments.map((d) => [d.code, d.id]));

  const gradeRows = [
    { code: 'E07', rank: '7' },
    { code: 'E08', rank: '8' },
    { code: 'E09', rank: '9' },
    { code: 'E10', rank: '10' },
    { code: 'E11', rank: '11' },
    { code: 'E12', rank: '12' },
  ];
  const grades = await db
    .insert(s.grade)
    .values(gradeRows.map((g) => ({ orgId: org!.id, ...g })))
    .returning();
  const gradeByCode = new Map(grades.map((g) => [g.code, g.id]));

  console.log('[seed] signing up HRA user via Better Auth (real password)…');
  const hraSignUp = await auth.api.signUpEmail({
    body: { email: HRA_EMAIL!, password: HRA_PASSWORD!, name: HRA_NAME },
  });
  if (!hraSignUp?.user?.id) {
    throw new Error('HRA sign-up returned no user');
  }
  const hraUserId = hraSignUp.user.id;

  console.log(
    `[seed] inserting ${STAFF.length - 1} secondary users (no passwords — rely on reset flow)…`,
  );
  const userIdByEmail = new Map<string, string>();
  userIdByEmail.set(HRA_EMAIL!, hraUserId);

  for (const emp of STAFF) {
    if (emp.email === HRA_EMAIL) continue;
    const [u] = await db.insert(s.user).values({ email: emp.email, name: emp.name }).returning();
    userIdByEmail.set(emp.email, u!.id);
  }

  console.log('[seed] inserting staff rows (pass 1: without manager link)…');
  const staffIdByNo = new Map<string, string>();
  for (const emp of STAFF) {
    const [row] = await db
      .insert(s.staff)
      .values({
        userId: userIdByEmail.get(emp.email)!,
        orgId: org!.id,
        employeeNo: emp.no,
        name: emp.name,
        designation: emp.designation,
        departmentId: deptByCode.get(emp.departmentCode)!,
        gradeId: gradeByCode.get(emp.gradeCode)!,
        managerId: null,
        hireDate: '2022-01-01',
      })
      .returning();
    staffIdByNo.set(emp.no, row!.id);
  }

  console.log('[seed] linking manager chain…');
  for (const emp of STAFF) {
    if (!emp.managerNo) continue;
    const childId = staffIdByNo.get(emp.no)!;
    const mgrId = staffIdByNo.get(emp.managerNo)!;
    await db.execute(sql`update staff set manager_id = ${mgrId} where id = ${childId}`);
  }

  console.log('[seed] assigning roles…');
  for (const emp of STAFF) {
    const staffId = staffIdByNo.get(emp.no)!;
    for (const role of emp.roles) {
      await db.insert(s.staffRole).values({ staffId, role });
    }
  }

  console.log(`[seed] done — ${STAFF.length} staff seeded`);
  console.log(`        HRA login: ${HRA_EMAIL} / ${HRA_PASSWORD}`);
  console.log(`        Other staff have no password; they should use the "forgot password" flow.`);
}

await main();
process.exit(0);

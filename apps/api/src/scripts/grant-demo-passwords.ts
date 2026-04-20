#!/usr/bin/env bun
/**
 * One-shot helper: give every seeded secondary staff user a shared demo
 * password via better-auth's own hashing + account-insert path so sign-in
 * works end-to-end.
 *
 * Run from repo root so .env.local is picked up:
 *   bun apps/api/src/scripts/grant-demo-passwords.ts
 *
 * The password is the same for every user by design — this is a demo seed.
 * In a real deployment users set their own via the invite or reset flow.
 */

import { eq, isNull } from 'drizzle-orm';
import { auth } from '../auth/better-auth';
import { db } from '../db/client';
import * as s from '../db/schema';

const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'correct-horse-battery-staple-123';

const users = await db
  .select({ id: s.user.id, email: s.user.email, name: s.user.name })
  .from(s.user);

let updated = 0;
let skipped = 0;

for (const u of users) {
  const [existing] = await db
    .select({ id: s.account.id, password: s.account.password })
    .from(s.account)
    .where(eq(s.account.userId, u.id));

  if (existing?.password) {
    skipped++;
    continue;
  }

  // Use better-auth's own context to hash the password exactly the same way
  // signUpEmail would. Falls back to a direct account insert.
  const ctx = await auth.$context;
  const hashed = await ctx.password.hash(DEMO_PASSWORD);

  if (existing) {
    await db
      .update(s.account)
      .set({ password: hashed, providerId: 'credential', accountId: u.id })
      .where(eq(s.account.id, existing.id));
  } else {
    await db.insert(s.account).values({
      userId: u.id,
      providerId: 'credential',
      accountId: u.id,
      password: hashed,
    });
  }
  updated++;
  console.log(`[grant] ${u.email}`);
}

console.log(`\n[grant] done — ${updated} granted, ${skipped} already had passwords`);
console.log(`        demo password: ${DEMO_PASSWORD}`);
process.exit(0);

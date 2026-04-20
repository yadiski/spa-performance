process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/spa_test';
process.env.BETTER_AUTH_SECRET ??= 'a'.repeat(32);
process.env.BETTER_AUTH_URL ??= 'http://localhost:3000';
process.env.NODE_ENV ??= 'test';
process.env.API_PORT ??= '3000';
process.env.WEB_ORIGIN ??= 'http://localhost:5173';

import { describe, expect, it } from 'bun:test';
import { RETENTION_POLICY, cutoffFor } from '../src/compliance/retention';

describe('RETENTION_POLICY', () => {
  it('performanceRecords is 7 years', () => {
    expect(RETENTION_POLICY.performanceRecords.days).toBe(365 * 7);
    expect(RETENTION_POLICY.performanceRecords.trigger).toBe('cycle_closed_at');
  });

  it('authHot is 90 days', () => {
    expect(RETENTION_POLICY.authHot.days).toBe(90);
  });

  it('staffActive is 7 years', () => {
    expect(RETENTION_POLICY.staffActive.days).toBe(365 * 7);
    expect(RETENTION_POLICY.staffActive.trigger).toBe('terminated_at');
  });

  it('aiCache is 7 years', () => {
    expect(RETENTION_POLICY.aiCache.days).toBe(365 * 7);
  });

  it('exports is 1 year', () => {
    expect(RETENTION_POLICY.exports.days).toBe(365);
    expect(RETENTION_POLICY.exports.trigger).toBe('completed_at');
  });
});

describe('cutoffFor', () => {
  it('returns a date exactly N days before the anchor', () => {
    const now = new Date('2030-01-01T00:00:00.000Z');
    const cutoff = cutoffFor('authHot', now);
    const expectedMs = now.getTime() - 90 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBe(expectedMs);
  });

  it('returns a date 7 years before anchor for performanceRecords', () => {
    const now = new Date('2030-06-01T00:00:00.000Z');
    const cutoff = cutoffFor('performanceRecords', now);
    const expectedMs = now.getTime() - 365 * 7 * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBe(expectedMs);
  });

  it('cutoff is in the past relative to now', () => {
    const cutoff = cutoffFor('exports');
    expect(cutoff.getTime()).toBeLessThan(Date.now());
  });
});

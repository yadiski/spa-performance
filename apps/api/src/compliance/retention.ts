/**
 * Retention policy constants — defines how long each entity class is retained
 * before deletion or anonymisation, and which timestamp column triggers the cutoff.
 *
 * Regulatory basis:
 *  - Performance records: Labour Act / employment records = 7 years post-close
 *  - Auth hot window:     operational security = 90 days
 *  - Staff active+term:   employment law = 7 years post-termination
 *  - AI cache:            regulatory safety net = 7 years
 *  - Exports:             operational = 1 year
 */
export const RETENTION_POLICY = {
  /** 7 years after performance_cycle.pms_finalized_at */
  performanceRecords: { days: 365 * 7, trigger: 'cycle_closed_at' },
  /** 90-day hot window for auth_failed_attempt */
  authHot: { days: 90, trigger: 'occurred_at' },
  /** 7 years post-termination before anonymisation */
  staffActive: { days: 365 * 7, trigger: 'terminated_at' },
  /** AI cache rows — 7 years as regulatory safety net */
  aiCache: { days: 365 * 7, trigger: 'created_at' },
  /** Export job files — 1 year */
  exports: { days: 365, trigger: 'completed_at' },
} as const;

export type RetentionPolicyKey = keyof typeof RETENTION_POLICY;

/**
 * Returns the cutoff Date for a given policy key.
 * Rows whose trigger timestamp is BEFORE this date are eligible for retention action.
 *
 * @param policyKey - one of the RETENTION_POLICY keys
 * @param now       - optional anchor; defaults to Date.now() (useful for testing)
 */
export function cutoffFor(policyKey: RetentionPolicyKey, now: Date = new Date()): Date {
  const { days } = RETENTION_POLICY[policyKey];
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

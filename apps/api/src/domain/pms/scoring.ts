import { sql } from 'drizzle-orm';
import type { DB } from '../../db/client';

export type ScoreBreakdown = {
  kra: number; // contribution to total: weighted KRA × 0.70
  behavioural: number; // contribution: avg × 0.25
  contribution: number; // contribution: sum × 0.05 (capped at 5%)
  total: number; // capped at 5.0
};

/**
 * Compute Part IV total per spec §8.
 * total = (Σ kraRating × kraWeight%/100) × 0.70 + (avgBehavioural) × 0.25 + (Σ contributionWeight%/100) × 5.0 × 0.05
 *
 * Actually per spec: behavioural avg is 0-5 scale, multiplied by 0.25 weighting.
 * Contribution is bonus: each entry is 1-5% weight; sum (capped at 5) divided by 5
 * gives a 0-1 ratio that we multiply by 5.0 scale × 5% weighting.
 *
 * Simpler formulation aligned with paper form:
 *   kraSection = (Σ rating × weight%/100) × 0.70
 *   behaviouralSection = avg(rating) × 0.25
 *   contributionSection = min(sumWeightPct, 5) × 0.05 × 1.0 -- direct percentage as bonus
 *
 * Cap total at 5.0.
 */
export async function computeScore(db: DB, cycleId: string): Promise<ScoreBreakdown> {
  // Read pms assessment id
  const pmsRes = await db.execute(sql`
    select p.id from pms_assessment p where p.cycle_id = ${cycleId}
  `);
  const pmsRows = (
    Array.isArray(pmsRes) ? pmsRes : ((pmsRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ id: string }>;
  const pmsId = pmsRows[0]?.id;
  if (!pmsId) return { kra: 0, behavioural: 0, contribution: 0, total: 0 };

  // KRA section: Σ (rating × weight% / 100) × 0.70
  const kraRes = await db.execute(sql`
    select coalesce(sum(r.final_rating * k.weight_pct / 100.0), 0)::float as weighted_sum
    from pms_kra_rating r
    join kra k on k.id = r.kra_id
    where r.pms_id = ${pmsId}
  `);
  const kraRows = (
    Array.isArray(kraRes) ? kraRes : ((kraRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ weighted_sum: number }>;
  const kraWeighted = kraRows[0]?.weighted_sum ?? 0;

  // Behavioural section: avg(rating)
  const behRes = await db.execute(sql`
    select coalesce(avg(rating_1_to_5), 0)::float as avg_rating
    from behavioural_rating
    where pms_id = ${pmsId}
  `);
  const behRows = (
    Array.isArray(behRes) ? behRes : ((behRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ avg_rating: number }>;
  const behAvg = behRows[0]?.avg_rating ?? 0;

  // Contribution section: Σ weight% (capped at 5)
  const contribRes = await db.execute(sql`
    select coalesce(sum(weight_pct), 0)::int as total_pct
    from staff_contribution
    where pms_id = ${pmsId}
  `);
  const contribRows = (
    Array.isArray(contribRes) ? contribRes : ((contribRes as { rows?: unknown[] }).rows ?? [])
  ) as Array<{ total_pct: number }>;
  const contribPct = Math.min(contribRows[0]?.total_pct ?? 0, 5);

  const kraSection = kraWeighted * 0.7;
  const behaviouralSection = behAvg * 0.25;
  const contributionSection = contribPct * 0.05;
  const total = Math.min(kraSection + behaviouralSection + contributionSection, 5.0);

  return {
    kra: round2(kraSection),
    behavioural: round2(behaviouralSection),
    contribution: round2(contributionSection),
    total: round2(total),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

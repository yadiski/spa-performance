import { generateAccessReview } from '../compliance/access-review';
import { db } from '../db/client';

export async function runQuarterlyAccessReview(): Promise<{ cycleId: string; itemCount: number }> {
  console.log('quarterly-access-review: generating access review cycle...');
  const result = await generateAccessReview(db);
  console.log(
    `quarterly-access-review: done — cycleId=${result.cycleId}, items=${result.itemCount}`,
  );
  return result;
}

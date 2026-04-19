import { describe, expect, it } from 'bun:test';
import {
  PmsCommentRole,
  PotentialWindow,
  behaviouralRatingInput,
  midYearSave,
  saveBehaviouralRatings,
  saveStaffContributions,
  signPmsComment,
} from '../src/index';

describe('mid-year + pms zod schemas', () => {
  const uuid = '11111111-1111-1111-1111-111111111111';

  it('midYearSave accepts a single update', () => {
    const r = midYearSave.safeParse({
      cycleId: uuid,
      updates: [{ kraId: uuid, resultAchieved: 'Shipped the thing', informalRating: 4 }],
    });
    expect(r.success).toBe(true);
  });

  it('midYearSave rejects informalRating outside 1-5', () => {
    const r = midYearSave.safeParse({
      cycleId: uuid,
      updates: [{ kraId: uuid, resultAchieved: 'ok', informalRating: 6 }],
    });
    expect(r.success).toBe(false);
  });

  it('behaviouralRatingInput rejects anchor that is empty', () => {
    const r = behaviouralRatingInput.safeParse({
      dimensionCode: 'communication_skills',
      rating1to5: 3,
      rubricAnchorText: '',
    });
    expect(r.success).toBe(false);
  });

  it('saveBehaviouralRatings caps at 22 entries', () => {
    const r = saveBehaviouralRatings.safeParse({
      cycleId: uuid,
      ratings: Array.from({ length: 23 }, () => ({
        dimensionCode: 'x',
        rating1to5: 3,
        rubricAnchorText: 'some',
      })),
    });
    expect(r.success).toBe(false);
  });

  it('saveStaffContributions rejects total weight > 5', () => {
    const r = saveStaffContributions.safeParse({
      cycleId: uuid,
      contributions: [
        { whenDate: 'Jun 2026', achievement: 'A', weightPct: 3 },
        { whenDate: 'Aug 2026', achievement: 'B', weightPct: 3 },
      ],
    });
    expect(r.success).toBe(false);
  });

  it('signPmsComment requires a real name', () => {
    const r1 = signPmsComment.safeParse({ commentId: uuid, typedName: 'X' });
    const r2 = signPmsComment.safeParse({ commentId: uuid, typedName: 'Alya CEO' });
    expect(r1.success).toBe(false);
    expect(r2.success).toBe(true);
  });

  it('exposes enum constants', () => {
    expect(PmsCommentRole.Appraiser).toBe('appraiser');
    expect(PotentialWindow.OneToTwoYears).toBe('1-2_years');
  });
});

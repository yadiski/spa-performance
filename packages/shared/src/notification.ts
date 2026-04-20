import { z } from 'zod';

export const NotificationKind = {
  MidYearOpened: 'mid_year.opened',
  MidYearSubmitted: 'mid_year.submitted',
  MidYearAcked: 'mid_year.acked',
  PmsSelfReviewSubmitted: 'pms.self_review.submitted',
  PmsAppraiserSubmitted: 'pms.appraiser.submitted',
  PmsReturnedToAppraisee: 'pms.returned_to_appraisee',
  PmsReturnedToAppraiser: 'pms.returned_to_appraiser',
  PmsNextLevelSubmitted: 'pms.next_level.submitted',
  PmsFinalized: 'pms.finalized',
  PmsReopened: 'pms.reopened',
  PmsPdfReady: 'pms.pdf.ready',
  ExportReady: 'export.ready',
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

export const notificationKindSchema = z.enum([
  'mid_year.opened',
  'mid_year.submitted',
  'mid_year.acked',
  'pms.self_review.submitted',
  'pms.appraiser.submitted',
  'pms.returned_to_appraisee',
  'pms.returned_to_appraiser',
  'pms.next_level.submitted',
  'pms.finalized',
  'pms.reopened',
  'pms.pdf.ready',
  'export.ready',
]);

export const notificationPayloadSchema = z.record(z.string(), z.unknown());

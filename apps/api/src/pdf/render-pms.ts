import { renderToBuffer } from '@react-pdf/renderer';
import type { DocumentProps } from '@react-pdf/renderer';
import { eq } from 'drizzle-orm';
import React from 'react';
import type { DB } from '../db/client';
import {
  behaviouralDimension,
  behaviouralRating,
  careerDevelopment,
  cycleAmendment,
  department,
  grade,
  kra,
  organization,
  performanceCycle,
  personalGrowth,
  pmsAssessment,
  pmsComment,
  pmsFinalSnapshot,
  pmsKraRating,
  staff,
  staffContribution,
} from '../db/schema';
import { computeScore } from '../domain/pms/scoring';
import { type PmsPdfData, PmsPdfTemplate } from './templates/pms-template';

export async function renderPmsPdf(db: DB, cycleId: string): Promise<Uint8Array> {
  // ─── header data ─────────────────────────────────────────────────────────
  const [cy] = await db.select().from(performanceCycle).where(eq(performanceCycle.id, cycleId));
  if (!cy) throw new Error('cycle_not_found');
  const [st] = await db.select().from(staff).where(eq(staff.id, cy.staffId));
  if (!st) throw new Error('staff_not_found');
  const [org] = await db.select().from(organization).where(eq(organization.id, st.orgId));
  const [dept] = await db.select().from(department).where(eq(department.id, st.departmentId));
  const [gr] = await db.select().from(grade).where(eq(grade.id, st.gradeId));

  // Superior: direct manager
  let superiorName: string | null = null;
  if (st.managerId) {
    const [mgr] = await db.select().from(staff).where(eq(staff.id, st.managerId));
    superiorName = mgr?.name ?? null;
  }

  // ─── pms + parts ─────────────────────────────────────────────────────────
  const [pms] = await db.select().from(pmsAssessment).where(eq(pmsAssessment.cycleId, cycleId));

  const kras = await db.select().from(kra).where(eq(kra.cycleId, cycleId)).orderBy(kra.order);
  const kraRatings = pms
    ? await db.select().from(pmsKraRating).where(eq(pmsKraRating.pmsId, pms.id))
    : [];
  const ratingByKra = new Map(kraRatings.map((r) => [r.kraId, r]));

  const behavDims = await db
    .select()
    .from(behaviouralDimension)
    .orderBy(behaviouralDimension.order);
  const behavRatings = pms
    ? await db.select().from(behaviouralRating).where(eq(behaviouralRating.pmsId, pms.id))
    : [];
  const behavByCode = new Map(behavRatings.map((r) => [r.dimensionCode, r]));

  const contributions = pms
    ? await db.select().from(staffContribution).where(eq(staffContribution.pmsId, pms.id))
    : [];

  const [career] = pms
    ? await db.select().from(careerDevelopment).where(eq(careerDevelopment.pmsId, pms.id))
    : [];
  const [growth] = pms
    ? await db.select().from(personalGrowth).where(eq(personalGrowth.pmsId, pms.id))
    : [];

  const comments = pms
    ? await db
        .select()
        .from(pmsComment)
        .where(eq(pmsComment.pmsId, pms.id))
        .orderBy(pmsComment.createdAt)
    : [];

  // ─── score ───────────────────────────────────────────────────────────────
  const breakdown = await computeScore(db, cycleId);

  // ─── snapshot + amendment watermark ──────────────────────────────────────
  const snapshots = pms
    ? await db
        .select()
        .from(pmsFinalSnapshot)
        .where(eq(pmsFinalSnapshot.pmsId, pms.id))
        .orderBy(pmsFinalSnapshot.finalizedAt)
    : [];
  const latestSnap = snapshots[snapshots.length - 1] ?? null;
  const isAmendment = snapshots.length > 1 || latestSnap?.amendmentOfSnapshotId != null;
  const amendmentNo = snapshots.length > 1 ? snapshots.length - 1 : 0;

  // suppress unused import warning — cycleAmendment is imported per spec
  void cycleAmendment;

  // ─── compose data for template ───────────────────────────────────────────
  const data: PmsPdfData = {
    organizationName: org?.name ?? '—',
    staff: {
      name: st.name,
      employeeNo: st.employeeNo,
      designation: st.designation,
      departmentName: dept?.name ?? '—',
      gradeCode: gr?.code ?? '—',
      superiorName,
      reviewPeriod: `FY ${cy.fy}`,
    },
    kras: kras.map((k) => {
      const r = ratingByKra.get(k.id);
      return {
        description: k.description,
        weightPct: k.weightPct,
        measurement: k.measurement,
        target: k.target,
        resultAchieved: r?.resultAchieved ?? '',
        rating: r?.finalRating ?? null,
        comment: r?.comment ?? null,
      };
    }),
    behaviouralDimensions: behavDims.map((d) => {
      const r = behavByCode.get(d.code);
      return {
        title: d.title,
        description: d.description,
        rating: r?.rating1to5 ?? null,
        anchorText: r?.rubricAnchorText ?? null,
        comment: r?.comment ?? null,
      };
    }),
    contributions: contributions.map((c) => ({
      whenDate: c.whenDate,
      achievement: c.achievement,
      weightPct: c.weightPct,
    })),
    career: career
      ? {
          potentialWindow: career.potentialWindow,
          readyIn: career.readyIn,
          comments: career.comments,
        }
      : null,
    growth: growth
      ? {
          trainingNeeds: growth.trainingNeeds,
          comments: growth.comments,
        }
      : null,
    comments: comments.map((c) => ({
      role: c.role,
      body: c.body,
      signedAt: c.signedAt ? c.signedAt.toISOString() : null,
      signedByUserId: c.signedBy,
    })),
    score: breakdown,
    isFinalized: cy.state === 'pms_finalized',
    amendmentNo,
    isAmendment,
    finalizedAt: latestSnap?.finalizedAt ? latestSnap.finalizedAt.toISOString() : null,
  };

  // @react-pdf returns a Node Buffer; coerce to Uint8Array
  // Cast through unknown to satisfy the DocumentProps generic — our element
  // renders a Document root which satisfies the runtime contract.
  const element = React.createElement(PmsPdfTemplate, {
    data,
  }) as unknown as React.ReactElement<DocumentProps>;
  const buf = await renderToBuffer(element);
  return new Uint8Array(buf);
}

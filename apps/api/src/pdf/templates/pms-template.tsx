import { Document, Page, StyleSheet, Text, View } from '@react-pdf/renderer';
import React from 'react';
import type { ScoreBreakdown } from '../../domain/pms/scoring';

export type PmsPdfData = {
  organizationName: string;
  staff: {
    name: string;
    employeeNo: string;
    designation: string;
    departmentName: string;
    gradeCode: string;
    superiorName: string | null;
    reviewPeriod: string;
  };
  kras: Array<{
    description: string;
    weightPct: number;
    measurement: string;
    target: string;
    resultAchieved: string;
    rating: number | null;
    comment: string | null;
  }>;
  behaviouralDimensions: Array<{
    title: string;
    description: string;
    rating: number | null;
    anchorText: string | null;
    comment: string | null;
  }>;
  contributions: Array<{
    whenDate: string;
    achievement: string;
    weightPct: number;
  }>;
  career: { potentialWindow: string; readyIn: string | null; comments: string | null } | null;
  growth: { trainingNeeds: string | null; comments: string | null } | null;
  comments: Array<{
    role: string;
    body: string;
    signedAt: string | null;
    signedByUserId: string | null;
  }>;
  score: ScoreBreakdown;
  isFinalized: boolean;
  amendmentNo: number;
  isAmendment: boolean;
  finalizedAt: string | null;
};

const COL = {
  ink: '#1d1d1f',
  ink2: '#6e6e73',
  hairline: '#d2d2d7',
  surface: '#f5f5f7',
  white: '#ffffff',
};

const s = StyleSheet.create({
  page: {
    padding: 36,
    fontFamily: 'Helvetica',
    fontSize: 9,
    color: COL.ink,
    lineHeight: 1.35,
  },
  watermark: {
    position: 'absolute',
    top: 20,
    right: 36,
    fontSize: 9,
    color: COL.ink2,
    fontFamily: 'Helvetica-Oblique',
  },
  confidential: {
    position: 'absolute',
    top: 20,
    left: 36,
    fontSize: 8,
    color: COL.ink2,
  },
  title: {
    fontSize: 14,
    fontFamily: 'Helvetica-Bold',
    textAlign: 'center',
    marginTop: 18,
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 10,
    textAlign: 'center',
    color: COL.ink2,
    marginBottom: 16,
  },
  sectionHead: {
    fontSize: 10,
    fontFamily: 'Helvetica-Bold',
    borderBottomWidth: 1,
    borderBottomColor: COL.ink,
    paddingBottom: 2,
    marginTop: 14,
    marginBottom: 6,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  subsectionHead: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    marginTop: 8,
    marginBottom: 3,
  },
  headerGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  headerCell: {
    width: '50%',
    flexDirection: 'row',
    paddingVertical: 1,
  },
  headerLabel: {
    width: 90,
    color: COL.ink2,
  },
  headerValue: {
    flex: 1,
    fontFamily: 'Helvetica-Bold',
  },
  table: {
    borderTopWidth: 0.5,
    borderLeftWidth: 0.5,
    borderColor: COL.hairline,
  },
  tr: {
    flexDirection: 'row',
    borderBottomWidth: 0.5,
    borderColor: COL.hairline,
  },
  th: {
    fontFamily: 'Helvetica-Bold',
    padding: 4,
    borderRightWidth: 0.5,
    borderColor: COL.hairline,
    backgroundColor: COL.surface,
    fontSize: 8,
  },
  td: {
    padding: 4,
    borderRightWidth: 0.5,
    borderColor: COL.hairline,
    fontSize: 8,
  },
  tdNum: {
    textAlign: 'right',
  },
  kraBlock: {
    borderWidth: 0.5,
    borderColor: COL.hairline,
    padding: 6,
    marginBottom: 6,
  },
  kraRow: { flexDirection: 'row', marginBottom: 2 },
  kraLabel: { width: 70, color: COL.ink2, fontSize: 8 },
  kraValue: { flex: 1, fontSize: 9 },
  behavBlock: {
    borderWidth: 0.5,
    borderColor: COL.hairline,
    padding: 6,
    marginBottom: 4,
  },
  behavTitle: { fontFamily: 'Helvetica-Bold', fontSize: 9 },
  behavDesc: { color: COL.ink2, fontSize: 8, marginTop: 1, marginBottom: 3 },
  ratingChip: {
    alignSelf: 'flex-start',
    borderWidth: 0.5,
    borderColor: COL.ink,
    paddingHorizontal: 4,
    paddingVertical: 1,
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
  },
  anchorText: {
    marginTop: 3,
    fontSize: 8,
    color: COL.ink,
    fontStyle: 'italic',
  },
  scoreGrid: {
    flexDirection: 'row',
    borderWidth: 0.5,
    borderColor: COL.hairline,
  },
  scoreCell: {
    flex: 1,
    padding: 6,
    borderRightWidth: 0.5,
    borderColor: COL.hairline,
  },
  scoreLabel: { color: COL.ink2, fontSize: 8 },
  scoreValue: { fontSize: 14, fontFamily: 'Helvetica-Bold' },
  totalValue: { fontSize: 16, fontFamily: 'Helvetica-Bold' },
  commentBlock: {
    borderTopWidth: 0.5,
    borderColor: COL.hairline,
    paddingTop: 6,
    marginTop: 6,
  },
  commentRole: {
    fontFamily: 'Helvetica-Bold',
    fontSize: 9,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  commentMeta: {
    fontSize: 8,
    color: COL.ink2,
    marginTop: 2,
  },
  footer: {
    position: 'absolute',
    bottom: 20,
    left: 36,
    right: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
    fontSize: 7,
    color: COL.ink2,
    paddingTop: 4,
    borderTopWidth: 0.5,
    borderColor: COL.hairline,
  },
});

function HeaderRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.headerCell}>
      <Text style={s.headerLabel}>{label}</Text>
      <Text style={s.headerValue}>{value || '—'}</Text>
    </View>
  );
}

export function PmsPdfTemplate({ data }: { data: PmsPdfData }) {
  const amendmentBadge = data.isAmendment
    ? `Amendment ${data.amendmentNo} · Finalized ${data.finalizedAt ?? ''}`
    : data.isFinalized && data.finalizedAt
      ? `Finalized ${data.finalizedAt}`
      : 'Draft';

  return (
    <Document
      title={`PMS — ${data.staff.name} — ${data.staff.reviewPeriod}`}
      author={data.organizationName}
      producer="spa-performance"
      creator="spa-performance"
      subject={`Staff Performance Assessment — ${data.staff.name}`}
    >
      <Page size="A4" style={s.page} wrap>
        <Text style={s.confidential}>PRIVATE &amp; CONFIDENTIAL</Text>
        <Text style={s.watermark}>{amendmentBadge}</Text>
        <Text style={s.title}>{data.organizationName}</Text>
        <Text style={s.subtitle}>Staff Performance Assessment and Development</Text>

        {/* Header */}
        <View style={s.headerGrid}>
          <HeaderRow label="Staff Name" value={data.staff.name} />
          <HeaderRow label="Staff Number" value={data.staff.employeeNo} />
          <HeaderRow label="Designation" value={data.staff.designation} />
          <HeaderRow label="Department" value={data.staff.departmentName} />
          <HeaderRow label="Grade" value={data.staff.gradeCode} />
          <HeaderRow label="Review Period" value={data.staff.reviewPeriod} />
          <HeaderRow label="Superior" value={data.staff.superiorName ?? '—'} />
        </View>

        {/* Part I */}
        <Text style={s.sectionHead}>Part I · Key Result Areas (KRAs) · 70%</Text>
        {data.kras.map((k, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static PDF list — order is stable and there is no component state
          <View key={i} style={s.kraBlock} wrap={false}>
            <View style={s.kraRow}>
              <Text style={s.kraLabel}>KRA {i + 1}</Text>
              <Text style={s.kraValue}>{k.description}</Text>
            </View>
            <View style={s.kraRow}>
              <Text style={s.kraLabel}>Weight</Text>
              <Text style={s.kraValue}>{k.weightPct}%</Text>
            </View>
            <View style={s.kraRow}>
              <Text style={s.kraLabel}>Measurement</Text>
              <Text style={s.kraValue}>{k.measurement}</Text>
            </View>
            <View style={s.kraRow}>
              <Text style={s.kraLabel}>Target</Text>
              <Text style={s.kraValue}>{k.target}</Text>
            </View>
            <View style={s.kraRow}>
              <Text style={s.kraLabel}>Result</Text>
              <Text style={s.kraValue}>{k.resultAchieved || '—'}</Text>
            </View>
            <View style={s.kraRow}>
              <Text style={s.kraLabel}>Rating</Text>
              <Text style={s.kraValue}>
                {k.rating != null
                  ? `${k.rating} / 5 · Score ${((k.rating * k.weightPct) / 100).toFixed(2)}`
                  : '—'}
              </Text>
            </View>
            {k.comment ? (
              <View style={s.kraRow}>
                <Text style={s.kraLabel}>Comment</Text>
                <Text style={s.kraValue}>{k.comment}</Text>
              </View>
            ) : null}
          </View>
        ))}
        <Text style={{ fontSize: 8, color: COL.ink2, marginTop: 2 }}>
          Final Achieved Score (70%) = {data.score.kra.toFixed(2)}
        </Text>

        <Text style={s.footer} fixed>
          <Text>
            {data.staff.name} · {data.staff.employeeNo} · {data.staff.reviewPeriod}
          </Text>
        </Text>
      </Page>

      {/* Part II */}
      <Page size="A4" style={s.page} wrap>
        <Text style={s.confidential}>PRIVATE &amp; CONFIDENTIAL</Text>
        <Text style={s.watermark}>{amendmentBadge}</Text>
        <Text style={s.sectionHead}>Part II · Behavioural Values · 25%</Text>
        {data.behaviouralDimensions.map((dim, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static PDF list — order is stable and there is no component state
          <View key={i} style={s.behavBlock} wrap={false}>
            <Text style={s.behavTitle}>
              {i + 1}. {dim.title}
            </Text>
            <Text style={s.behavDesc}>{dim.description}</Text>
            {dim.rating != null ? (
              <>
                <Text style={s.ratingChip}>Rating {dim.rating} / 5</Text>
                {dim.anchorText ? (
                  <Text style={s.anchorText}>&quot;{dim.anchorText}&quot;</Text>
                ) : null}
                {dim.comment ? (
                  <Text style={{ marginTop: 3, fontSize: 8 }}>{dim.comment}</Text>
                ) : null}
              </>
            ) : (
              <Text style={{ fontSize: 8, color: COL.ink2 }}>Not rated.</Text>
            )}
          </View>
        ))}
        <Text style={{ fontSize: 8, color: COL.ink2, marginTop: 2 }}>
          Behavioural Section Score (25%) = {data.score.behavioural.toFixed(2)}
        </Text>

        <Text style={s.footer} fixed>
          <Text>
            {data.staff.name} · {data.staff.employeeNo} · {data.staff.reviewPeriod}
          </Text>
        </Text>
      </Page>

      {/* Part III + IV + V */}
      <Page size="A4" style={s.page} wrap>
        <Text style={s.confidential}>PRIVATE &amp; CONFIDENTIAL</Text>
        <Text style={s.watermark}>{amendmentBadge}</Text>

        <Text style={s.sectionHead}>Part III · Staff Contribution · 5% max</Text>
        {data.contributions.length > 0 ? (
          <View style={s.table}>
            <View style={s.tr}>
              <Text style={[s.th, { width: '20%' }]}>When</Text>
              <Text style={[s.th, { width: '65%' }]}>Achievement</Text>
              <Text style={[s.th, { width: '15%' }]}>Weight</Text>
            </View>
            {data.contributions.map((c, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static PDF list — order is stable and there is no component state
              <View key={i} style={s.tr}>
                <Text style={[s.td, { width: '20%' }]}>{c.whenDate}</Text>
                <Text style={[s.td, { width: '65%' }]}>{c.achievement}</Text>
                <Text style={[s.td, s.tdNum, { width: '15%' }]}>{c.weightPct}%</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ fontSize: 8, color: COL.ink2 }}>No contributions recorded.</Text>
        )}

        <Text style={s.sectionHead}>Part IV · Overall Performance Assessment</Text>
        <View style={s.scoreGrid}>
          <View style={s.scoreCell}>
            <Text style={s.scoreLabel}>KRA (70%)</Text>
            <Text style={s.scoreValue}>{data.score.kra.toFixed(2)}</Text>
          </View>
          <View style={s.scoreCell}>
            <Text style={s.scoreLabel}>Behavioural (25%)</Text>
            <Text style={s.scoreValue}>{data.score.behavioural.toFixed(2)}</Text>
          </View>
          <View style={s.scoreCell}>
            <Text style={s.scoreLabel}>Contribution (5%)</Text>
            <Text style={s.scoreValue}>{data.score.contribution.toFixed(2)}</Text>
          </View>
          <View style={[s.scoreCell, { borderRightWidth: 0 }]}>
            <Text style={s.scoreLabel}>Total Score</Text>
            <Text style={s.totalValue}>{data.score.total.toFixed(2)}</Text>
          </View>
        </View>

        <Text style={s.sectionHead}>Part V · Career Development and Personal Growth</Text>
        <Text style={s.subsectionHead}>(a) Career Development</Text>
        {data.career ? (
          <>
            <View style={s.kraRow}>
              <Text style={s.kraLabel}>Potential</Text>
              <Text style={s.kraValue}>{data.career.potentialWindow}</Text>
            </View>
            {data.career.readyIn ? (
              <View style={s.kraRow}>
                <Text style={s.kraLabel}>Ready in</Text>
                <Text style={s.kraValue}>{data.career.readyIn}</Text>
              </View>
            ) : null}
            {data.career.comments ? (
              <View style={s.kraRow}>
                <Text style={s.kraLabel}>Comments</Text>
                <Text style={s.kraValue}>{data.career.comments}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={{ fontSize: 8, color: COL.ink2 }}>Not completed.</Text>
        )}

        <Text style={s.subsectionHead}>(b) Personal Growth</Text>
        {data.growth ? (
          <>
            {data.growth.trainingNeeds ? (
              <View style={s.kraRow}>
                <Text style={s.kraLabel}>Training Needs</Text>
                <Text style={s.kraValue}>{data.growth.trainingNeeds}</Text>
              </View>
            ) : null}
            {data.growth.comments ? (
              <View style={s.kraRow}>
                <Text style={s.kraLabel}>Comments</Text>
                <Text style={s.kraValue}>{data.growth.comments}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <Text style={{ fontSize: 8, color: COL.ink2 }}>Not completed.</Text>
        )}

        <Text style={s.footer} fixed>
          <Text>
            {data.staff.name} · {data.staff.employeeNo} · {data.staff.reviewPeriod}
          </Text>
        </Text>
      </Page>

      {/* Part VI */}
      <Page size="A4" style={s.page} wrap>
        <Text style={s.confidential}>PRIVATE &amp; CONFIDENTIAL</Text>
        <Text style={s.watermark}>{amendmentBadge}</Text>
        <Text style={s.sectionHead}>Part VI · Comments &amp; Acknowledgement</Text>
        {data.comments.length > 0 ? (
          data.comments.map((c, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static PDF list — order is stable and there is no component state
            <View key={i} style={s.commentBlock} wrap={false}>
              <Text style={s.commentRole}>
                {c.role === 'appraiser'
                  ? "(a) Supervisor's Comments"
                  : c.role === 'appraisee'
                    ? "(b) Staff's Comments"
                    : '(c) Next Management Level'}
              </Text>
              <Text>{c.body}</Text>
              <Text style={s.commentMeta}>
                {c.signedAt
                  ? `Signed ${c.signedAt}${c.signedByUserId ? ` by user ${c.signedByUserId.slice(0, 8)}…` : ''}`
                  : 'Unsigned.'}
              </Text>
            </View>
          ))
        ) : (
          <Text style={{ fontSize: 8, color: COL.ink2 }}>No comments recorded.</Text>
        )}

        <Text style={s.footer} fixed>
          <Text>
            {data.staff.name} · {data.staff.employeeNo} · {data.staff.reviewPeriod}
          </Text>
        </Text>
      </Page>
    </Document>
  );
}

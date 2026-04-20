import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import type { CalibrationOutput } from '../../../api/ai';
import { aiApi } from '../../../api/ai';
import { api } from '../../../api/client';
import { AiPanel } from '../../../components/ai/AiPanel';
import type { CalibrationCell } from '../../../components/dashboard/CalibrationMatrix';
import { CalibrationMatrix } from '../../../components/dashboard/CalibrationMatrix';

export const Route = createFileRoute('/_app/hr/calibration')({
  component: HrCalibration,
});

interface CalibrationNoteRow {
  id: string;
  gradeId: string;
  fy: number;
  subjectKey: string;
  subjectName: string;
  note: string;
  updatedAt: string;
}

function OverrideModal({
  cell,
  gradeId,
  fy,
  onClose,
}: {
  cell: CalibrationCell;
  gradeId: string;
  fy: number;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);

  const notesKey = ['calibration', 'notes', gradeId, fy] as const;

  const existing = useQuery({
    queryKey: notesKey,
    queryFn: () =>
      api<{ items: CalibrationNoteRow[] }>(`/api/v1/calibration/notes?gradeId=${gradeId}&fy=${fy}`),
  });

  useEffect(() => {
    const found = existing.data?.items.find((n) => n.subjectKey === cell.staffKey);
    if (found) setNote(found.note);
  }, [existing.data, cell.staffKey]);

  const save = useMutation({
    mutationFn: async () => {
      await api('/api/v1/calibration/notes', {
        method: 'POST',
        body: JSON.stringify({
          gradeId,
          fy,
          subjectKey: cell.staffKey,
          subjectName: cell.staffName,
          note,
        }),
      });
    },
    onSuccess: async () => {
      setSaved(true);
      await qc.invalidateQueries({ queryKey: notesKey });
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-surface border border-hairline rounded-md p-6 w-full max-w-sm space-y-4 shadow-none">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink">Calibration override</div>
            <div className="text-xs text-ink-2 mt-0.5">
              {cell.staffName} · rating {cell.rating.toFixed(1)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-2 hover:text-ink text-lg leading-none"
          >
            ×
          </button>
        </div>

        <div className="border-t border-hairline" />

        <div>
          <label htmlFor="override-note" className="block text-xs text-ink-2 mb-1">
            Note (HRA only)
          </label>
          <textarea
            id="override-note"
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setSaved(false);
            }}
            rows={4}
            className="w-full text-sm border border-hairline rounded-sm p-2 bg-white"
            placeholder="Reason for manual calibration override…"
          />
          {save.error && (
            <p className="text-xs text-neg mt-1">Save failed. Try again in a moment.</p>
          )}
        </div>

        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="text-sm border border-hairline rounded-sm px-3 py-1.5 text-ink-2 hover:bg-canvas transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={save.isPending || note.trim().length === 0}
            className="text-sm border border-hairline rounded-sm px-3 py-1.5 bg-ink text-white hover:bg-ink/90 transition-colors disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : saved ? 'Saved' : 'Save note'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

function HrCalibration() {
  const currentFy = new Date().getFullYear();
  const [fy, setFy] = useState(currentFy);
  const [expandedGradeId, setExpandedGradeId] = useState<string | null>(null);
  const [overrideCtx, setOverrideCtx] = useState<{
    cell: CalibrationCell;
    gradeId: string;
    fy: number;
  } | null>(null);

  const cohortsQuery = useQuery({
    queryKey: ['ai', 'calibration-cohorts', fy],
    queryFn: () => aiApi.calibrationCohorts(fy),
  });

  const items = cohortsQuery.data?.items ?? [];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-ink">HR Calibration</h1>
        <p className="text-xs text-ink-2 mt-1">
          Review same-grade cohorts and run the AI calibration assistant.
        </p>
      </div>

      {/* FY selector */}
      <div className="flex items-center gap-3">
        <label htmlFor="cal-fy" className="text-xs text-ink-2">
          Financial year
        </label>
        <select
          id="cal-fy"
          value={fy}
          onChange={(e) => {
            setFy(Number(e.target.value));
            setExpandedGradeId(null);
          }}
          className="text-sm border border-hairline rounded-sm px-2 py-1 bg-surface"
        >
          {[currentFy - 1, currentFy, currentFy + 1].map((y) => (
            <option key={y} value={y}>
              FY {y}
            </option>
          ))}
        </select>
      </div>

      {/* Cohort list */}
      {cohortsQuery.isLoading && <div className="text-sm text-ink-2">Loading cohorts…</div>}

      {cohortsQuery.isError && <div className="text-sm text-neg">Failed to load cohorts.</div>}

      {items.length === 0 && !cohortsQuery.isLoading && (
        <div className="text-sm text-ink-2 bg-surface border border-hairline rounded-md p-4">
          No finalized cycles found for FY {fy}.
        </div>
      )}

      <div className="space-y-3">
        {items.map((cohort) => {
          // Build CalibrationMatrix cells from cohort data.
          // The AI calibration cohort items don't carry per-staff details,
          // so we create placeholder cells using aggregate data.
          // In a fully-wired version these would come from a dedicated cohort-details endpoint.
          const matrixCells: CalibrationCell[] =
            cohort.avgScore != null
              ? [
                  {
                    staffKey: `${cohort.gradeId}-avg`,
                    staffName: `Grade ${cohort.gradeCode} (avg)`,
                    rating: cohort.avgScore,
                    isOutlier: false,
                  },
                ]
              : [];

          return (
            <div
              key={cohort.gradeId}
              className="bg-surface border border-hairline rounded-md p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-ink">Grade {cohort.gradeCode}</div>
                  <div className="text-xs text-ink-2">
                    {cohort.cycleCount} finalized cycle{cohort.cycleCount !== 1 ? 's' : ''}
                    {cohort.avgScore !== null && ` · avg score ${cohort.avgScore}`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setExpandedGradeId(expandedGradeId === cohort.gradeId ? null : cohort.gradeId)
                  }
                  className="text-xs border border-hairline rounded-sm px-3 py-1.5 hover:bg-canvas text-ink-2 hover:text-ink transition-colors"
                >
                  {expandedGradeId === cohort.gradeId ? 'Close' : 'Run calibration'}
                </button>
              </div>

              {/* CalibrationMatrix — cohort visual grid */}
              {matrixCells.length > 0 && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-ink-2 mb-2">
                    Cohort matrix
                  </div>
                  <CalibrationMatrix
                    cells={matrixCells}
                    gridCols={Math.min(matrixCells.length, 6)}
                  />
                  {matrixCells.some((cell) => cell.isOutlier) && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {matrixCells
                        .filter((cell) => cell.isOutlier)
                        .map((cell) => (
                          <button
                            key={cell.staffKey}
                            type="button"
                            onClick={() => setOverrideCtx({ cell, gradeId: cohort.gradeId, fy })}
                            className="text-xs border border-red-200 bg-red-50 text-red-700 rounded-sm px-2 py-1 hover:bg-red-100 transition-colors"
                          >
                            Override: {cell.staffName}
                          </button>
                        ))}
                    </div>
                  )}
                </div>
              )}

              {expandedGradeId === cohort.gradeId && (
                <AiPanel
                  title={`Calibration — Grade ${cohort.gradeCode} · FY ${fy}`}
                  queryKey={['ai', 'calibration', cohort.gradeId, fy]}
                  queryFn={() => aiApi.calibration(cohort.gradeId, fy).then((r) => r.output)}
                  onRegenerate={() => setExpandedGradeId(cohort.gradeId)}
                >
                  {(output: CalibrationOutput) => (
                    <div className="space-y-3 text-sm">
                      {output.outliers.length > 0 && (
                        <div>
                          <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                            Outliers
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5 text-ink">
                            {output.outliers.map((o, i) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                              <li key={i}>{o}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {output.inconsistency_flags.length > 0 && (
                        <div>
                          <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                            Inconsistency flags
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5 text-ink">
                            {output.inconsistency_flags.map((f, i) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                              <li key={i}>{f}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {output.talking_points.length > 0 && (
                        <div>
                          <div className="text-xs uppercase tracking-wider text-ink-2 mb-1">
                            Talking points
                          </div>
                          <ul className="list-disc pl-4 space-y-0.5 text-ink">
                            {output.talking_points.map((t, i) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: AI-generated string list has no stable id
                              <li key={i}>{t}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </AiPanel>
              )}
            </div>
          );
        })}
      </div>

      {/* Override modal */}
      {overrideCtx && (
        <OverrideModal
          cell={overrideCtx.cell}
          gradeId={overrideCtx.gradeId}
          fy={overrideCtx.fy}
          onClose={() => setOverrideCtx(null)}
        />
      )}
    </div>
  );
}

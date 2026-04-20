import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import type { CalibrationOutput } from '../../../api/ai';
import { aiApi } from '../../../api/ai';
import { AiPanel } from '../../../components/ai/AiPanel';

export const Route = createFileRoute('/_app/hr/calibration')({
  component: HrCalibration,
});

function HrCalibration() {
  const currentFy = new Date().getFullYear();
  const [fy, setFy] = useState(currentFy);
  const [expandedGradeId, setExpandedGradeId] = useState<string | null>(null);

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
        {items.map((cohort) => (
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
        ))}
      </div>
    </div>
  );
}

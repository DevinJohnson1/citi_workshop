import { useEffect, useState } from 'react';
import { useApi } from '../services/apiClient';

interface ReportPanel {
  key: string;
  label: string;
  path: string;
}

const PANELS: ReportPanel[] = [
  { key: 'at-risk', label: 'At-risk projects', path: '/reports-service/at-risk' },
  { key: 'over-allocated', label: 'Users with overlapping allocations', path: '/reports-service/over-allocated' },
  { key: 'over-assigned', label: 'Overworked users (>3 projects or >10 deliverables)', path: '/reports-service/over-assigned' },
  { key: 'budget', label: 'Budget vs planned', path: '/reports-service/budget-vs-planned' },
];

/**
 * Reports page — fans out to multiple `/api/reports-service/*` endpoints and
 * renders each result as a JSON preview. Replace JSON view with proper tables
 * as data shapes stabilize.
 */
export function ReportsPage() {
  const { apiGet } = useApi();
  const [data, setData] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    PANELS.forEach((panel) => {
      apiGet<unknown>(panel.path)
        .then((res) => setData((prev) => ({ ...prev, [panel.key]: res })))
        .catch((err: Error) => setErrors((prev) => ({ ...prev, [panel.key]: err.message })));
    });
  }, [apiGet]);

  return (
    <section className="space-y-4">
      <h1 className="text-xl font-semibold">Reports</h1>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PANELS.map((panel) => (
          <article key={panel.key} className="rounded border border-gray-200 bg-white p-4">
            <h2 className="font-medium">{panel.label}</h2>
            {errors[panel.key] && <p className="text-sm text-red-600">{errors[panel.key]}</p>}
            {!errors[panel.key] && !data[panel.key] && (
              <p className="text-sm text-gray-500">Loading…</p>
            )}
            {data[panel.key] !== undefined && (
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-gray-50 p-2 text-xs">
                {JSON.stringify(data[panel.key], null, 2)}
              </pre>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}


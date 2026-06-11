/**
 * Scenes — the six full-screen panels the Showcase stage rotates through.
 *
 * Each scene is a pure function of `SceneData` (see `sceneTypes.ts`). They
 * never fire requests, they never mutate. The stage hands them the same
 * already-fetched bundle on every render.
 *
 * Design intent: every scene answers a *single* question in three seconds.
 * Large display numerals dominate; supporting data sits in a glass panel
 * underneath. Entry choreography is applied by `.scene-enter` (defined in
 * `index.css`), staggered with `.scene-enter-delay-N` for the secondary
 * blocks so the eye lands on the big number first.
 */
import { Link } from 'react-router-dom';
import type { SceneData, SceneDef } from './sceneTypes';
import type { Deliverable, DeliverableStatus } from '../../types/api';
import { prettyLabel, roleLabel } from '../../utils/labels';
import { RadialGauge } from './RadialGauge';

/* ---------- shared helpers ------------------------------------------------ */

const STATUS_TONE: Record<DeliverableStatus, string> = {
  done:        'bg-jade-500',
  in_progress: 'bg-brand-500',
  blocked:     'bg-amber-500',
  todo:        'bg-white/15',
  cancelled:   'bg-white/10',
};

const PROJECT_STATUS_TONE: Record<string, { dot: string; text: string; ring: string }> = {
  active:    { dot: 'bg-jade-500',   text: 'text-jade-100',   ring: 'ring-jade-500/40' },
  planned:   { dot: 'bg-brand-300',  text: 'text-brand-100',  ring: 'ring-brand-500/40' },
  on_hold:   { dot: 'bg-amber-500',  text: 'text-amber-100',  ring: 'ring-amber-500/40' },
  done:      { dot: 'bg-white/40',   text: 'text-white/80',   ring: 'ring-white/30'    },
  cancelled: { dot: 'bg-ember-500',  text: 'text-ember-100',  ring: 'ring-ember-500/40' },
};

const DEFAULT_PROJECT_TONE = PROJECT_STATUS_TONE.planned as { dot: string; text: string; ring: string };

function statusBreakdown(deliverables: Deliverable[]) {
  const out = { done: 0, in_progress: 0, blocked: 0, todo: 0, cancelled: 0, overdue: 0 };
  for (const d of deliverables) {
    if (d.is_outdated) out.overdue += 1;
    out[d.status] = (out[d.status] ?? 0) + 1;
  }
  return out;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  // Show "Mon DD, YYYY" — viewers won't be parsing ISO timestamps live.
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function fmtMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  } catch {
    return `${Math.round(n).toLocaleString()} ${currency}`;
  }
}

/* ========================================================================= */
/* 1. Overview — the project's "title card" + headline counts                  */
/* ========================================================================= */

function OverviewScene({ data }: { data: SceneData }) {
  const { project, deliverables, allocations, equipment, users } = data;
  const tone = PROJECT_STATUS_TONE[project.status] ?? DEFAULT_PROJECT_TONE;
  const distinctMembers = new Set(allocations.map((a) => a.user_id)).size;
  const owner = users.get(project.owner_id);
  // Co-leads = every lead other than the canonical owner. Backend embeds
  // `lead_ids` in the project payload (owner first, then co-leads in
  // insertion order) — see projects-service `_attach_leads`.
  const leadIds = project.lead_ids && project.lead_ids.length > 0
    ? project.lead_ids
    : [project.owner_id];
  const coLeads = leadIds
    .filter((id) => id !== project.owner_id)
    .map((id) => users.get(id))
    .filter((u): u is NonNullable<typeof u> => !!u);

  return (
    <div className="grid h-full grid-cols-1 gap-8 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex min-w-0 flex-col justify-center">
        <div className="scene-enter label-caps !text-[var(--showcase-ink-dim)]">Engagement</div>

        <h2 className="scene-enter mt-2 display-num text-[clamp(2.5rem,7vw,5.5rem)] font-semibold text-white">
          {project.name}
        </h2>

        <div className="scene-enter scene-enter-delay-1 mt-4 flex flex-wrap items-center gap-3">
          <span className={`inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-sm ring-1 ring-inset ${tone.ring} ${tone.text}`}>
            <span aria-hidden className={`h-2 w-2 rounded-full ${tone.dot} soft-pulse`} />
            {prettyLabel(project.status)}
          </span>
          {project.is_at_risk && (
            <span className="inline-flex items-center gap-2 rounded-full bg-ember-500/15 px-3 py-1 text-sm text-ember-100 ring-1 ring-inset ring-ember-500/40">
              <span aria-hidden className="h-2 w-2 rounded-full bg-ember-500 soft-pulse" />
              At risk
            </span>
          )}
          {owner && (
            <span className="text-sm text-[var(--showcase-ink-dim)]">
              Owned by <span className="text-white">{owner.full_name || owner.email}</span>
            </span>
          )}
          {coLeads.length > 0 && (
            // Co-leads strip — same write authority as the owner on the
            // backend, so we surface them on the kiosk overview too.
            <span className="text-sm text-[var(--showcase-ink-dim)]">
              Co-led by{' '}
              {coLeads.map((u, i) => (
                <span key={u.id}>
                  {i > 0 && ', '}
                  <span className="text-white">{u.full_name || u.email}</span>
                </span>
              ))}
            </span>
          )}
        </div>

        {project.description && (
          <p className="scene-enter scene-enter-delay-2 mt-6 max-w-2xl text-lg leading-relaxed text-[var(--showcase-ink-dim)]">
            {project.description}
          </p>
        )}

        <dl className="scene-enter scene-enter-delay-3 mt-8 grid max-w-xl grid-cols-2 gap-x-8 gap-y-4 font-mono text-sm">
          <div>
            <dt className="label-caps !text-[var(--showcase-ink-dim)]">Start</dt>
            <dd className="mt-1 text-white">{fmtDate(project.start_date)}</dd>
          </div>
          <div>
            <dt className="label-caps !text-[var(--showcase-ink-dim)]">Target end</dt>
            <dd className="mt-1 text-white">{fmtDate(project.target_end_date)}</dd>
          </div>
          <div>
            <dt className="label-caps !text-[var(--showcase-ink-dim)]">Actual end</dt>
            <dd className="mt-1 text-white">{fmtDate(project.actual_end_date)}</dd>
          </div>
          <div>
            <dt className="label-caps !text-[var(--showcase-ink-dim)]">Last updated</dt>
            <dd className="mt-1 text-white">{fmtDate(project.updated_at)}</dd>
          </div>
        </dl>
      </div>

      <div className="scene-enter scene-enter-delay-2 grid grid-cols-2 gap-4 self-center">
        <KioskCount label="Deliverables" value={deliverables.length} hint="tracked items" tone="brand" />
        <KioskCount label="Team"         value={distinctMembers}     hint="allocated members" tone="jade" />
        <KioskCount label="Equipment"    value={equipment.length}    hint="assets attached" tone="violet" />
        <KioskCount
          label="Open"
          value={deliverables.filter((d) => d.status !== 'done' && d.status !== 'cancelled').length}
          hint="not yet done"
          tone="amber"
        />
      </div>
    </div>
  );
}

function KioskCount({ label, value, hint, tone }: { label: string; value: number; hint: string; tone: 'brand' | 'jade' | 'amber' | 'violet' }) {
  const ring = {
    brand:  'ring-brand-500/30',
    jade:   'ring-jade-500/30',
    amber:  'ring-amber-500/30',
    violet: 'ring-violet-500/30',
  }[tone];
  return (
    <div className={`glass scanline-host p-6 ring-1 ${ring}`}>
      <div className="label-caps !text-[var(--showcase-ink-dim)]">{label}</div>
      <div className="kpi-pop mt-2 display-num text-[clamp(2.5rem,5vw,4.5rem)] font-semibold text-white">
        {value}
      </div>
      <div className="mt-1 text-xs text-[var(--showcase-ink-dim)]">{hint}</div>
    </div>
  );
}

/* ========================================================================= */
/* 2. Health pulse — segmented barcode + breakdown bars                       */
/* ========================================================================= */

function HealthScene({ data }: { data: SceneData }) {
  const { deliverables } = data;
  const bd = statusBreakdown(deliverables);
  const total = Math.max(1, deliverables.length);
  // Each barcode cell is a deliverable, coloured by status (or ember if outdated).
  return (
    <div className="grid h-full grid-cols-1 content-center gap-10">
      <div className="scene-enter">
        <div className="label-caps !text-[var(--showcase-ink-dim)]">Health pulse</div>
        <h2 className="mt-1 display-num text-[clamp(2.25rem,5vw,4rem)] font-semibold text-white">
          {bd.overdue === 0 ? 'On track' : `${bd.overdue} overdue ${bd.overdue === 1 ? 'item' : 'items'}`}
        </h2>
        <p className="mt-2 max-w-2xl text-[var(--showcase-ink-dim)]">
          Each cell below is one deliverable. Jade is done, cobalt is in motion, amber is blocked, ember is overdue, dim cells are not yet started.
        </p>
      </div>

      <div className="scene-enter scene-enter-delay-1 glass scanline-host p-6">
        {deliverables.length === 0 ? (
          <div className="grid h-24 place-items-center text-sm text-[var(--showcase-ink-dim)]">
            No deliverables on this project yet.
          </div>
        ) : (
          <div className="flex h-16 overflow-hidden rounded-xl ring-1 ring-inset ring-white/10">
            {deliverables.map((d) => {
              const tone = d.is_outdated ? 'bg-ember-500' : STATUS_TONE[d.status];
              return (
                <div
                  key={d.id}
                  className={`${tone} h-full transition-opacity hover:opacity-80`}
                  style={{ width: `${100 / deliverables.length}%` }}
                  title={`${d.title} — ${d.is_outdated ? 'overdue' : prettyLabel(d.status)}`}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="scene-enter scene-enter-delay-2 grid grid-cols-2 gap-6 lg:grid-cols-5">
        <Breakdown label="Done"        n={bd.done}        max={total} tone="bg-jade-500"  text="text-jade-100" />
        <Breakdown label="In motion"   n={bd.in_progress} max={total} tone="bg-brand-500" text="text-brand-100" />
        <Breakdown label="Blocked"     n={bd.blocked}     max={total} tone="bg-amber-500" text="text-amber-100" />
        <Breakdown label="Overdue"     n={bd.overdue}     max={total} tone="bg-ember-500" text="text-ember-100" />
        <Breakdown label="To do"       n={bd.todo}        max={total} tone="bg-white/30"  text="text-white/80" />
      </div>
    </div>
  );
}

function Breakdown({ label, n, max, tone, text }: { label: string; n: number; max: number; tone: string; text: string }) {
  const pct = max > 0 ? (n / max) * 100 : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="label-caps !text-[var(--showcase-ink-dim)]">{label}</span>
        <span className={`display-num text-3xl ${text}`}>{n}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/8 ring-1 ring-inset ring-white/10">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%`, transition: 'width 800ms cubic-bezier(0.2,0.6,0.2,1)' }} />
      </div>
    </div>
  );
}

/* ========================================================================= */
/* 3. Completion — radial gauge                                                */
/* ========================================================================= */

function CompletionScene({ data }: { data: SceneData }) {
  const c = data.completion ?? { total: data.deliverables.length, completed: data.deliverables.filter((d) => d.status === 'done').length, percent_complete: 0 };
  const pct = c.total > 0 ? (c.completed / c.total) * 100 : 0;
  const inProgress = data.deliverables.filter((d) => d.status === 'in_progress').length;
  const blocked    = data.deliverables.filter((d) => d.status === 'blocked').length;
  const overdue    = data.deliverables.filter((d) => d.is_outdated).length;

  const tone: 'brand' | 'jade' | 'amber' | 'ember' =
    pct >= 100 ? 'jade' :
    overdue > 0 ? 'ember' :
    blocked > 0 ? 'amber' : 'brand';

  return (
    <div className="grid h-full grid-cols-1 items-center gap-12 lg:grid-cols-[auto_1fr]">
      <div className="scene-enter mx-auto">
        <RadialGauge value={pct} size={360} tone={tone}>
          <div className="display-num text-[clamp(3rem,8vw,6.5rem)] font-semibold text-white">
            {Math.round(pct)}
            <span className="ml-2 align-top text-2xl text-[var(--showcase-ink-dim)]">%</span>
          </div>
          <div className="mt-1 label-caps !text-[var(--showcase-ink-dim)]">complete</div>
        </RadialGauge>
      </div>

      <div className="space-y-4">
        <div className="scene-enter">
          <div className="label-caps !text-[var(--showcase-ink-dim)]">Deliverable completion</div>
          <h2 className="mt-1 display-num text-[clamp(2rem,4.5vw,3.5rem)] font-semibold text-white">
            {c.completed} of {c.total} done
          </h2>
        </div>

        <div className="scene-enter scene-enter-delay-1 grid grid-cols-3 gap-3">
          <StatTile label="In motion" value={inProgress} tone="brand" />
          <StatTile label="Blocked"   value={blocked}    tone="amber" />
          <StatTile label="Overdue"   value={overdue}    tone="ember" />
        </div>

        <p className="scene-enter scene-enter-delay-2 max-w-xl text-[var(--showcase-ink-dim)]">
          {pct >= 100
            ? 'Everything has shipped. Look at that.'
            : overdue > 0
              ? `${overdue} ${overdue === 1 ? 'item is' : 'items are'} past their due date. Recovery work is the priority.`
              : blocked > 0
                ? `${blocked} ${blocked === 1 ? 'item is' : 'items are'} blocked. Unsticking these accelerates the rest.`
                : 'No blockers, no overdue work. The team is heads-down and shipping.'}
        </p>
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone: 'brand' | 'amber' | 'ember' }) {
  const ring = { brand: 'ring-brand-500/30', amber: 'ring-amber-500/30', ember: 'ring-ember-500/30' }[tone];
  const text = { brand: 'text-brand-100', amber: 'text-amber-100', ember: 'text-ember-100' }[tone];
  return (
    <div className={`glass p-4 ring-1 ${ring}`}>
      <div className="label-caps !text-[var(--showcase-ink-dim)]">{label}</div>
      <div className={`mt-1 display-num text-3xl ${text}`}>{value}</div>
    </div>
  );
}

/* ========================================================================= */
/* 4. Dependency chain — stacked depth swimlanes                              */
/* ========================================================================= */

function DependencyScene({ data }: { data: SceneData }) {
  const { chain, deliverables } = data;
  // Group by depth so we can render swimlanes side-by-side. Fall back to a
  // flat root list if the chain endpoint returned nothing (e.g. zero
  // deliverables) so the scene still tells the truth.
  const byDepth = new Map<number, typeof chain>();
  for (const node of chain) {
    const arr = byDepth.get(node.depth) ?? [];
    arr.push(node);
    byDepth.set(node.depth, arr);
  }
  const depths = [...byDepth.keys()].sort((a, b) => a - b);
  const maxDepth = depths.length ? depths[depths.length - 1] : 0;
  const statusOf = (id: string) => deliverables.find((d) => d.id === id);

  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-6">
      <div className="scene-enter">
        <div className="label-caps !text-[var(--showcase-ink-dim)]">Dependency chain</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-4">
          <h2 className="display-num text-[clamp(2rem,4.5vw,3.5rem)] font-semibold text-white">
            {chain.length} {chain.length === 1 ? 'node' : 'nodes'}
          </h2>
          <span className="font-mono text-sm text-[var(--showcase-ink-dim)]">
            depth {maxDepth} · {byDepth.get(0)?.length ?? 0} roots
          </span>
        </div>
      </div>

      <div className="scene-enter scene-enter-delay-1 min-h-0 overflow-auto">
        {chain.length === 0 ? (
          <div className="grid h-full place-items-center text-[var(--showcase-ink-dim)]">
            No deliverables on this project — nothing to chain yet.
          </div>
        ) : (
          <div className="flex h-full min-w-min items-stretch gap-4">
            {depths.map((depth) => (
              <div key={depth} className="glass flex min-w-[220px] flex-1 flex-col gap-2 p-4">
                <div className="label-caps !text-[var(--showcase-ink-dim)]">
                  Depth {depth} {depth === 0 ? '· roots' : ''}
                </div>
                <ul className="space-y-2">
                  {byDepth.get(depth)!.map((n) => {
                    const d = statusOf(n.id);
                    const tone = d?.is_outdated ? 'bg-ember-500' : (d ? STATUS_TONE[d.status] : 'bg-white/15');
                    return (
                      <li key={n.id} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${tone}`} />
                          <span className="truncate text-sm text-white">{n.title}</span>
                        </div>
                        {d && (
                          <div className="mt-1 ml-4 font-mono text-[10px] uppercase tracking-wider text-[var(--showcase-ink-dim)]">
                            {d.is_outdated ? 'overdue' : prettyLabel(d.status)}
                            {d.due_date ? ` · ${d.due_date}` : ''}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* 5. Team — allocated members with role & date window                         */
/* ========================================================================= */

function TeamScene({ data }: { data: SceneData }) {
  const { allocations, users } = data;
  // Collapse multiple allocations per user into one row, keeping each role.
  const byUser = new Map<string, { user_id: string; roles: Set<string>; latestEnd: string | null }>();
  for (const a of allocations) {
    const cur = byUser.get(a.user_id) ?? { user_id: a.user_id, roles: new Set<string>(), latestEnd: null };
    if (a.role_description) cur.roles.add(a.role_description);
    if (!cur.latestEnd || (a.end_date && a.end_date > cur.latestEnd)) cur.latestEnd = a.end_date;
    byUser.set(a.user_id, cur);
  }
  const rows = [...byUser.values()];

  return (
    <div className="grid h-full grid-rows-[auto_1fr] gap-6">
      <div className="scene-enter">
        <div className="label-caps !text-[var(--showcase-ink-dim)]">Team on this engagement</div>
        <div className="mt-1 flex flex-wrap items-baseline gap-4">
          <h2 className="display-num text-[clamp(2rem,4.5vw,3.5rem)] font-semibold text-white">
            {rows.length} {rows.length === 1 ? 'person' : 'people'}
          </h2>
          <span className="font-mono text-sm text-[var(--showcase-ink-dim)]">
            {allocations.length} active allocations
          </span>
        </div>
      </div>

      <div className="scene-enter scene-enter-delay-1 min-h-0 overflow-auto">
        {rows.length === 0 ? (
          <div className="grid h-full place-items-center text-[var(--showcase-ink-dim)]">
            No one is currently allocated to this project.
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => {
              const u = users.get(r.user_id);
              const display = u?.full_name || u?.email || r.user_id;
              const initials = display
                .split(/[\s.]+/)
                .map((p) => p[0])
                .filter(Boolean)
                .slice(0, 2)
                .join('')
                .toUpperCase();
              return (
                <li key={r.user_id} className="glass scanline-host flex items-center gap-3 p-4">
                  <span
                    aria-hidden
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-gradient-to-br from-brand-500 to-violet-500 font-mono text-sm font-bold text-white ring-1 ring-white/20"
                  >
                    {initials || '·'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-white">{display}</div>
                    <div className="truncate font-mono text-[11px] text-[var(--showcase-ink-dim)]">
                      {u ? roleLabel(u.role) : '—'}
                      {r.latestEnd ? ` · through ${r.latestEnd}` : ''}
                    </div>
                    {r.roles.size > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {[...r.roles].slice(0, 3).map((role) => (
                          <span key={role} className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-white/80 ring-1 ring-inset ring-white/10">
                            {role}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ========================================================================= */
/* 6. Budget — burn ring + spend bar                                           */
/* ========================================================================= */

function BudgetScene({ data }: { data: SceneData }) {
  const b = data.budget;
  const planned  = b?.budget_amount ? parseFloat(b.budget_amount) : 0;
  const consumed = b ? parseFloat(b.amount_consumed) : 0;
  const ccy = b?.budget_currency || 'USD';
  const pct = planned > 0 ? (consumed / planned) * 100 : 0;
  const charges = b?.charges ?? [];
  const tone: 'brand' | 'jade' | 'amber' | 'ember' =
    !planned       ? 'brand' :
    pct > 100      ? 'ember' :
    pct > 85       ? 'amber' :
                     'jade';

  return (
    <div className="grid h-full grid-cols-1 items-center gap-12 lg:grid-cols-[auto_1fr]">
      <div className="scene-enter mx-auto">
        <RadialGauge value={Math.min(pct, 100)} size={340} tone={tone}>
          <div className="display-num text-[clamp(2.5rem,7vw,5rem)] font-semibold text-white">
            {planned > 0 ? `${Math.round(pct)}` : '—'}
            {planned > 0 && <span className="ml-1 align-top text-2xl text-[var(--showcase-ink-dim)]">%</span>}
          </div>
          <div className="mt-1 label-caps !text-[var(--showcase-ink-dim)]">consumed</div>
        </RadialGauge>
      </div>

      <div className="space-y-5">
        <div className="scene-enter">
          <div className="label-caps !text-[var(--showcase-ink-dim)]">Budget burn</div>
          {planned > 0 ? (
            <h2 className="mt-1 display-num text-[clamp(2rem,4.5vw,3.5rem)] font-semibold text-white">
              {fmtMoney(consumed, ccy)}
              <span className="ml-3 text-[var(--showcase-ink-dim)]">of {fmtMoney(planned, ccy)}</span>
            </h2>
          ) : (
            <h2 className="mt-1 display-num text-[clamp(2rem,4.5vw,3.5rem)] font-semibold text-white">
              {fmtMoney(consumed, ccy)} spent
              <span className="ml-3 text-base text-[var(--showcase-ink-dim)]">no ceiling set</span>
            </h2>
          )}
        </div>

        {planned > 0 && (
          <div className="scene-enter scene-enter-delay-1">
            <div className="h-4 overflow-hidden rounded-full bg-white/8 ring-1 ring-inset ring-white/10">
              <div
                className={`h-full rounded-full ${
                  pct > 100 ? 'bg-ember-500' : pct > 85 ? 'bg-amber-500' : 'bg-jade-500'
                }`}
                style={{ width: `${Math.min(pct, 100)}%`, transition: 'width 900ms cubic-bezier(0.2,0.6,0.2,1)' }}
              />
            </div>
            <div className="mt-1 flex justify-between font-mono text-xs text-[var(--showcase-ink-dim)]">
              <span>0</span>
              <span>{pct > 100 ? `+${Math.round(pct - 100)}% over` : `${Math.round(100 - pct)}% headroom`}</span>
              <span>{fmtMoney(planned, ccy)}</span>
            </div>
          </div>
        )}

        <div className="scene-enter scene-enter-delay-2 glass max-h-64 overflow-auto p-4">
          <div className="label-caps !text-[var(--showcase-ink-dim)] mb-2">Top charges ({charges.length})</div>
          {charges.length === 0 ? (
            <div className="py-2 text-sm text-[var(--showcase-ink-dim)]">No equipment charges against this budget yet.</div>
          ) : (
            <ul className="divide-y divide-white/8">
              {charges
                .slice()
                .sort((a, b) => (parseFloat(b.cost ?? '0') || 0) - (parseFloat(a.cost ?? '0') || 0))
                .slice(0, 6)
                .map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="truncate text-white">{c.name}</div>
                      <div className="truncate font-mono text-[10px] uppercase tracking-wider text-[var(--showcase-ink-dim)]">
                        {c.kind} · {prettyLabel(c.approval_status)}
                      </div>
                    </div>
                    <div className="font-mono tnum text-white">
                      {c.cost ? fmtMoney(parseFloat(c.cost), c.currency || ccy) : '—'}
                    </div>
                  </li>
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================================================================= */
/* Final scene registry                                                        */
/* ========================================================================= */

export const SHOWCASE_SCENES: SceneDef[] = [
  { id: 'overview',   title: 'Overview',     subtitle: 'The project at a glance',          render: (d) => <OverviewScene data={d} /> },
  { id: 'health',     title: 'Health pulse', subtitle: 'Status of every deliverable',      render: (d) => <HealthScene data={d} /> },
  { id: 'completion', title: 'Completion',   subtitle: 'How much is shipped',              render: (d) => <CompletionScene data={d} /> },
  { id: 'chain',      title: 'Dependencies', subtitle: 'What blocks what',                 render: (d) => <DependencyScene data={d} /> },
  { id: 'team',       title: 'Team',         subtitle: 'Who is staffed and through when',  render: (d) => <TeamScene data={d} /> },
  { id: 'budget',     title: 'Budget',       subtitle: 'Spend against the ceiling',        render: (d) => <BudgetScene data={d} /> },
];

/* Helper exported so the picker can link to a scene with a deep link if we
 * ever want to add `#scene=health` style nav. Not used today. */
export function findScene(id: string | undefined): SceneDef | undefined {
  return SHOWCASE_SCENES.find((s) => s.id === id);
}

/* Re-export so the picker can render a deep-link to viewer-friendly reports.
 * Not used by the scenes themselves; just convenient to centralise here. */
export { Link as RouterLink };




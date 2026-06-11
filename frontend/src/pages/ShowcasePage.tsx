import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi, type ListResponse } from '../services/apiClient';
import { useRole } from '../auth/useRole';
import { homeForRole } from '../auth/session';
import type {
  Allocation,
  Deliverable,
  Equipment,
  Project,
  ProjectBudget,
  User,
} from '../types/api';
import type { SceneData } from '../components/showcase/sceneTypes';
import { SHOWCASE_SCENES } from '../components/showcase/scenes';
import { prettyLabel } from '../utils/labels';

/**
 * ShowcasePage — the cinematic "Big Picture" experience.
 *
 * Viewers land here by default (`homeForRole` maps `viewer` → `/showcase`);
 * any signed-in user with team_lead / team_member / viewer role can visit.
 *
 * Two modes share this component:
 *  - `/showcase`             → ShowcasePicker: select a project
 *  - `/showcase/:projectId`  → ShowcaseStage:  rotating scene player
 *
 * Both are wrapped in `<KioskShell />` which paints the dark canvas and
 * owns the persistent exit button. No app sidebar / topbar surrounds this
 * route — `AppLayout` short-circuits when the path starts with `/showcase`.
 *
 * ## Data discipline
 *
 * Every fetch on this page is a plain GET against an existing endpoint.
 * No new endpoint is invented and no mutations are fired — the showcase is
 * a strictly read-only surface. Failures are tolerated per-fetch so the
 * scene that depends on a missing slice degrades gracefully.
 */
export function ShowcasePage() {
  const { projectId } = useParams<{ projectId: string }>();
  return projectId ? <ShowcaseStage projectId={projectId} /> : <ShowcasePicker />;
}

/* ============================================================================
 * Kiosk shell — common dark canvas + exit affordance.
 * ========================================================================== */

function KioskShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const role = useRole();
  // "Exit" returns to the role-default home. For viewers that's /showcase
  // itself; from a stage that's the picker; from the picker we still want to
  // give them somewhere to land, so fall back to /reports.
  const exitTo = useMemo(() => {
    const home = homeForRole(role);
    return home === '/showcase' ? '/reports' : home;
  }, [role]);

  return (
    <div className="showcase-root">
      {/*
        Exit chip is `fixed` (not absolute) so it stays glued to the
        viewport corner regardless of which scene mounts, of any nested
        overflow contexts, or of mobile virtual-keyboard reflow.
        Position respects iOS / Android safe-area insets so the chip is
        never clipped under a notch, rounded corner, or rotation bar.
        Sizing scales down on very narrow screens so the affordance stays
        fully on-canvas even at ~320 px wide.
      */}
      <button
        type="button"
        onClick={() => navigate(exitTo)}
        title="Exit big-picture mode (Esc)"
        aria-label="Exit big-picture mode"
        // `kiosk-exit` opts this chip out of the
        // `.showcase-root > * { position: relative }` lift rule in
        // index.css — without it, that selector wins on specificity and
        // forces `position: relative`, dropping the chip back into the
        // document flow (it would appear at the top-left, offset by
        // `right`, instead of pinned to the viewport corner).
        className="kiosk-exit fixed z-30 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider text-white/85 shadow-lg shadow-black/30 backdrop-blur transition-colors hover:bg-white/20 focus-visible:bg-white/20 sm:gap-2 sm:px-3 sm:py-1.5 sm:text-xs"
        style={{
          top: 'max(0.5rem, env(safe-area-inset-top))',
          right: 'max(0.5rem, env(safe-area-inset-right))',
        }}
      >
        <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 5l10 10M15 5L5 15" />
        </svg>
        Exit
      </button>
      {children}
    </div>
  );
}

/* ============================================================================
 * ShowcasePicker — project chooser. Big tiles, mini health barcode each.
 * ========================================================================== */

interface PickerThumb {
  project: Project;
  deliverables: Deliverable[];
}

function ShowcasePicker() {
  const { apiGet } = useApi();
  const [thumbs, setThumbs] = useState<PickerThumb[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiGet<ListResponse<Project>>('/projects-service?limit=100'),
      // Pull a generous deliverables window so we can paint the per-project
      // health micro-strip without one fetch per tile.
      apiGet<ListResponse<Deliverable>>('/deliverables-service?limit=500').catch(
        () => ({ data: [] as Deliverable[], meta: { total: 0, limit: 0, offset: 0 } }),
      ),
    ])
      .then(([projects, deliverables]) => {
        if (cancelled) return;
        const byProject = new Map<string, Deliverable[]>();
        for (const d of deliverables.data) {
          const arr = byProject.get(d.project_id) ?? [];
          arr.push(d);
          byProject.set(d.project_id, arr);
        }
        setThumbs(
          projects.data.map((p) => ({ project: p, deliverables: byProject.get(p.id) ?? [] })),
        );
      })
      .catch((e: Error) => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, [apiGet]);

  const filtered = useMemo(() => {
    if (!thumbs) return null;
    const q = query.trim().toLowerCase();
    if (!q) return thumbs;
    return thumbs.filter(
      (t) =>
        t.project.name.toLowerCase().includes(q) ||
        t.project.status.toLowerCase().includes(q),
    );
  }, [thumbs, query]);

  return (
    <KioskShell>
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col gap-10 px-4 py-10 pr-16 sm:px-10 sm:py-16 sm:pr-20 md:pr-10">
        {/* ---- Hero ----------------------------------------------------- */}
        <header className="scene-enter">
          <div className="label-caps !text-[var(--showcase-ink-dim)]">Big-picture mode</div>
          <h1 className="mt-2 display-num text-[clamp(2rem,7vw,5.5rem)] font-semibold leading-[1.05] text-white">
            Choose a project
          </h1>
          <p className="mt-3 max-w-2xl text-base text-[var(--showcase-ink-dim)]">
            Pick any engagement to enter its cinematic dashboard. Six scenes will rotate through —
            overview, health, completion, dependencies, team and budget — auto-advancing every twelve
            seconds. Use <Kbd>←</Kbd> / <Kbd>→</Kbd> to step, <Kbd>Space</Kbd> to pause, <Kbd>Esc</Kbd> to exit.
          </p>
        </header>

        {/* ---- Search --------------------------------------------------- */}
        <div className="scene-enter scene-enter-delay-1">
          <label className="relative block max-w-md">
            <span className="sr-only">Search projects</span>
            <input
              type="text"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects…"
              className="w-full rounded-full border border-white/15 bg-white/5 px-5 py-3 text-white placeholder:text-white/40 outline-none ring-0 focus:border-white/40"
            />
          </label>
        </div>

        {/* ---- Grid ----------------------------------------------------- */}
        <div className="scene-enter scene-enter-delay-2">
          {err && (
            <div className="rounded-lg border border-ember-500/40 bg-ember-500/10 px-4 py-3 text-sm text-ember-100">
              Couldn't load projects: {err}
            </div>
          )}
          {!err && !filtered && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="glass h-40 animate-pulse" aria-hidden />
              ))}
            </div>
          )}
          {filtered && filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/5 p-10 text-center text-[var(--showcase-ink-dim)]">
              No projects match "{query}".
            </div>
          )}
          {filtered && filtered.length > 0 && (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map(({ project, deliverables }) => (
                <li key={project.id}>
                  <PickerTile project={project} deliverables={deliverables} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </KioskShell>
  );
}

function PickerTile({ project, deliverables }: { project: Project; deliverables: Deliverable[] }) {
  const overdue = deliverables.filter((d) => d.is_outdated).length;
  const done    = deliverables.filter((d) => d.status === 'done').length;
  const total   = deliverables.length;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <Link
      to={`/showcase/${project.id}`}
      className="group block h-full rounded-2xl border border-white/10 bg-gradient-to-br from-white/[0.04] to-white/[0.015] p-5 transition-all hover:border-white/30 hover:from-white/[0.08]"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg font-semibold text-white">{project.name}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-[var(--showcase-ink-dim)]">
            <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${
              project.status === 'active'    ? 'bg-jade-500' :
              project.status === 'on_hold'   ? 'bg-amber-500' :
              project.status === 'cancelled' ? 'bg-ember-500' :
              project.status === 'done'      ? 'bg-white/50' :
                                               'bg-brand-300'
            }`} />
            <span>{prettyLabel(project.status)}</span>
            {project.target_end_date && (
              <span className="font-mono">· target {project.target_end_date}</span>
            )}
          </div>
        </div>
        {overdue > 0 && (
          <span className="shrink-0 rounded-full bg-ember-500/15 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ember-200 ring-1 ring-inset ring-ember-500/40">
            {overdue} overdue
          </span>
        )}
      </div>

      {/* Mini health barcode */}
      <div className="mt-4">
        {total === 0 ? (
          <div className="grid h-2.5 place-items-center rounded-full bg-white/5 text-[10px] text-white/30">
            no deliverables
          </div>
        ) : (
          <div className="flex h-2.5 overflow-hidden rounded-full ring-1 ring-inset ring-white/10">
            {deliverables.map((d) => {
              const tone =
                d.is_outdated         ? 'bg-ember-500' :
                d.status === 'done'   ? 'bg-jade-500'  :
                d.status === 'in_progress' ? 'bg-brand-500' :
                d.status === 'blocked' ? 'bg-amber-500' :
                                         'bg-white/15';
              return (
                <div key={d.id} className={`${tone} h-full`} style={{ width: `${100 / total}%` }} />
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="display-num text-2xl text-white">{pct}%</div>
          <div className="label-caps !text-[var(--showcase-ink-dim)]">complete</div>
        </div>
        <span className="inline-flex items-center gap-1 text-xs text-white/70 transition-transform group-hover:translate-x-1">
          Open
          <svg viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 10h10M11 6l4 4-4 4" />
          </svg>
        </span>
      </div>
    </Link>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-white/20 bg-white/5 px-1.5 py-0.5 font-mono text-[11px] text-white/80">
      {children}
    </kbd>
  );
}

/* ============================================================================
 * ShowcaseStage — scene rotator for one project.
 * ========================================================================== */

const SCENE_DURATION_MS = 12_000;

function ShowcaseStage({ projectId }: { projectId: string }) {
  const { apiGet } = useApi();
  const navigate = useNavigate();

  const [data, setData] = useState<SceneData | null>(null);
  const [err,  setErr]  = useState<string | null>(null);

  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  /** Bumped on every scene change so the progress bar CSS animation restarts. */
  const [tick, setTick] = useState(0);

  /* ---- data fetch — once on mount + on projectId change ----------------- */

  useEffect(() => {
    let cancelled = false;
    setData(null); setErr(null); setIndex(0);

    (async () => {
      try {
        // Project + all the per-project slices in parallel. Each catch keeps
        // the page rendering even if one slice is unavailable.
        const [project, deliverables, allocations, equipment, users, budget, completion, chain] = await Promise.all([
          apiGet<Project>(`/projects-service/${encodeURIComponent(projectId)}`),
          apiGet<ListResponse<Deliverable>>(`/deliverables-service?project_id=${encodeURIComponent(projectId)}&limit=200`)
            .then((r) => r.data).catch(() => [] as Deliverable[]),
          apiGet<ListResponse<Allocation>>(`/allocations-service?project_id=${encodeURIComponent(projectId)}&limit=200`)
            .then((r) => r.data).catch(() => [] as Allocation[]),
          apiGet<ListResponse<Equipment>>(`/equipment-service?assigned_project_id=${encodeURIComponent(projectId)}&limit=200`)
            .then((r) => r.data).catch(() => [] as Equipment[]),
          apiGet<ListResponse<User>>('/resources-service?limit=200')
            .then((r) => r.data).catch(() => [] as User[]),
          apiGet<ProjectBudget>(`/budget-service?project_id=${encodeURIComponent(projectId)}`)
            .catch(() => null),
          apiGet<{ data: { project_id: string; total: number; completed: number; percent_complete: number } }>(
            `/reports-service/deliverable-completion?project_id=${encodeURIComponent(projectId)}`,
          )
            .then((r) => r.data).catch(() => null),
          apiGet<{ data: { id: string; title: string; depends_on: string | null; depth: number }[] }>(
            `/reports-service/deliverable-chain?project_id=${encodeURIComponent(projectId)}`,
          )
            .then((r) => r.data).catch(() => []),
        ]);

        if (cancelled) return;
        const userMap = new Map<string, User>();
        for (const u of users) userMap.set(u.id, u);

        setData({
          project,
          deliverables,
          allocations,
          users: userMap,
          equipment,
          budget,
          completion,
          chain,
        });
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { cancelled = true; };
  }, [apiGet, projectId]);

  /* ---- scene rotator timer --------------------------------------------- */

  const total = SHOWCASE_SCENES.length;
  const advance = useCallback((delta: number) => {
    setIndex((i) => (i + delta + total) % total);
    setTick((t) => t + 1);
  }, [total]);
  const jumpTo = useCallback((i: number) => {
    setIndex(((i % total) + total) % total);
    setTick((t) => t + 1);
  }, [total]);

  useEffect(() => {
    if (paused || !data) return;
    const id = window.setTimeout(() => advance(1), SCENE_DURATION_MS);
    return () => window.clearTimeout(id);
  }, [paused, data, tick, advance]);

  /* ---- keyboard controls ------------------------------------------------ */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape')      navigate('/showcase');
      else if (e.key === 'ArrowRight') advance(1);
      else if (e.key === 'ArrowLeft')  advance(-1);
      else if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, navigate]);

  /* ---- render ----------------------------------------------------------- */

  if (err) {
    return (
      <KioskShell>
        <div className="grid min-h-[100dvh] place-items-center px-6">
          <div className="glass max-w-md p-6 text-center">
            <div className="label-caps !text-[var(--showcase-ink-dim)]">Showcase unavailable</div>
            <p className="mt-2 text-white">{err}</p>
            <Link
              to="/showcase"
              className="mt-4 inline-block rounded-full border border-white/20 bg-white/5 px-4 py-1.5 text-sm text-white hover:bg-white/10"
            >
              ← Back to projects
            </Link>
          </div>
        </div>
      </KioskShell>
    );
  }

  if (!data) {
    return (
      <KioskShell>
        <div className="grid min-h-[100dvh] place-items-center">
          <div className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
            <div className="label-caps !text-[var(--showcase-ink-dim)]">Booting the showcase…</div>
          </div>
        </div>
      </KioskShell>
    );
  }

  const current = SHOWCASE_SCENES[index] ?? SHOWCASE_SCENES[0]!;

  return (
    <KioskShell>
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-7xl flex-col gap-6 px-4 py-4 pr-16 sm:px-10 sm:py-10 sm:pr-20 md:pr-10">
        {/* ---- Stage header ------------------------------------------- */}
        <StageHeader
          projectName={data.project.name}
          title={current.title}
          subtitle={current.subtitle}
          index={index}
          total={total}
        />

        {/* ---- Scene canvas (re-mounted per scene so .scene-enter fires) - */}
        <div key={`${current.id}-${tick}`} className="min-h-0 flex-1">
          {current.render(data)}
        </div>

        {/* ---- Footer dock: progress bar + dots + controls ---------------- */}
        <StageDock
          scenes={SHOWCASE_SCENES.map((s) => s.title)}
          currentIndex={index}
          paused={paused}
          onPrev={() => advance(-1)}
          onNext={() => advance(1)}
          onTogglePause={() => setPaused((p) => !p)}
          onJump={jumpTo}
          progressKey={tick}
          durationMs={SCENE_DURATION_MS}
        />
      </div>
    </KioskShell>
  );
}

/* ============================================================================
 * Sub-components: stage chrome
 * ========================================================================== */

function StageHeader({
  projectName, title, subtitle, index, total,
}: { projectName: string; title: string; subtitle: string; index: number; total: number }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <div className="min-w-0 flex-1">
        <div className="label-caps !text-[var(--showcase-ink-dim)] truncate">{projectName}</div>
        <h1 className="mt-1 display-num text-[clamp(1.25rem,3vw,2.25rem)] font-semibold leading-tight text-white">
          {title}
        </h1>
        <p className="mt-0.5 text-sm text-[var(--showcase-ink-dim)]">{subtitle}</p>
      </div>
      <div className="shrink-0 font-mono text-sm tabular-nums text-white/70">
        {String(index + 1).padStart(2, '0')} <span className="text-white/30">/ {String(total).padStart(2, '0')}</span>
      </div>
    </header>
  );
}

function StageDock({
  scenes, currentIndex, paused, onPrev, onNext, onTogglePause, onJump, progressKey, durationMs,
}: {
  scenes: string[];
  currentIndex: number;
  paused: boolean;
  onPrev: () => void;
  onNext: () => void;
  onTogglePause: () => void;
  onJump: (i: number) => void;
  progressKey: number;
  durationMs: number;
}) {
  // Restart the progress bar by remounting it whenever progressKey changes.
  // Style the width animation inline so it picks up the duration from JS.
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    el.style.animation = 'none';
    // Force reflow so the browser commits the reset before re-applying.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    el.offsetHeight;
    el.style.animation = `showcaseProgress ${durationMs}ms linear forwards`;
    el.style.animationPlayState = paused ? 'paused' : 'running';
  }, [progressKey, paused, durationMs]);

  return (
    <div className="space-y-3">
      {/* Progress bar (drains per scene) */}
      <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/10">
        <div ref={barRef} className="h-full rounded-full bg-white/70" />
      </div>

      {/* Dots + controls */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <ol className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Scenes">
          {scenes.map((title, i) => {
            const active = i === currentIndex;
            return (
              <li key={title}>
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-label={`Scene ${i + 1}: ${title}`}
                  onClick={() => onJump(i)}
                  className={`group inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-wider transition-colors ${
                    active
                      ? 'border-white/40 bg-white/10 text-white'
                      : 'border-white/10 text-white/50 hover:border-white/25 hover:text-white/80'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-white soft-pulse' : 'bg-white/40'}`}
                  />
                  <span className="hidden sm:inline">{title}</span>
                  <span className="sm:hidden">{i + 1}</span>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="flex items-center gap-1">
          <DockButton onClick={onPrev} title="Previous scene (←)">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5l-5 5 5 5" />
            </svg>
          </DockButton>
          <DockButton onClick={onTogglePause} title={paused ? 'Resume (Space)' : 'Pause (Space)'}>
            {paused ? (
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M6 4l11 6-11 6z" />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <rect x="5" y="4" width="3.5" height="12" rx="1" />
                <rect x="11.5" y="4" width="3.5" height="12" rx="1" />
              </svg>
            )}
          </DockButton>
          <DockButton onClick={onNext} title="Next scene (→)">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 5l5 5-5 5" />
            </svg>
          </DockButton>
        </div>
      </div>
    </div>
  );
}

function DockButton({ children, onClick, title }: { children: React.ReactNode; onClick: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
    >
      {children}
    </button>
  );
}



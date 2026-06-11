import type { Allocation, Deliverable, Equipment, Project, ProjectBudget, User } from '../../types/api';

/**
 * Aggregated data feed for every showcase scene.
 *
 * `ShowcaseStage` fetches the underlying endpoints once on mount and hands
 * the same `SceneData` object to every scene. Scenes are pure functions of
 * this data — they fire no requests, mutate nothing.
 *
 * Most fields are optional because the stage degrades gracefully: a scene
 * still renders (with an empty-state) when its backing endpoint failed,
 * which can happen for viewers if a service rejects an unexpected query
 * shape. The pickers and per-project endpoints listed in `ReportsPage`
 * already work for viewers on the existing backend.
 */
export interface SceneData {
  project: Project;
  deliverables: Deliverable[];
  allocations: Allocation[];
  /** Resolved User rows for every user referenced by `allocations`. */
  users: Map<string, User>;
  budget: ProjectBudget | null;
  equipment: Equipment[];
  completion: { total: number; completed: number; percent_complete: number } | null;
  /** Deliverable-id keyed depth map from `/reports-service/deliverable-chain`. */
  chain: { id: string; title: string; depends_on: string | null; depth: number }[];
}

/** Metadata for one scene in the rotator strip. */
export interface SceneDef {
  /** Stable id, used as React key and in the dot strip aria-labels. */
  id: string;
  /** Short title shown in the kiosk topbar. */
  title: string;
  /** One-line subtitle, e.g. "Schedule and milestones at a glance". */
  subtitle: string;
  /** The actual scene renderer. */
  render: (data: SceneData) => React.ReactNode;
}


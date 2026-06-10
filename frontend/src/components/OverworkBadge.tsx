import type { User } from '../types/api';

/**
 * Inline badge that surfaces the server-computed `is_overworked` flag from
 * resources-service.  Shown next to a user's name in any picker or roster
 * so leads can see at a glance who is already at capacity.
 *
 * Renders nothing when the user is not overworked (or the flag is missing).
 */
export function OverworkBadge({ user }: { user: User }) {
  if (!user.is_overworked) return null;

  const projects = user.active_project_count ?? 0;
  const deliverables = user.active_deliverable_count ?? 0;
  return (
    <span
      className="ml-1 inline-flex items-center gap-0.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-800"
      title={`Overworked: ${projects} active project${projects === 1 ? '' : 's'}, ${deliverables} open deliverable${deliverables === 1 ? '' : 's'}`}
    >
      ⚠ overworked
    </span>
  );
}

/**
 * Plain-text variant used inside <option> elements where JSX badges can't
 * render (a <select> only accepts text children).  Suffixed with the same
 * tooltip-friendly summary so leads see the warning in the dropdown itself.
 */
export function overworkSuffix(user: User): string {
  if (!user.is_overworked) return '';
  const projects = user.active_project_count ?? 0;
  const deliverables = user.active_deliverable_count ?? 0;
  return ` ⚠ overworked (${projects}p / ${deliverables}d)`;
}


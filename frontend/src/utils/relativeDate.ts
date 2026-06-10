/**
 * Format a due date as a short relative string, Linear-style:
 *   today        -> "Due today"
 *   tomorrow     -> "Due tomorrow"
 *   within a week-> "Due Fri"
 *   further out  -> "In 12d"
 *   in the past  -> "Overdue 2d"
 * Returns `{ text, overdue }` so callers can color past-due dates red.
 */
export function formatRelativeDue(due: string | null): { text: string; overdue: boolean } | null {
  if (!due) return null;
  const target = new Date(due + 'T00:00:00');
  if (Number.isNaN(target.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const msPerDay = 86_400_000;
  const diffDays = Math.round((target.getTime() - today.getTime()) / msPerDay);

  if (diffDays < 0) {
    const n = Math.abs(diffDays);
    return { text: `Overdue ${n}d`, overdue: true };
  }
  if (diffDays === 0) return { text: 'Due today', overdue: false };
  if (diffDays === 1) return { text: 'Due tomorrow', overdue: false };
  if (diffDays <= 6) {
    const weekday = target.toLocaleDateString(undefined, { weekday: 'short' });
    return { text: `Due ${weekday}`, overdue: false };
  }
  return { text: `In ${diffDays}d`, overdue: false };
}

/**
 * Shared labour-cost helpers used by AllocationsPanel and BudgetPanel.
 *
 * Baseline: every team member / team lead costs $100/h at 40 h/week
 * ($4,000/week, ~$571/day on a 7-day calendar basis).
 *
 * Cost is computed **day by day**: for each calendar day in an allocation the
 * daily rate is divided by however many approved allocations the same user has
 * active on that specific day.  This means a person who is on three projects
 * simultaneously pays 1/3 of their daily rate to each of those projects on
 * the overlap days, while days where they are solely on one project carry the
 * full rate.
 */

import type { Allocation } from '../types/api';

/** Hourly rate applied to every team member and team lead (USD). */
export const HOURLY_RATE_USD = 100;

/** Standard working hours per week used as the capacity baseline. */
export const HOURS_PER_WEEK = 40;

/** Full weekly cost at 100 % capacity ($100 × 40 h = $4,000). */
export const WEEKLY_COST_FULL = HOURLY_RATE_USD * HOURS_PER_WEEK;

/** Daily baseline cost (calendar day, not working day). */
export const DAILY_RATE = WEEKLY_COST_FULL / 7;

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Min and max concurrent project count observed across the allocation window.
 * Used to populate informative tooltips in the UI.
 */
export interface ConcurrencyStats {
  min: number;
  max: number;
}

/**
 * Compute the labour cost in USD for a single allocation using per-day
 * concurrency splitting.
 *
 * For each calendar day inside `allocation.start_date … allocation.end_date`
 * the function counts how many of the user's `allUserAllocations` are also
 * active on that day, then charges `DAILY_RATE / concurrent` to this project.
 *
 * @param allocation         - The allocation row to price.
 * @param allUserAllocations - Every approved allocation belonging to the same
 *                             user (must include `allocation` itself so the
 *                             minimum concurrent count is 1).
 * @returns Cost in USD as a floating-point number.
 */
export function computeLaborCost(
  allocation: Allocation,
  allUserAllocations: Allocation[],
): number {
  const startMs = new Date(allocation.start_date).getTime();
  const endMs = new Date(allocation.end_date).getTime();

  // Pre-parse sibling allocations once to avoid repeated Date construction.
  const siblings = allUserAllocations.map((a) => ({
    start: new Date(a.start_date).getTime(),
    end: new Date(a.end_date).getTime(),
  }));

  let totalCost = 0;
  for (let dayMs = startMs; dayMs <= endMs; dayMs += MS_PER_DAY) {
    const concurrent = siblings.filter(
      (s) => dayMs >= s.start && dayMs <= s.end,
    ).length;
    totalCost += DAILY_RATE / Math.max(1, concurrent);
  }
  return totalCost;
}

/**
 * Return the minimum and maximum number of concurrent active allocations the
 * user had on any single day within this allocation's window.  Used to build
 * informative tooltip text.
 *
 * @param allocation         - The allocation whose window is inspected.
 * @param allUserAllocations - Every approved allocation for the same user.
 */
export function getConcurrencyStats(
  allocation: Allocation,
  allUserAllocations: Allocation[],
): ConcurrencyStats {
  const startMs = new Date(allocation.start_date).getTime();
  const endMs = new Date(allocation.end_date).getTime();

  const siblings = allUserAllocations.map((a) => ({
    start: new Date(a.start_date).getTime(),
    end: new Date(a.end_date).getTime(),
  }));

  let min = Infinity;
  let max = 0;
  for (let dayMs = startMs; dayMs <= endMs; dayMs += MS_PER_DAY) {
    const concurrent = siblings.filter(
      (s) => dayMs >= s.start && dayMs <= s.end,
    ).length;
    if (concurrent < min) min = concurrent;
    if (concurrent > max) max = concurrent;
  }
  return { min: min === Infinity ? 1 : min, max: Math.max(1, max) };
}

/** Format a USD dollar amount with no cents for display. */
export function formatUsd(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}



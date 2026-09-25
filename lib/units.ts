// SUM_VALUE / SUM_VALUE_GROUPED checks store DETAILS.sum_column naming the raw
// column that was summed (e.g. "SPEND_IN_MICRO_DOLLAR"). Values summed from a
// *_MICRO_DOLLAR column are stored in micro-dollars (1,000,000 = $1) and must be
// converted to dollars before display -- otherwise a value like 7,632,812,946
// (= $7,632.81) reads as "7632.8M" once formatTick abbreviates it, off by ~1e6x.
const MICRO_DOLLAR_SUFFIX = /_MICRO_DOLLAR$/i

export function isMicroDollarColumn(sumColumn: string | null | undefined): boolean {
  return !!sumColumn && MICRO_DOLLAR_SUFFIX.test(sumColumn)
}

export function normalizeMicroDollars<T extends number | null | undefined>(
  value: T,
  sumColumn: string | null | undefined
): T {
  if (value == null) return value
  if (!isMicroDollarColumn(sumColumn)) return value
  return (value / 1_000_000) as T
}

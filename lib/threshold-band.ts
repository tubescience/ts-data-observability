// Different check types encode their actual pass/fail band differently in DETAILS.
// This picks the right interpretation instead of assuming a single formula:
//
//   1. ROW_COUNT/VOLUME baseline-mode checks compute their own lower/upper bound
//      and store it directly -- just read it back, no need to re-derive it.
//   2. SUM_VALUE_GROUPED's day-of-week baseline anomaly check flags results with
//      |z-score| >= 3 from the DOW mean -- confirmed empirically against 399 recent
//      PASS/ANOMALY results (clean cutoff, no ambiguous cases). That's the real band,
//      not the historical THRESHOLD column (which is just yesterday's raw value).
//   3. SUM_VALUE_GROUPED falls back to a plain day-over-day +/- pct band when it
//      doesn't have enough day-of-week history yet to compute a baseline.
//
// Anything else (FRESHNESS, ROW_COUNT's plain PASS/FAIL mode, etc.) returns nulls,
// meaning the caller should fall back to displaying the raw threshold value as-is.
export interface ThresholdBandInputs {
  lower: number | null
  upper: number | null
  dowBaselineMean: number | null
  dowBaselineStd: number | null
  threshold: number | null
  thresholdPct: number | null
}

const DOW_ZSCORE_CUTOFF = 3

export function computeThresholdBand(inputs: ThresholdBandInputs): { min: number | null; max: number | null } {
  const { lower, upper, dowBaselineMean, dowBaselineStd, threshold, thresholdPct } = inputs

  if (lower != null && upper != null) {
    return { min: lower, max: upper }
  }
  if (dowBaselineMean != null && dowBaselineStd != null) {
    return {
      min: dowBaselineMean - DOW_ZSCORE_CUTOFF * dowBaselineStd,
      max: dowBaselineMean + DOW_ZSCORE_CUTOFF * dowBaselineStd,
    }
  }
  if (thresholdPct != null && threshold != null) {
    return {
      min: threshold * (1 - thresholdPct / 100),
      max: threshold * (1 + thresholdPct / 100),
    }
  }
  return { min: null, max: null }
}

# Plan: Account-Level and Client-Level Spend Monitors

## Context

Current spend monitoring is only by platform (FB, SNAP, TIK, etc.) — not by individual ad account or client. There are 218 active accounts across 111 clients.

**Data source:** `TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY` with columns: DATE, ACCOUNT_ID, ACCOUNT_NAME, CLIENT_ID, CLIENT_NAME, PLATFORM, SPEND_USD.

**Historical volume:**
- Account-level: ~20K rows for 3 months (~225 accounts x 90 days)
- Client-level: ~10K rows for 3 months (~112 clients x 90 days)

**Approach:** Store daily aggregated spend in `OBSERVABILITY_METRICS_HISTORY` for trending, then run a daily check that compares yesterday vs day-before (same as the platform check) at both account and client levels. Use a higher threshold (50%) for accounts and 40% for clients (since individual accounts are more volatile than platforms).

## Implementation Steps

### Step 1: Backfill 3 months of historical metrics

Insert aggregated daily spend into `OBSERVABILITY_METRICS_HISTORY`:
- `METRIC_NAME = 'SPEND_ACCOUNT'` with `TARGET_TABLE = account_id`
- `METRIC_NAME = 'SPEND_CLIENT'` with `TARGET_TABLE = client_id::VARCHAR`

This gives us trending data for dashboards and anomaly detection.

### Step 2: Create CHECK_SPEND_BY_ACCOUNT procedure

Logic (same pattern as `CHECK_SPEND_BY_PLATFORM`):
1. For each active account (spent > $100 in last 7 days):
   - Compare yesterday's spend vs day-before
   - FAIL if change > 50% AND day-before spend > $500 (to avoid noise from small accounts)
   - Also FAIL if spend drops to $0 when day-before was > $500
2. Log to OBSERVABILITY_RESULTS with `CHECK_TYPE = 'SPEND_ACCOUNT'`, `GROUP_VALUE = ACCOUNT_ID`
3. Alert on failures via Slack

### Step 3: Create CHECK_SPEND_BY_CLIENT procedure

Same logic but aggregated to client level:
1. For each active client:
   - Compare yesterday's total spend (all accounts) vs day-before
   - FAIL if change > 40% AND day-before spend > $1000
   - Also FAIL if spend drops to $0 when day-before was > $1000
2. Log to OBSERVABILITY_RESULTS with `CHECK_TYPE = 'SPEND_CLIENT'`, `GROUP_VALUE = CLIENT_ID`
3. Alert on failures via Slack

### Step 4: Register monitors and configs

Create monitors and configs in OBSERVABILITY_MONITORS / OBSERVABILITY_CONFIG for:
- Account-level spend monitor
- Client-level spend monitor

### Step 5: Test with current data

Run both procedures and verify results make sense. Check that weekend drops don't over-trigger (may need skip_weekends or a weekend-aware threshold).

## Thresholds

| Level | Change Threshold | Minimum Spend (day-before) | Skip if |
|---|---|---|---|
| Account | 50% | $500 | Account inactive last 7 days |
| Client | 40% | $1,000 | Client inactive last 7 days |

These are higher than the platform threshold (30%) because individual accounts are naturally more volatile.

## Verification

- Historical data: `SELECT COUNT(*) FROM OBSERVABILITY_METRICS_HISTORY WHERE METRIC_NAME IN ('SPEND_ACCOUNT','SPEND_CLIENT')` should show ~30K rows
- Running checks: both procedures return results without excessive false positives
- Scentbird Snap: should now have account-level spend history and monitoring

## Critical Objects

- `TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY` — source table with all spend data
- `TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_METRICS_HISTORY` — historical metrics store
- `TS_INGEST_DB.OBSERVABILITY.CHECK_SPEND_BY_PLATFORM()` — existing reference pattern
- `TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS` — where check results are logged

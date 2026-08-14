# Plan: SRC AD_INSIGHTS Monitors

## Context

7 tables to monitor, each with up to 6 check types:

| Table | Platform | Date Col | Spend Col | Account Col | Freshness Col |
|---|---|---|---|---|---|
| SRC_APPLOVIN_AD_INSIGHTS | APPLOVIN | DAY | (no spend col) | ACCOUNT_ID | _EXTRACTED_AT |
| SRC_APPLOVIN_AD_INSIGHTS_COHORT | APPLOVIN | DAY | (no spend col) | ACCOUNT_ID | _EXTRACTED_AT |
| SRC_FB_AIRBYTE_AD_INSIGHTS | META | DATE_START | SPEND | ACCOUNT_ID | _AIRBYTE_EXTRACTED_AT |
| SRC_NORTHBEAM_AD_INSIGHTS | NORTHBEAM | DATE | SPEND | ACCOUNT_ID | _EXTRACTED_AT |
| SRC_PINTEREST_AD_INSIGHTS | PINTEREST | REPORT_DATE | SPEND_IN_MICRO_DOLLAR | ACCOUNT_ID | _EXTRACTED_AT |
| SRC_SNAPCHAT_AD_INSIGHTS | SNAPCHAT | STAT_DATE | SPEND | ACCOUNT_ID | _EXTRACTED_AT |
| SRC_TIKTOK_AD_INSIGHTS | TIKTOK | STAT_TIME_DAY | SPEND | ACCOUNT_ID | _EXTRACTED_AT |

**Note:** AppLovin tables have no SPEND column at ad level — skip SUM_VALUE checks for those. The SUM_VALUE by client check will JOIN to `SRC_TS_ACCOUNT_LIST` to resolve CLIENT_ID.

## Implementation

### Step 1: Create 7 monitors (one per table)

Each monitor targets one SRC table. Tags follow: `src,{platform}`.

### Step 2: Create configs for each monitor

Per monitor, create configs for:
- **COLUMN_COUNT** — detect schema changes
- **FRESHNESS** — threshold 24h (using _EXTRACTED_AT)
- **ROW_COUNT** — anomaly detection on total row count
- **DATE_GAP** — 7-day lookback, allow 1 missing day
- **SUM_VALUE** (total) — yesterday vs day-before total spend (tag: `src,{platform}`)
- **SUM_VALUE_GROUPED by ACCOUNT_ID** — (tag: `src,{platform},account`)
- **SUM_VALUE_GROUPED by CLIENT_ID** via JOIN — (tag: `src,{platform},client`)

Skip SUM_VALUE checks for AppLovin tables (no spend column).

### Step 3: Create CHECK_SRC_SPEND_BY_ACCOUNT procedure

Dedicated procedure that:
1. Reads config for each SRC table
2. Compares yesterday vs day-before spend grouped by ACCOUNT_ID
3. Uses PST dates
4. Tags results appropriately

### Step 4: Create CHECK_SRC_SPEND_BY_CLIENT procedure

Same but JOINs to `SRC_TS_ACCOUNT_LIST` to resolve CLIENT_ID grouping.

### Step 5: Add to existing RUN_PATTERN_BATCH schedule or create new tasks

## Column Mapping Summary

| Platform | Date | Spend | Freshness |
|---|---|---|---|
| APPLOVIN | DAY | N/A | _EXTRACTED_AT |
| META | DATE_START | SPEND | _AIRBYTE_EXTRACTED_AT |
| NORTHBEAM | DATE | SPEND | _EXTRACTED_AT |
| PINTEREST | REPORT_DATE | SPEND_IN_MICRO_DOLLAR | _EXTRACTED_AT |
| SNAPCHAT | STAT_DATE | SPEND | _EXTRACTED_AT |
| TIKTOK | STAT_TIME_DAY | SPEND | _EXTRACTED_AT |

## Monitors to Create

| Monitor Name | Table | Tags |
|---|---|---|
| SRC AppLovin Ad Insights | SRC_APPLOVIN_AD_INSIGHTS | src,applovin |
| SRC AppLovin Ad Insights Cohort | SRC_APPLOVIN_AD_INSIGHTS_COHORT | src,applovin |
| SRC Meta Ad Insights | SRC_FB_AIRBYTE_AD_INSIGHTS | src,meta |
| SRC Northbeam Ad Insights | SRC_NORTHBEAM_AD_INSIGHTS | src,northbeam |
| SRC Pinterest Ad Insights | SRC_PINTEREST_AD_INSIGHTS | src,pinterest |
| SRC Snapchat Ad Insights | SRC_SNAPCHAT_AD_INSIGHTS | src,snapchat |
| SRC TikTok Ad Insights | SRC_TIKTOK_AD_INSIGHTS | src,tiktok |

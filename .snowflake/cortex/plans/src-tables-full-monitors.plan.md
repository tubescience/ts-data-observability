# Plan: Full SRC Table Monitoring

## Research Findings

### Active Tables by Platform (updated within last 7 days)

**Meta Daily (23 active tables):**
SRC_META_ACCOUNTS, SRC_META_ACCOUNT_CREATIVE_FATIGUE, SRC_META_ACCOUNT_INSIGHTS, SRC_META_ACCOUNT_INSIGHTS_BY_COUNTRY, SRC_META_ADSETS, SRC_META_ADSET_CREATIVE_INSIGHTS, SRC_META_ADS, SRC_META_ADS_INSIGHTS, SRC_META_ADS_INSIGHTS_BY_AGE_GENDER, SRC_META_ADS_INSIGHTS_BY_COUNTRY, SRC_META_ADS_INSIGHTS_BY_PLACEMENT, SRC_META_CAMPAIGNS, SRC_META_CLIENT_INSTAGRAM_ASSETS, SRC_META_CLIENT_PAGES, SRC_META_CUSTOM_CONVERSION_DEFINITIONS, SRC_META_CUSTOM_INSIGHTS_ATTRIBUTION, SRC_META_CUSTOM_INSIGHTS_RF, SRC_META_INSTAGRAM_ACCOUNTS, SRC_META_OWNED_PAGES, SRC_META_PARTNERSHIP_AD_PERMISSIONS, SRC_META_PIXEL_EVENT_STATS, SRC_META_ADS_RAW_SNAPSHOT, SRC_META_PARTNERSHIP_ADS_CONTENT (177h stale but exists)

**Meta Weekly (17 active, 3 deprecated):**
All WEEKLY tables EXCEPT the 3 `_BY_DMA` tables (stale since June 15 -- deprecated).
Active: SRC_META_WEEKLY_{ACCOUNT,ADSET,ADS,CAMPAIGN}_INSIGHTS and their `_BY_{AGE_GENDER,PLACEMENT,REGION}` variants.
Freshness threshold: 192h (8 days) since they run weekly on Sundays.

**Note:** SRC_META_ACCOUNT_ACTIVITIES (193h stale) -- runs weekly, include with 192h threshold.

**AppLovin (12 active, 1 deprecated):**
SRC_APPLOVIN_ACCOUNT_INSIGHTS, SRC_APPLOVIN_ACCOUNT_INSIGHTS_COHORT, SRC_APPLOVIN_AD_INSIGHTS, SRC_APPLOVIN_AD_INSIGHTS_COHORT, SRC_APPLOVIN_ASSET_INSIGHTS, SRC_APPLOVIN_CAMPAIGN_INSIGHTS, SRC_APPLOVIN_CAMPAIGN_INSIGHTS_COHORT, SRC_APPLOVIN_CREATIVE_INSIGHTS_APP, SRC_APPLOVIN_CREATIVE_INSIGHTS_APP_COHORT, SRC_APPLOVIN_CREATIVE_INSIGHTS_WEB, SRC_APPLOVIN_CREATIVE_INSIGHTS_WEB_COHORT, SRC_APPLOVIN_CREATIVE_SET_CAMPAIGN_MAP (weekly)
Deprecated: SRC_APPLOVIN_CREATIVE_INSIGHTS (896h stale)

**Google Ads (10 active, 2 stale):**
SRC_GOOGLE_ACCOUNT_DETAILS, SRC_GOOGLE_ADS, SRC_GOOGLE_AD_GROUPS, SRC_GOOGLE_AD_PERFORMANCE, SRC_GOOGLE_ASSETS, SRC_GOOGLE_ASSET_PERFORMANCE, SRC_GOOGLE_CAMPAIGNS, SRC_GOOGLE_CAMPAIGN_PERFORMANCE
Stale (198h, may be weekly): SRC_GOOGLE_AD_GROUP_CRITERIA, SRC_GOOGLE_AD_PERFORMANCE_PLACEMENT, SRC_GOOGLE_CAMPAIGN_PERFORMANCE_COUNTRY, SRC_GOOGLE_VIDEO_ASSETS

**TikTok (6 active):**
SRC_TIKTOK_ACCOUNT_DETAILS, SRC_TIKTOK_ACCOUNT_INSIGHTS, SRC_TIKTOK_ADGROUPS, SRC_TIKTOK_ADS, SRC_TIKTOK_AD_INSIGHTS, SRC_TIKTOK_CAMPAIGNS

**Snapchat (6 active):**
SRC_SNAPCHAT_ACCOUNT_DETAILS, SRC_SNAPCHAT_ACCOUNT_INSIGHTS, SRC_SNAPCHAT_ADS, SRC_SNAPCHAT_ADSQUADS, SRC_SNAPCHAT_AD_INSIGHTS, SRC_SNAPCHAT_CAMPAIGNS

**Pinterest (6 active):**
SRC_PINTEREST_ACCOUNT_DETAILS, SRC_PINTEREST_ACCOUNT_INSIGHTS, SRC_PINTEREST_ADS, SRC_PINTEREST_AD_GROUPS, SRC_PINTEREST_AD_INSIGHTS, SRC_PINTEREST_CAMPAIGNS

**Northbeam (1 active):**
SRC_NORTHBEAM_AD_INSIGHTS

**Total: ~81 active tables to monitor.**

### Column Mapping for Spend/Date Checks

| Platform | Date Column | Spend Column | Account Column | Freshness Column |
|---|---|---|---|---|
| META daily | DATE_START | SPEND | ACCOUNT_ID | _EXTRACTED_AT |
| META weekly | DATE_START | SPEND | ACCOUNT_ID | _EXTRACTED_AT |
| APPLOVIN | DAY | (none at ad level) | ACCOUNT_ID | _EXTRACTED_AT |
| GOOGLE | SEGMENTS_DATE | COST_MICROS | CUSTOMER_ID | _EXTRACTED_AT |
| TIKTOK | STAT_TIME_DAY | SPEND | ACCOUNT_ID (ADVERTISER_ID) | _EXTRACTED_AT |
| SNAPCHAT | STAT_DATE | SPEND | ACCOUNT_ID | _EXTRACTED_AT |
| PINTEREST | REPORT_DATE | SPEND_IN_MICRO_DOLLAR | ACCOUNT_ID | _EXTRACTED_AT |
| NORTHBEAM | DATE | SPEND | ACCOUNT_ID | _EXTRACTED_AT |

### Monitor Structure

One monitor per platform group (not per table), using wildcard patterns:

| Monitor | Pattern | Tags | Freshness Threshold |
|---|---|---|---|
| SRC Meta Daily | SRC_META_% (excl WEEKLY) | src,meta | 24h |
| SRC Meta Weekly | SRC_META_WEEKLY_% | src,meta,weekly | 192h |
| SRC AppLovin | SRC_APPLOVIN_% | src,applovin | 24h |
| SRC Google | SRC_GOOGLE_% | src,google | 24h |
| SRC TikTok | SRC_TIKTOK_% | src,tiktok | 24h |
| SRC Snapchat | SRC_SNAPCHAT_% | src,snapchat | 24h |
| SRC Pinterest | SRC_PINTEREST_% | src,pinterest | 24h |
| SRC Northbeam | SRC_NORTHBEAM_% | src,northbeam | 24h |

### Checks Per Monitor

Each monitor gets these configs:
1. **FRESHNESS** -- based on _EXTRACTED_AT (24h daily / 192h weekly)
2. **COLUMN_COUNT** -- detect schema changes
3. **ROW_COUNT** -- anomaly detection

For insight tables with spend data (DATE + SPEND columns):
4. **DATE_GAP** -- 7-day lookback, allow 1 gap
5. **SUM_VALUE** -- total spend yesterday vs day-before
6. **SUM_VALUE_GROUPED by ACCOUNT_ID** -- tagged `src,{platform},account`
7. **SUM_VALUE_GROUPED by CLIENT_ID** (via JOIN to SRC_TS_ACCOUNT_LIST) -- tagged `src,{platform},client`

### Excluded Tables (deprecated/stale)
- SRC_META_WEEKLY_*_BY_DMA (3 tables, stale since June)
- SRC_APPLOVIN_CREATIVE_INSIGHTS (stale 896h)
- SRC_GOOGLE_AD_GROUP_CRITERIA, SRC_GOOGLE_AD_PERFORMANCE_PLACEMENT, SRC_GOOGLE_CAMPAIGN_PERFORMANCE_COUNTRY, SRC_GOOGLE_VIDEO_ASSETS (198h stale, may be weekly -- include with 192h threshold)

## Implementation Steps

### Step 1: Create 8 monitors with wildcard patterns and tags

### Step 2: Create FRESHNESS + COLUMN_COUNT + ROW_COUNT configs for each monitor

### Step 3: Create DATE_GAP configs for insight tables

### Step 4: Create SUM_VALUE configs (total, by account, by client) for spend tables

### Step 5: Create CHECK_SRC_SPEND procedure (handles all platforms dynamically using config)

### Step 6: Schedule tasks at 7:50 AM PST

### Step 7: Test with a manual run

## Verification
- Run FRESHNESS check -- all tables should pass
- Run COLUMN_COUNT -- should log current column counts
- Run SUM_VALUE for one platform -- verify spend comparison works
- Check incidents after run -- should be zero (all fresh)

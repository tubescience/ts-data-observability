# Plan: Lineage Autocomplete + Pre-Computed Cache Table

## Approach

Store pre-computed lineage in a Snowflake table (`TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE`) that a scheduled task refreshes weekly (or you can refresh manually). The app queries this table first — if data exists, it returns instantly without running recursive CTEs. If not found in cache, it falls back to the live OBJECT_DEPENDENCIES query.

Also add typeahead autocomplete from the same cache table for fast object search.

---

## 1. Snowflake: Create Cache Table + Task

```sql
CREATE TABLE IF NOT EXISTS TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE (
  object_fqn STRING,
  direction STRING,       -- 'UPSTREAM' or 'DOWNSTREAM'
  related_database STRING,
  related_schema STRING,
  related_name STRING,
  related_type STRING,
  level INT,
  refreshed_at TIMESTAMP_NTZ DEFAULT CURRENT_TIMESTAMP()
);

CREATE OR REPLACE TASK TS_INGEST_DB.OBSERVABILITY.TASK_REFRESH_LINEAGE_CACHE
  WAREHOUSE = 'MCP_WH'
  SCHEDULE = 'USING CRON 0 6 * * 1 America/Los_Angeles'  -- Every Monday 6 AM
AS
BEGIN
  TRUNCATE TABLE TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE;
  
  -- Insert all 1-level upstream relationships
  INSERT INTO TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE
  SELECT
    REFERENCING_DATABASE || '.' || REFERENCING_SCHEMA || '.' || REFERENCING_OBJECT_NAME,
    'UPSTREAM',
    REFERENCED_DATABASE, REFERENCED_SCHEMA, REFERENCED_OBJECT_NAME,
    REFERENCED_OBJECT_DOMAIN, 1, CURRENT_TIMESTAMP()
  FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES;
  
  -- Insert all 1-level downstream relationships
  INSERT INTO TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE
  SELECT
    REFERENCED_DATABASE || '.' || REFERENCED_SCHEMA || '.' || REFERENCED_OBJECT_NAME,
    'DOWNSTREAM',
    REFERENCING_DATABASE, REFERENCING_SCHEMA, REFERENCING_OBJECT_NAME,
    REFERENCING_OBJECT_DOMAIN, 1, CURRENT_TIMESTAMP()
  FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES;
END;

ALTER TASK TS_INGEST_DB.OBSERVABILITY.TASK_REFRESH_LINEAGE_CACHE RESUME;
-- Manual refresh: EXECUTE TASK TS_INGEST_DB.OBSERVABILITY.TASK_REFRESH_LINEAGE_CACHE;
```

---

## 2. API: Update `/api/lineage/route.ts`

Add cache lookup before live query:

```ts
// Try cache first
const cached = await querySnowflake(`
  SELECT related_database AS database, related_schema AS schema,
         related_name AS name, related_type AS type, level
  FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE
  WHERE object_fqn = '${fqn}' AND direction = 'UPSTREAM'
`)
if (cached.length > 0) return cached  // Skip live query
// else: fall back to live OBJECT_DEPENDENCIES query
```

---

## 3. API: New `/api/lineage/search/route.ts` (Autocomplete)

Query the cache table for matching object names:

```sql
SELECT DISTINCT object_fqn AS fqn
FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE
WHERE object_fqn ILIKE '%:prefix%'
LIMIT 15
```

Fast because it's a simple table scan on a pre-computed dataset (not recursive).

---

## 4. Frontend: Autocomplete Dropdown

In `LineagePanel`, debounce (300ms) the input and show a dropdown:
- Fetch `/api/lineage/search?q=...` when 2+ chars typed
- Show matching FQNs in a dropdown below the input
- Click to select and trigger lineage load
- ESC or blur dismisses

---

## 5. Manual Refresh Button (Admin)

Add a small "Refresh Cache" button in the Lineage tab header that calls:
```
POST /api/lineage/refresh → EXECUTE TASK TS_INGEST_DB.OBSERVABILITY.TASK_REFRESH_LINEAGE_CACHE
```

Shows "Last refreshed: Mon Aug 11, 6:00 AM" based on `MAX(refreshed_at)` from the cache table.

---

## Summary

| Layer | What | Frequency |
|-------|------|-----------|
| Snowflake Task | Materializes all OBJECT_DEPENDENCIES into cache table | Weekly (Monday 6 AM) |
| Manual trigger | "Refresh Cache" button in UI | On-demand |
| API /api/lineage | Checks cache first, falls back to live query | Every request |
| API /api/lineage/search | Autocomplete from cache table | On keypress (debounced) |
| Frontend | Typeahead dropdown + "Last refreshed" indicator | Realtime |

# Plan: Multi-Level Lineage + Auto Object Resolution

## Overview

Two features for the lineage view:
1. **Multi-level lineage** — traverse more than 1 hop upstream/downstream (configurable depth)
2. **Auto-resolve bare object names** — typing just `MY_TABLE` auto-discovers `DATABASE.SCHEMA.MY_TABLE`

---

## 1. API: Recursive lineage with depth param

**File:** `app/api/lineage/route.ts`

Replace the two flat queries with recursive CTEs:

```sql
WITH RECURSIVE lineage_tree AS (
  -- Base case: direct dependencies of the target
  SELECT REFERENCED_DATABASE, REFERENCED_SCHEMA, REFERENCED_OBJECT_NAME, 
         REFERENCED_OBJECT_DOMAIN, 1 AS depth
  FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
  WHERE REFERENCING_OBJECT_NAME = :name
    AND REFERENCING_SCHEMA = :schema
    AND REFERENCING_DATABASE = :database
  
  UNION ALL
  
  -- Recursive: dependencies of dependencies
  SELECT d.REFERENCED_DATABASE, d.REFERENCED_SCHEMA, d.REFERENCED_OBJECT_NAME,
         d.REFERENCED_OBJECT_DOMAIN, lt.depth + 1
  FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES d
  JOIN lineage_tree lt 
    ON d.REFERENCING_OBJECT_NAME = lt.REFERENCED_OBJECT_NAME
    AND d.REFERENCING_SCHEMA = lt.REFERENCED_SCHEMA
    AND d.REFERENCING_DATABASE = lt.REFERENCED_DATABASE
  WHERE lt.depth < :maxDepth
)
SELECT DISTINCT * FROM lineage_tree ORDER BY depth, REFERENCED_DATABASE, REFERENCED_SCHEMA
```

Same pattern for downstream (swap REFERENCING/REFERENCED).

Accept `?depth=N` query param (default 3, max 5). Return nodes with a `level` field.

---

## 2. API: Object name resolution

**New file:** `app/api/lineage/resolve/route.ts`

Query `OBJECT_DEPENDENCIES` for any row where the object name matches (either as referencing or referenced), returning distinct DATABASE + SCHEMA combinations:

```sql
SELECT DISTINCT REFERENCING_DATABASE AS database, REFERENCING_SCHEMA AS schema, 
       REFERENCING_OBJECT_NAME AS name
FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
WHERE REFERENCING_OBJECT_NAME = :objectName
UNION
SELECT DISTINCT REFERENCED_DATABASE, REFERENCED_SCHEMA, REFERENCED_OBJECT_NAME
FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
WHERE REFERENCED_OBJECT_NAME = :objectName
LIMIT 10
```

Returns `{ matches: [{database, schema, name, fqn}] }`.

---

## 3. Frontend: Depth selector

**File:** `components/lineage-view.tsx`

Add a `<select>` or number input (1-5) next to the search bar. Pass it as `&depth=N` to the API call.

---

## 4. Frontend: Auto-resolve bare names

**File:** `components/lineage-view.tsx`

On form submit:
- If input contains no `.` (bare name), call `/api/lineage/resolve?name=INPUT`
- If 1 match returned → use it directly as the search object
- If multiple matches → show a small dropdown/list for the user to pick
- If 0 matches → show error "Object not found"

---

## 5. Graph: Multi-level rendering

**File:** `components/lineage-view.tsx` (LineageGraph component)

Currently renders 3 columns (upstream | target | downstream). For multi-level:
- Group nodes by `level` (1, 2, 3...)
- Render upstream levels right-to-left (level 1 closest to target, level 3 furthest)
- Render downstream levels left-to-right
- Draw edges between consecutive levels
- Adjust SVG width dynamically based on max depth found

---

## Notes
- The recursive CTE approach works with `OBJECT_DEPENDENCIES` which is an Account Usage view (up to 3-hour latency)
- Depth is capped at 5 to avoid performance issues
- SQL injection risk in current code will be mitigated by using parameterized-style string escaping (strip non-alphanumeric/underscore/dot characters)

# Plan: Lineage Chain-Lookup from Cache

## Problem
Currently the cache stores 1-level per object (1,933 objects). When the UI requests depth=5, it falls through to an expensive live recursive CTE against `OBJECT_DEPENDENCIES`. The new approach chains through the existing 1-level cache entries to build multi-level graphs without needing deep storage or live queries.

## Architecture

```
User searches "A" → API calls SP_LINEAGE_CHAIN_LOOKUP('A', 5)
                    → Procedure looks up A's level-1 from cache → finds B, C
                    → Looks up B's level-1 from cache → finds D, E
                    → Looks up C's level-1 from cache → finds F
                    → ... up to depth 5
                    → Returns all nodes with exact parent relationships
```

## Changes

### 1. Add `PARENT_FQN` column to LINEAGE_CACHE

```sql
ALTER TABLE TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE 
ADD COLUMN PARENT_FQN VARCHAR;
```

This stores which node each relationship was discovered from. Example:
- `object_fqn=A, direction=UPSTREAM, related=B, parent_fqn=A` (B is upstream of A)
- When chain-traversing B, we find: `object_fqn=B, direction=UPSTREAM, related=D, parent_fqn=B`

### 2. Create Snowflake Procedure: `SP_LINEAGE_CHAIN_LOOKUP`

```sql
CREATE OR REPLACE PROCEDURE TS_INGEST_DB.OBSERVABILITY.SP_LINEAGE_CHAIN_LOOKUP(
  P_OBJECT_FQN VARCHAR, P_MAX_DEPTH NUMBER DEFAULT 5
)
RETURNS VARIANT
LANGUAGE SQL
AS
BEGIN
  -- Uses a loop (not recursion) to chain-traverse the cache
  -- Level 1: get direct deps of P_OBJECT_FQN from cache
  -- Level 2: for each level-1 node, look up THEIR deps from cache (as root objects)
  -- Continue until max_depth or no new nodes found
  -- Returns JSON array of {fqn, database, schema, name, type, level, direction, parent_fqn}
END;
```

The procedure does pure cache reads (SELECT from LINEAGE_CACHE) — no OBJECT_DEPENDENCIES access needed. This makes it fast even for deep graphs.

### 3. Rewrite `/api/lineage/route.ts`

```
Before: cache lookup (single object) → fallback to recursive CTE
After:  CALL SP_LINEAGE_CHAIN_LOOKUP(object, 5) → parse results → return
```

If the procedure returns empty (object not in cache at all), fall back to a single-level live query + cache the result.

### 4. Update expand ("+") to save to cache

In `/api/lineage/route.ts` (or the expand endpoint), when a "+" is clicked on an uncached node:
1. Query `OBJECT_DEPENDENCIES` for that node's level-1 deps
2. Return the results to the UI
3. **Also INSERT into LINEAGE_CACHE** with `parent_fqn` set, so next time the chain-lookup finds it

### 5. Update monthly task

The existing task already inserts 1-level for all objects. Just add `PARENT_FQN`:
```sql
-- parent_fqn = the object itself (since these are direct level-1 deps)
INSERT INTO LINEAGE_CACHE (..., parent_fqn)
SELECT ..., object_fqn AS parent_fqn FROM ...
```

### 6. Update frontend `buildExpandedTree`

The API will now return `parent_fqn` for each node. Use this to build exact edges:
```ts
// Instead of: "connect level-N to first node at level N-1"
// Now: edge from node.parent_fqn → node.fqn (exact relationship)
```

## Key Benefits
- **Fast**: chain-lookup is just sequential SELECTs from a table (cached data)
- **Accurate edges**: parent_fqn gives exact relationships
- **Self-healing cache**: "+" clicks populate missing entries
- **Monthly task stays simple**: only 1-level per object (the chain handles depth)
- **No redundant storage**: each edge stored once, traversal builds the full picture

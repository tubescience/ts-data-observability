import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function sanitize(value: string): string {
  return value.replace(/[^A-Z0-9_]/g, "")
}

export async function GET(request: NextRequest) {
  const objectName = request.nextUrl.searchParams.get("object")
  if (!objectName) {
    return Response.json({ error: "Missing 'object' query parameter" }, { status: 400 })
  }

  const depthParam = request.nextUrl.searchParams.get("depth")
  const maxDepth = Math.min(Math.max(parseInt(depthParam || "5", 10) || 5, 1), 5)

  const parts = objectName.toUpperCase().trim().replace(/"/g, "").split(".")
  if (parts.length < 2) {
    return Response.json(
      { error: "Please provide at least SCHEMA.OBJECT_NAME (or DATABASE.SCHEMA.OBJECT_NAME)" },
      { status: 400 }
    )
  }

  const objName = sanitize(parts[parts.length - 1])
  const schemaName = sanitize(parts.length >= 3 ? parts[parts.length - 2] : parts[0])
  const dbName = parts.length >= 3 ? sanitize(parts[0]) : null
  let fqn = dbName ? `${dbName}.${schemaName}.${objName}` : null

  try {

    // If no full FQN, try to resolve from cache
    if (!fqn) {
      try {
        const resolved = await querySnowflake(
          `SELECT DISTINCT object_fqn FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE WHERE object_fqn ILIKE '%.${schemaName}.${objName}' LIMIT 1`
        )
        if (resolved.length > 0) {
          fqn = resolved[0].OBJECT_FQN
        }
      } catch {}
    }

    // Chain-lookup from cache
    if (fqn) {
      let upRows: Record<string, any>[] = []
      let downRows: Record<string, any>[] = []

      if (maxDepth === 1) {
        // Fast path: single-level lookup (no recursion)
        ;[upRows, downRows] = await Promise.all([
          querySnowflake(`
            SELECT related_database || '.' || related_schema || '.' || related_name AS fqn,
                   related_database AS database, related_schema AS schema, related_name AS name,
                   related_type AS type, 1 AS level, '${fqn}' AS parent_fqn
            FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE
            WHERE object_fqn = '${fqn}' AND direction = 'UPSTREAM'
          `).catch(() => [] as Record<string, any>[]),
          querySnowflake(`
            SELECT related_database || '.' || related_schema || '.' || related_name AS fqn,
                   related_database AS database, related_schema AS schema, related_name AS name,
                   related_type AS type, 1 AS level, '${fqn}' AS parent_fqn
            FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE
            WHERE object_fqn = '${fqn}' AND direction = 'DOWNSTREAM'
          `).catch(() => [] as Record<string, any>[]),
        ])
      } else {
        // Multi-level: recursive CTE chain-lookup
        ;[upRows, downRows] = await Promise.all([
          querySnowflake(`
            WITH RECURSIVE chain AS (
              SELECT related_database || '.' || related_schema || '.' || related_name AS fqn,
                     related_database AS db, related_schema AS sch, related_name AS name,
                     related_type AS type, 1 AS level, '${fqn}' AS parent_fqn
              FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE
              WHERE object_fqn = '${fqn}' AND direction = 'UPSTREAM'
              UNION ALL
              SELECT c2.related_database || '.' || c2.related_schema || '.' || c2.related_name,
                     c2.related_database, c2.related_schema, c2.related_name,
                     c2.related_type, ch.level + 1, ch.fqn
              FROM chain ch
              JOIN TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE c2
                ON c2.object_fqn = ch.fqn AND c2.direction = 'UPSTREAM'
              WHERE ch.level < ${maxDepth}
                AND c2.related_database || '.' || c2.related_schema || '.' || c2.related_name != '${fqn}'
            )
            SELECT DISTINCT fqn, db AS database, sch AS schema, name, type, level, parent_fqn
            FROM chain ORDER BY level, fqn
          `).catch(() => [] as Record<string, any>[]),
          querySnowflake(`
            WITH RECURSIVE chain AS (
              SELECT related_database || '.' || related_schema || '.' || related_name AS fqn,
                     related_database AS db, related_schema AS sch, related_name AS name,
                     related_type AS type, 1 AS level, '${fqn}' AS parent_fqn
              FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE
              WHERE object_fqn = '${fqn}' AND direction = 'DOWNSTREAM'
              UNION ALL
              SELECT c2.related_database || '.' || c2.related_schema || '.' || c2.related_name,
                     c2.related_database, c2.related_schema, c2.related_name,
                     c2.related_type, ch.level + 1, ch.fqn
              FROM chain ch
              JOIN TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE c2
                ON c2.object_fqn = ch.fqn AND c2.direction = 'DOWNSTREAM'
              WHERE ch.level < ${maxDepth}
                AND c2.related_database || '.' || c2.related_schema || '.' || c2.related_name != '${fqn}'
            )
            SELECT DISTINCT fqn, db AS database, sch AS schema, name, type, level, parent_fqn
            FROM chain ORDER BY level, fqn
          `).catch(() => [] as Record<string, any>[]),
        ])
      }

      const formatCache = (rows: Record<string, any>[]) =>
        rows.map((r) => ({
          database: r.DATABASE,
          schema: r.SCHEMA,
          name: r.NAME,
          type: r.TYPE,
          level: r.LEVEL,
          fqn: r.FQN,
          parent_fqn: r.PARENT_FQN,
        }))

      const upstream = formatCache(upRows)
      const downstream = formatCache(downRows)

      if (upstream.length > 0 || downstream.length > 0) {
        return Response.json({ upstream, downstream, source: "cache" })
      }
    }

    // Fallback: live query from OBJECT_DEPENDENCIES (for uncached objects)
    const dbFilter = dbName ? `AND REFERENCING_DATABASE = '${dbName}'` : ""
    const dbFilterRef = dbName ? `AND REFERENCED_DATABASE = '${dbName}'` : ""

    const [upstream, downstream] = await Promise.all([
      querySnowflake(`
        SELECT DISTINCT
          REFERENCED_DATABASE AS database, REFERENCED_SCHEMA AS schema,
          REFERENCED_OBJECT_NAME AS name, REFERENCED_OBJECT_DOMAIN AS type, 1 AS level
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
        WHERE REFERENCING_OBJECT_NAME = '${objName}' AND REFERENCING_SCHEMA = '${schemaName}' ${dbFilter}
      `),
      querySnowflake(`
        SELECT DISTINCT
          REFERENCING_DATABASE AS database, REFERENCING_SCHEMA AS schema,
          REFERENCING_OBJECT_NAME AS name, REFERENCING_OBJECT_DOMAIN AS type, 1 AS level
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
        WHERE REFERENCED_OBJECT_NAME = '${objName}' AND REFERENCED_SCHEMA = '${schemaName}' ${dbFilterRef}
      `),
    ])

    const targetFqn = fqn || `${schemaName}.${objName}`
    const format = (rows: Record<string, any>[]) =>
      rows.map((r) => ({
        database: r.DATABASE,
        schema: r.SCHEMA,
        name: r.NAME,
        type: r.TYPE,
        level: r.LEVEL,
        fqn: [r.DATABASE, r.SCHEMA, r.NAME].filter(Boolean).join("."),
        parent_fqn: targetFqn,
      }))

    return Response.json({ upstream: format(upstream), downstream: format(downstream), source: "live" })
  } catch (e) {
    console.error(new Date().toISOString(), "[lineage]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load lineage data" },
      { status: 500 }
    )
  }
}

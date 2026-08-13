import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function sanitize(value: string): string {
  return value.replace(/[^A-Z0-9_.]/gi, "").toUpperCase()
}

export async function GET() {
  try {
    try { await querySnowflake("USE ROLE MCP_MONITOR") } catch {}
    const rows = await querySnowflake(
      `SELECT MAX(refreshed_at) AS last_refresh FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE`
    )
    const lastRefresh = rows[0]?.LAST_REFRESH || null
    return Response.json({ lastRefresh })
  } catch (e) {
    return Response.json({ lastRefresh: null })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}))
    // Support single object or array of objects
    const objects: string[] = body.objects
      ? (body.objects as string[]).map(sanitize).filter((o) => o.split(".").length >= 2)
      : body.object
        ? [sanitize(body.object)].filter((o) => o.split(".").length >= 2)
        : []

    if (objects.length === 0) {
      return Response.json({ error: "Provide valid object FQN(s)" }, { status: 400 })
    }

    try { await querySnowflake("USE ROLE MCP_ENGINEER") } catch {}

    let refreshed = 0
    for (const objectFqn of objects) {
      const parts = objectFqn.split(".")
      const objName = parts[parts.length - 1]
      const schemaName = parts.length >= 3 ? parts[parts.length - 2] : parts[0]
      const dbName = parts.length >= 3 ? parts[0] : null
      const dbFilter = dbName ? `AND REFERENCING_DATABASE = '${dbName}'` : ""
      const dbFilterRef = dbName ? `AND REFERENCED_DATABASE = '${dbName}'` : ""
      const targetFqn = dbName ? objectFqn : `${schemaName}.${objName}`

      // Delete old cache for this object
      await querySnowflake(
        `DELETE FROM TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE WHERE object_fqn = '${targetFqn}'`
      )

      // Re-insert upstream (level 1 only)
      await querySnowflake(`
        INSERT INTO TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE (object_fqn, direction, related_database, related_schema, related_name, related_type, level, parent_fqn, refreshed_at)
        SELECT DISTINCT
          '${targetFqn}', 'UPSTREAM',
          REFERENCED_DATABASE, REFERENCED_SCHEMA, REFERENCED_OBJECT_NAME, REFERENCED_OBJECT_DOMAIN,
          1, '${targetFqn}', CURRENT_TIMESTAMP()
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
        WHERE REFERENCING_OBJECT_NAME = '${objName}' AND REFERENCING_SCHEMA = '${schemaName}' ${dbFilter}
      `)

      // Re-insert downstream (level 1 only)
      await querySnowflake(`
        INSERT INTO TS_INGEST_DB.OBSERVABILITY.LINEAGE_CACHE (object_fqn, direction, related_database, related_schema, related_name, related_type, level, parent_fqn, refreshed_at)
        SELECT DISTINCT
          '${targetFqn}', 'DOWNSTREAM',
          REFERENCING_DATABASE, REFERENCING_SCHEMA, REFERENCING_OBJECT_NAME, REFERENCING_OBJECT_DOMAIN,
          1, '${targetFqn}', CURRENT_TIMESTAMP()
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
        WHERE REFERENCED_OBJECT_NAME = '${objName}' AND REFERENCED_SCHEMA = '${schemaName}' ${dbFilterRef}
      `)

      refreshed++
    }

    return Response.json({ status: "refreshed", count: refreshed })
  } catch (e) {
    console.error(new Date().toISOString(), "[lineage/refresh]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to refresh" },
      { status: 500 }
    )
  }
}

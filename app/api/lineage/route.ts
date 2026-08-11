import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

function sanitize(value: string): string {
  return value.replace(/[^A-Z0-9_]/g, "")
}

export async function GET(request: NextRequest) {
  const objectName = request.nextUrl.searchParams.get("object")
  if (!objectName) {
    return Response.json({ error: "Missing 'object' query parameter" }, { status: 400 })
  }

  const depthParam = request.nextUrl.searchParams.get("depth")
  const maxDepth = Math.min(Math.max(parseInt(depthParam || "3", 10) || 3, 1), 5)

  const parts = objectName.toUpperCase().trim().split(".")
  if (parts.length < 2) {
    return Response.json(
      { error: "Please provide at least SCHEMA.OBJECT_NAME (or DATABASE.SCHEMA.OBJECT_NAME)" },
      { status: 400 }
    )
  }

  const objName = sanitize(parts[parts.length - 1])
  const schemaName = sanitize(parts.length >= 3 ? parts[parts.length - 2] : parts[0])
  const dbName = parts.length >= 3 ? sanitize(parts[0]) : null
  const dbFilter = dbName ? `AND REFERENCING_DATABASE = '${dbName}'` : ""
  const dbFilterRef = dbName ? `AND REFERENCED_DATABASE = '${dbName}'` : ""

  try {
    await querySnowflake("USE ROLE MCP_MONITOR")

    const upstream = await querySnowflake(`
      WITH RECURSIVE lineage_tree AS (
        SELECT
          REFERENCED_DATABASE AS database,
          REFERENCED_SCHEMA AS schema,
          REFERENCED_OBJECT_NAME AS name,
          REFERENCED_OBJECT_DOMAIN AS type,
          1 AS level
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
        WHERE REFERENCING_OBJECT_NAME = '${objName}'
          AND REFERENCING_SCHEMA = '${schemaName}'
          ${dbFilter}

        UNION ALL

        SELECT
          d.REFERENCED_DATABASE,
          d.REFERENCED_SCHEMA,
          d.REFERENCED_OBJECT_NAME,
          d.REFERENCED_OBJECT_DOMAIN,
          lt.level + 1
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES d
        JOIN lineage_tree lt
          ON d.REFERENCING_OBJECT_NAME = lt.name
          AND d.REFERENCING_SCHEMA = lt.schema
          AND d.REFERENCING_DATABASE = lt.database
        WHERE lt.level < ${maxDepth}
      )
      SELECT DISTINCT database, schema, name, type, level
      FROM lineage_tree
      ORDER BY level, database, schema, name
    `)

    const downstream = await querySnowflake(`
      WITH RECURSIVE lineage_tree AS (
        SELECT
          REFERENCING_DATABASE AS database,
          REFERENCING_SCHEMA AS schema,
          REFERENCING_OBJECT_NAME AS name,
          REFERENCING_OBJECT_DOMAIN AS type,
          1 AS level
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
        WHERE REFERENCED_OBJECT_NAME = '${objName}'
          AND REFERENCED_SCHEMA = '${schemaName}'
          ${dbFilterRef}

        UNION ALL

        SELECT
          d.REFERENCING_DATABASE,
          d.REFERENCING_SCHEMA,
          d.REFERENCING_OBJECT_NAME,
          d.REFERENCING_OBJECT_DOMAIN,
          lt.level + 1
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES d
        JOIN lineage_tree lt
          ON d.REFERENCED_OBJECT_NAME = lt.name
          AND d.REFERENCED_SCHEMA = lt.schema
          AND d.REFERENCED_DATABASE = lt.database
        WHERE lt.level < ${maxDepth}
      )
      SELECT DISTINCT database, schema, name, type, level
      FROM lineage_tree
      ORDER BY level, database, schema, name
    `)

    const format = (rows: Record<string, any>[]) =>
      rows.map((r) => ({
        database: r.DATABASE,
        schema: r.SCHEMA,
        name: r.NAME,
        type: r.TYPE,
        level: r.LEVEL,
        fqn: [r.DATABASE, r.SCHEMA, r.NAME].filter(Boolean).join("."),
      }))

    return Response.json({ upstream: format(upstream), downstream: format(downstream) })
  } catch (e) {
    console.error(new Date().toISOString(), "[lineage]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to load lineage data" },
      { status: 500 }
    )
  }
}

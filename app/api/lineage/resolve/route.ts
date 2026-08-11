import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"
export const maxDuration = 60

function sanitize(value: string): string {
  return value.replace(/[^A-Z0-9_]/g, "")
}

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")
  if (!name) {
    return Response.json({ error: "Missing 'name' query parameter" }, { status: 400 })
  }

  const objName = sanitize(name.toUpperCase().trim())
  if (!objName) {
    return Response.json({ error: "Invalid object name" }, { status: 400 })
  }

  try {
    try { await querySnowflake("USE ROLE MCP_MONITOR") } catch {}

    const rows = await querySnowflake(`
      SELECT DISTINCT database, schema, name FROM (
        SELECT
          REFERENCING_DATABASE AS database,
          REFERENCING_SCHEMA AS schema,
          REFERENCING_OBJECT_NAME AS name
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
        WHERE REFERENCING_OBJECT_NAME = '${objName}'

        UNION

        SELECT
          REFERENCED_DATABASE AS database,
          REFERENCED_SCHEMA AS schema,
          REFERENCED_OBJECT_NAME AS name
        FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
        WHERE REFERENCED_OBJECT_NAME = '${objName}'
      )
      ORDER BY database, schema
      LIMIT 10
    `)

    const matches = rows.map((r) => ({
      database: r.DATABASE,
      schema: r.SCHEMA,
      name: r.NAME,
      fqn: `${r.DATABASE}.${r.SCHEMA}.${r.NAME}`,
    }))

    return Response.json({ matches })
  } catch (e) {
    console.error(new Date().toISOString(), "[lineage/resolve]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Failed to resolve object" },
      { status: 500 }
    )
  }
}

import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const objectName = request.nextUrl.searchParams.get("object")
  if (!objectName) {
    return Response.json({ error: "Missing 'object' query parameter" }, { status: 400 })
  }

  const parts = objectName.toUpperCase().trim().split(".")
  if (parts.length < 2) {
    return Response.json(
      { error: "Please provide at least SCHEMA.OBJECT_NAME (or DATABASE.SCHEMA.OBJECT_NAME)" },
      { status: 400 }
    )
  }

  try {
    await querySnowflake("USE ROLE MCP_MONITOR")

    const upstream = await querySnowflake(`
      SELECT
        REFERENCED_DATABASE AS database,
        REFERENCED_SCHEMA AS schema,
        REFERENCED_OBJECT_NAME AS name,
        REFERENCED_OBJECT_DOMAIN AS type
      FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
      WHERE REFERENCING_OBJECT_NAME = '${parts[parts.length - 1]}'
        AND REFERENCING_SCHEMA = '${parts.length >= 3 ? parts[parts.length - 2] : parts[0]}'
        ${parts.length >= 3 ? `AND REFERENCING_DATABASE = '${parts[0]}'` : ""}
      ORDER BY REFERENCED_DATABASE, REFERENCED_SCHEMA, REFERENCED_OBJECT_NAME
    `)

    const downstream = await querySnowflake(`
      SELECT
        REFERENCING_DATABASE AS database,
        REFERENCING_SCHEMA AS schema,
        REFERENCING_OBJECT_NAME AS name,
        REFERENCING_OBJECT_DOMAIN AS type
      FROM SNOWFLAKE.ACCOUNT_USAGE.OBJECT_DEPENDENCIES
      WHERE REFERENCED_OBJECT_NAME = '${parts[parts.length - 1]}'
        AND REFERENCED_SCHEMA = '${parts.length >= 3 ? parts[parts.length - 2] : parts[0]}'
        ${parts.length >= 3 ? `AND REFERENCED_DATABASE = '${parts[0]}'` : ""}
      ORDER BY REFERENCING_DATABASE, REFERENCING_SCHEMA, REFERENCING_OBJECT_NAME
    `)

    const format = (rows: Record<string, any>[]) =>
      rows.map((r) => ({
        database: r.DATABASE,
        schema: r.SCHEMA,
        name: r.NAME,
        type: r.TYPE,
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

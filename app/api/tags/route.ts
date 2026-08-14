import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const rows = await querySnowflake(
      `SELECT TAG_NAME, COLOR FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_TAGS ORDER BY TAG_NAME`
    )
    const tags = rows.map((r) => ({ name: r.TAG_NAME, color: r.COLOR }))
    return Response.json(tags)
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed to load tags" }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { name, color } = body
    if (!name || !color) return Response.json({ error: "name and color required" }, { status: 400 })

    const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 50)
    const safeColor = color.replace(/[^#a-fA-F0-9]/g, "").slice(0, 7)

    await querySnowflake(
      `MERGE INTO TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_TAGS t
       USING (SELECT '${safeName}' AS tag_name, '${safeColor}' AS color) s
       ON t.TAG_NAME = s.tag_name
       WHEN MATCHED THEN UPDATE SET COLOR = s.color
       WHEN NOT MATCHED THEN INSERT (TAG_NAME, COLOR) VALUES (s.tag_name, s.color)`
    )

    return Response.json({ status: "ok", name: safeName, color: safeColor })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed to save tag" }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    const { name } = body
    if (!name) return Response.json({ error: "name required" }, { status: 400 })

    const safeName = name.toLowerCase().replace(/[^a-z0-9_-]/g, "")
    await querySnowflake(
      `DELETE FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_TAGS WHERE TAG_NAME = '${safeName}'`
    )

    return Response.json({ status: "deleted" })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed to delete tag" }, { status: 500 })
  }
}

import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const checkType = request.nextUrl.searchParams.get("checkType") || ""
  const groupValue = request.nextUrl.searchParams.get("groupValue") || ""

  if (!groupValue) return Response.json({ name: null })

  try {
    let name: string | null = null

    if (checkType === "SPEND_CLIENT" || checkType === "SRC_SPEND_CLIENT") {
      const rows = await querySnowflake(
        `SELECT client_name FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY WHERE client_id = '${groupValue.replace(/'/g, "''")}' LIMIT 1`
      )
      name = rows[0]?.CLIENT_NAME || null
    } else if (checkType === "SPEND_ACCOUNT" || checkType === "SRC_SPEND_ACCOUNT" || checkType === "SUM_VALUE_GROUPED") {
      const rows = await querySnowflake(
        `SELECT account_name FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY WHERE account_id = '${groupValue.replace(/'/g, "''")}' LIMIT 1`
      )
      name = rows[0]?.ACCOUNT_NAME || null
    }

    return Response.json({ name })
  } catch {
    return Response.json({ name: null })
  }
}

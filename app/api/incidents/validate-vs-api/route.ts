import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const SPEND_VALIDATION_BASE_URL = "https://spendvalidation.vercel.app"

// Raw SRC_<PLATFORM>_% tables encode their platform in the table name.
const TABLE_PLATFORM_MAP: Record<string, string> = {
  META: "facebook",
  TIKTOK: "tiktok",
  SNAPCHAT: "snapchat",
  PINTEREST: "pinterest",
  APPLOVIN: "applovin",
}

// V_SPEND_DAILY's own PLATFORM codes (reporting layer, not table-name-derived).
const SF_PLATFORM_MAP: Record<string, string> = {
  FB: "facebook",
  FACEBOOK: "facebook",
  META: "facebook",
  TIK: "tiktok",
  TIKTOK: "tiktok",
  SNAP: "snapchat",
  SNAPCHAT: "snapchat",
  PIN: "pinterest",
  PINTEREST: "pinterest",
  APLVN: "applovin",
  APPLOVIN: "applovin",
}

function platformFromTable(targetTable: string): string | null {
  const upper = targetTable.toUpperCase()
  for (const [key, platform] of Object.entries(TABLE_PLATFORM_MAP)) {
    if (upper.includes(key)) return platform
  }
  return null
}

// Client-level checks don't validate against a live ad-platform API (a client is a
// cross-platform aggregate, not something any single platform API can confirm) --
// instead compare the two internal reporting layers the client total is actually
// built from. Uses SPEND_USD, not native SPEND: a client's accounts can span
// multiple currencies (verified), so summing native amounts across them would be
// meaningless. Returns null if neither layer has any row for this client/date, so
// the caller can fall back to its own "nothing found" handling.
async function runClientSpendComparison(clientId: number, date: string) {
  const [tgtRows, mcpRows] = await Promise.all([
    querySnowflake(
      `SELECT SUM(SPEND_USD) AS SPEND, ANY_VALUE(CLIENT_NAME) AS CLIENT_NAME
       FROM TS_PROD_DB.TGT_ADPIP_REPORT.V_SPEND_DAILY
       WHERE CLIENT_ID = ${clientId} AND DATE = '${date}'
       GROUP BY CLIENT_ID`
    ),
    querySnowflake(
      `SELECT SUM(SPEND_USD) AS SPEND, ANY_VALUE(CLIENT_NAME) AS CLIENT_NAME
       FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY
       WHERE CLIENT_ID = ${clientId} AND DATE = '${date}'
       GROUP BY CLIENT_ID`
    ),
  ])

  if (tgtRows.length === 0 && mcpRows.length === 0) return null

  const tgtSpend = tgtRows[0]?.SPEND ?? 0
  const mcpSpend = mcpRows[0]?.SPEND ?? 0
  const clientName = tgtRows[0]?.CLIENT_NAME || mcpRows[0]?.CLIENT_NAME || null
  const diff = tgtSpend - mcpSpend
  const diffPct = mcpSpend !== 0 ? (diff / mcpSpend) * 100 : null

  return {
    date,
    results: [
      {
        platform: "reporting",
        ourLabel: "TGT_ADPIP_REPORT",
        compareLabel: "MCP REPORTING",
        note: "Both sides are internal V_SPEND_DAILY layers in USD -- not a live platform API. A client spans multiple ad accounts (and can span multiple currencies), so this compares the two reporting layers the client total is built from rather than any single platform's API.",
        rows: [
          {
            account_id: String(clientId),
            account_name: clientName,
            currency: "USD",
            snowflake_spend: tgtSpend,
            platform_spend: mcpSpend,
            diff,
            diff_pct: diffPct,
          },
        ],
      },
    ],
  }
}

// The PST calendar date immediately before the given instant's PST calendar date.
// Built entirely from explicit UTC arithmetic (Date.UTC/setUTCDate/getUTCDate), not
// `new Date("YYYY-MM-DDT00:00:00")` (which parses as the *server's local timezone*,
// silently wrong by a day whenever that's not UTC or PST/PDT itself -- confirmed by
// testing under TZ=Asia/Tokyo).
function pstDateMinusOne(instant: Date): string {
  const datePST = instant.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" })
  const [y, m, d] = datePST.split("-").map(Number)
  const utcDate = new Date(Date.UTC(y, m - 1, d))
  utcDate.setUTCDate(utcDate.getUTCDate() - 1)
  return utcDate.toISOString().slice(0, 10)
}

function yesterdayPST(): string {
  return pstDateMinusOne(new Date())
}

// The check that raised this incident always evaluates the PREVIOUS day's spend
// relative to when it ran (e.g. a check that fires today is judging yesterday's
// numbers) -- so the comparison date is one day before the incident's own creation
// date, not the creation date itself. CONVERT_TIMEZONE on the way out of Snowflake
// attaches the LA offset to the timestamp string, so `new Date(iso)` already
// resolves to the correct instant here.
function spendDateFromIncidentCreatedAt(iso: string): string | null {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return pstDateMinusOne(d)
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { checkType, targetTable, groupValue, createdAt } = body

    if (!checkType || !groupValue) {
      return Response.json({ error: "checkType and groupValue are required" }, { status: 400 })
    }

    const isExplicitClientCheck = checkType === "SPEND_CLIENT" || checkType === "SRC_SPEND_CLIENT"
    // SUM_VALUE_GROUPED/DATA_RECENCY are ambiguous: the same monitor can have
    // separate configs grouping by CLIENT_ID, ACCOUNT_ID, or PLATFORM, and the
    // incident itself doesn't record which -- same ambiguity as group-name
    // resolution. These fall back to the client comparison only if the normal
    // account-based platform lookup below finds nothing.
    const isAmbiguousGroupedCheck = checkType === "SUM_VALUE_GROUPED" || checkType === "DATA_RECENCY"
    const date = (createdAt && spendDateFromIncidentCreatedAt(createdAt)) || yesterdayPST()
    const escapedGroup = String(groupValue).replace(/'/g, "''")

    try { await querySnowflake("USE ROLE MCP_MONITOR") } catch {}

    if (isExplicitClientCheck) {
      const clientId = Number(groupValue)
      if (!Number.isFinite(clientId)) {
        return Response.json({ error: `Invalid client id: ${groupValue}` }, { status: 400 })
      }
      const result = await runClientSpendComparison(clientId, date)
      if (!result) {
        return Response.json({ error: `No spend data found for CLIENT_ID ${groupValue} on ${date}` }, { status: 400 })
      }
      return Response.json(result)
    }

    // Resolve which platform(s) to check, and whether GROUP_VALUE is itself an
    // account/client, or the whole-platform code (e.g. monitor 1107's SUM_VALUE_GROUPED
    // on V_SPEND_DAILY groups by PLATFORM directly -- GROUP_VALUE is 'TIK'/'FB'/etc.,
    // not an account/client ID, so looking it up as one finds nothing).
    let platforms: string[] = []
    let isPlatformLevel = false
    const directPlatform = platformFromTable(targetTable || "")
    const platformFromGroupValue = SF_PLATFORM_MAP[String(groupValue).toUpperCase()]
    if (platformFromGroupValue) {
      platforms = [platformFromGroupValue]
      isPlatformLevel = true
    } else if (directPlatform) {
      platforms = [directPlatform]
    } else {
      const rows = await querySnowflake(
        `SELECT DISTINCT PLATFORM FROM TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY ` +
        `WHERE ACCOUNT_ID = '${escapedGroup}' AND DATE >= DATEADD('day', -7, CURRENT_DATE())`
      )
      const found = new Set<string>()
      for (const r of rows) {
        const mapped = SF_PLATFORM_MAP[String(r.PLATFORM || "").toUpperCase()]
        if (mapped) found.add(mapped)
      }
      platforms = Array.from(found)
    }

    if (platforms.length === 0) {
      const clientId = Number(groupValue)
      if (isAmbiguousGroupedCheck && !isPlatformLevel && Number.isFinite(clientId)) {
        const result = await runClientSpendComparison(clientId, date)
        if (result) return Response.json(result)
      }
      return Response.json({
        error:
          "No supported platform found for this incident's account/client in the last 7 days. " +
          "Live validation covers Meta, TikTok, Snapchat, Pinterest, and AppLovin only.",
      }, { status: 400 })
    }

    const results = await Promise.all(
      platforms.map(async (platform) => {
        const payload: Record<string, string> = { platform, start_date: date, end_date: date }
        // Platform-level: leave account_id unset so the service returns every
        // account on that platform (spend-validation supports this directly), which
        // is exactly what a platform-wide SUM_VALUE_GROUPED check needs to compare
        // its own platform total against.
        if (!isPlatformLevel) {
          payload.account_id = String(groupValue)
        }

        try {
          const res = await fetch(`${SPEND_VALIDATION_BASE_URL}/api/spend_validation/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
          const json = await res.json()
          return { platform, ...json }
        } catch (e) {
          return { platform, status: "error", message: e instanceof Error ? e.message : "Request failed" }
        }
      })
    )

    return Response.json({ date, results })
  } catch (e) {
    console.error(new Date().toISOString(), "[validate-vs-api]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Live spend validation failed" },
      { status: 500 }
    )
  }
}

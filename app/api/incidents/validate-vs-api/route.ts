import { querySnowflake } from "@/lib/snowflake"
import { NextRequest } from "next/server"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const SPEND_VALIDATION_BASE_URL = "https://spendvalidation.vercel.app"
const AUTO_RESOLVE_TOLERANCE_PCT = 2

// This route calls spendvalidation.vercel.app directly from TypeScript -- entirely
// separate from CHECK_LIVE_SPEND's own Snowflake-side calls to the same API, and
// previously logged nowhere at all, making "how many API calls per day, by
// platform" impossible to answer without guessing. Both call sites now write to
// the same shared table so the real total (batch sweep + manual UI clicks) is a
// direct query. Never let a logging failure affect the actual validation result.
function sqlStr(val: string | null | undefined): string {
  return val == null ? "NULL" : `'${val.replace(/'/g, "''")}'`
}

async function logApiCall(
  source: string,
  platform: string,
  incidentId: number | null,
  groupType: string,
  groupValue: string | null,
  success: boolean,
  errorMessage?: string | null
) {
  try {
    await querySnowflake(
      `INSERT INTO TS_INGEST_DB.OBSERVABILITY.SPEND_VALIDATION_API_CALLS
       (SOURCE, PLATFORM, INCIDENT_ID, GROUP_TYPE, GROUP_VALUE, SUCCESS, ERROR_MESSAGE)
       VALUES (${sqlStr(source)}, ${sqlStr(platform)}, ${incidentId ?? "NULL"}, ${sqlStr(groupType)}, ${sqlStr(groupValue)}, ${success}, ${sqlStr(errorMessage ?? null)})`
    )
  } catch {
    // logging is best-effort, never block or fail the actual validation on it
  }
}

interface SpendRow {
  snowflake_spend?: number | null
  adpip_spend?: number | null
  platform_spend?: number | null
  platform_spend_adpip?: number | null
  error?: string | null
}

interface PlatformResult {
  platform: string
  status?: string
  rows?: SpendRow[]
}

// What the server actually resolved and used -- surfaced back to the UI so it can
// show what was checked, instead of the frontend guessing/sending its own version
// of these and risking disagreement with what the server actually did.
interface RequestParamsInfo {
  groupType: "client" | "account" | "platform"
  groupValue: string
  resolvedName: string | null
  platforms: string[]
  date: string
}

// Display-only guess for when neither the account nor client lookup found any
// data to confirm the grain either way (see the "no platform found" branch).
// Every observed CLIENT_ID is a short sequential integer (<=3 digits, e.g. 101,
// 150, 226); every observed ACCOUNT_ID is a long platform-native number (13+
// digits, e.g. 516177035416343). Never used to change control flow -- only to
// avoid mislabeling an obviously account-shaped id as "platform" just because
// the check type happens to be one of the ambiguous ones.
function guessGroupType(groupValue: string): "client" | "account" {
  return /^\d{1,5}$/.test(groupValue) ? "client" : "account"
}

function firstResolvedName(results: PlatformResult[]): string | null {
  for (const r of results) {
    for (const row of r.rows || []) {
      const name = (row as any).account_name || (row as any).client_name
      if (name) return name
    }
  }
  return null
}

// Decides whether the incident's OWN reported number (not the other reference
// column also shown in the UI) is within tolerance of the live platform API.
// A check's TARGET_TABLE tells us which reporting layer it actually reads from
// (TGT_ADPIP_REPORT vs MCP's own REPORTING.V_SPEND_DAILY) -- that is the value
// this incident is actually about, so that is what must match the live API for
// auto-resolve, regardless of how the other (non-authoritative) column compares.
// The "reporting" platform (client-level ADPIP-vs-MCP comparison, see
// runClientSpendComparison) never confirms against a live platform API at all,
// so it can never drive auto-resolve on its own.
function computeOwnSourceMatch(targetTable: string, results: PlatformResult[]): { isMatch: boolean; details: string[] } {
  const usesAdpip = /TGT_ADPIP_REPORT/i.test(targetTable || "")
  const comparable = results.filter((r) => r.platform !== "reporting")
  if (comparable.length === 0) return { isMatch: false, details: [] }

  const details: string[] = []
  for (const result of comparable) {
    if (result.status === "error") return { isMatch: false, details }
    const rows = (result.rows || []).filter((r) => !r.error)
    if (rows.length === 0) return { isMatch: false, details }

    // Google returns a SEPARATE live figure already scoped to match ADPIP's own
    // account scope (platform_spend_adpip), distinct from platform_spend (the
    // MCP-scoped one every other platform reuses for both comparisons) -- use it
    // here when present so the ADPIP-side comparison isn't paired against the
    // wrong-scope live number.
    const totalOwn = rows.reduce((sum, r) => sum + ((usesAdpip ? r.adpip_spend : r.snowflake_spend) ?? 0), 0)
    const totalApi = rows.reduce((sum, r) => sum + ((usesAdpip ? (r.platform_spend_adpip ?? r.platform_spend) : r.platform_spend) ?? 0), 0)
    if (totalApi === 0) return { isMatch: false, details }

    const diffPct = ((totalOwn - totalApi) / totalApi) * 100
    if (Math.abs(diffPct) > AUTO_RESOLVE_TOLERANCE_PCT) return { isMatch: false, details }
    details.push(`${result.platform}: ${usesAdpip ? "ADPIP" : "MCP"} ${totalOwn.toFixed(2)} vs Live API ${totalApi.toFixed(2)} (${diffPct > 0 ? "+" : ""}${diffPct.toFixed(2)}%)`)
  }
  return { isMatch: true, details }
}

async function autoResolveIncidents(ids: number[], resolutionNotes: string): Promise<void> {
  if (ids.length === 0) return
  await querySnowflake("USE ROLE MCP_MONITOR")
  await querySnowflake(`
    UPDATE TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_INCIDENTS
    SET STATUS = 'RESOLVED',
        RESOLVED_AT = CURRENT_TIMESTAMP(),
        RESOLUTION_NOTES = '${resolutionNotes.replace(/'/g, "''")}',
        UPDATED_AT = CURRENT_TIMESTAMP()
    WHERE INCIDENT_ID IN (${ids.join(",")}) AND STATUS = 'OPEN'
  `)
}

// Raw SRC_<PLATFORM>_% tables encode their platform in the table name.
const TABLE_PLATFORM_MAP: Record<string, string> = {
  META: "facebook",
  TIKTOK: "tiktok",
  SNAPCHAT: "snapchat",
  PINTEREST: "pinterest",
  APPLOVIN: "applovin",
  GOOGLE: "google",
}

// V_SPEND_DAILY's own PLATFORM codes (reporting layer, not table-name-derived).
// Google/YouTube ('google') added once spend_validation started supporting it --
// confirmed via direct probe: the platform value must be exactly 'google'
// ('youtube'/'google_ads'/'yt' all return 400 Unsupported platform).
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
  YT: "google",
  YOUTUBE: "google",
  GOOGLE: "google",
  GOOGLE_ADS: "google",
}

function platformFromTable(targetTable: string): string | null {
  const upper = targetTable.toUpperCase()
  for (const [key, platform] of Object.entries(TABLE_PLATFORM_MAP)) {
    if (upper.includes(key)) return platform
  }
  return null
}

async function resolveClientName(clientId: number): Promise<string | null> {
  const rows = await querySnowflake(
    `SELECT CLIENT_NAME FROM TS_PROD_DB.INGEST.SRC_TS_CLIENT_LIST WHERE CLIENT_ID = ${clientId} LIMIT 1`
  )
  return rows[0]?.CLIENT_NAME || null
}

// SRC_TS_ACCOUNT_LIST carries PLATFORM as a static attribute of the account
// itself, not derived from recent spend rows -- so unlike the V_SPEND_DAILY
// 7-day lookup, it still resolves the platform for accounts with no recent
// activity (e.g. STATUS = 'prospective', onboarded but not yet spending).
async function resolveAccountFromList(accountId: string): Promise<{ platform: string | null; accountName: string | null } | null> {
  const rows = await querySnowflake(
    `SELECT PLATFORM, ACCOUNT_NAME FROM TS_PROD_DB.INGEST.SRC_TS_ACCOUNT_LIST WHERE ACCOUNT_ID::VARCHAR = '${accountId.replace(/'/g, "''")}' LIMIT 1`
  )
  if (rows.length === 0) return null
  const mapped = SF_PLATFORM_MAP[String(rows[0].PLATFORM || "").toUpperCase()] || null
  return { platform: mapped, accountName: rows[0].ACCOUNT_NAME || null }
}

// Discovers which platforms a client actually has active accounts on, so a
// cross-platform client total can be validated one platform at a time -- no
// single API confirms the combined total, but each platform's own API CAN
// confirm its own slice. SRC_TS_ACCOUNT_LIST (not V_SPEND_DAILY) is the source
// here because it's the account registry itself, not a recent-spend lookup --
// a client's platform lineup shouldn't depend on which of its accounts spent
// in the last 7 days. STATUS filter matches the project-wide "still counts as
// active for validation" set (see VALIDATE_INCIDENT's own account gate) --
// 'active' alone excluded real, currently-spending accounts like newly onboarded
// clients still marked 'prospective' (confirmed: David Protein, SRI Labs, Open
// Farm Pet all fell back to the reporting-only comparison under 'active' only,
// despite having real spend, because their FB accounts are 'prospective').
async function resolveClientPlatforms(clientId: number): Promise<string[]> {
  const rows = await querySnowflake(
    `SELECT DISTINCT PLATFORM FROM TS_PROD_DB.INGEST.SRC_TS_ACCOUNT_LIST WHERE CLIENT_ID = ${clientId} AND STATUS IN ('active', 'prospective', 'active - not delivering')`
  )
  const found = new Set<string>()
  for (const r of rows) {
    const mapped = SF_PLATFORM_MAP[String(r.PLATFORM || "").toUpperCase()]
    if (mapped) found.add(mapped)
  }

  // STATUS can still lag real activity even past the widened set above - e.g.
  // client 222 "Speak Japan" has genuine recent spend while both of its known
  // FB accounts are marked 'not active' (incident 137748: Check Live Spend
  // returned nothing to validate against because this lookup came back empty).
  // Fall back to the client's actual recent spend by platform instead of
  // trusting a stale registry field (same precedent as CHECK_LIVE_SPEND's own
  // account-id and client-id fallbacks in Snowflake).
  if (found.size === 0) {
    const fallbackRows = await querySnowflake(
      `SELECT DISTINCT PLATFORM FROM TS_PROD_DB.TGT_ADPIP_REPORT.V_SPEND_DAILY
       WHERE CLIENT_ID = ${clientId} AND DATE >= DATEADD('day', -7, CURRENT_DATE())`
    )
    for (const r of fallbackRows) {
      const mapped = SF_PLATFORM_MAP[String(r.PLATFORM || "").toUpperCase()]
      if (mapped) found.add(mapped)
    }
  }

  return Array.from(found)
}

// Per-platform breakdown for a client: one live-API call per platform the
// client actually runs on (from resolveClientPlatforms), each returned as its
// own PlatformResult so the existing multi-platform UI renders a panel per
// platform automatically. Returns null (caller falls back to the internal
// reporting-layer comparison) when the client has no active account on any
// platform this service supports.
async function runClientPerPlatformComparison(clientId: number, clientName: string, date: string, incidentId: number | null = null): Promise<{ date: string; results: PlatformResult[] } | null> {
  const platforms = await resolveClientPlatforms(clientId)
  if (platforms.length === 0) return null

  const results = await Promise.all(
    platforms.map(async (platform) => {
      try {
        const res = await fetch(`${SPEND_VALIDATION_BASE_URL}/api/spend_validation/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ platform, start_date: date, end_date: date, client: clientName }),
        })
        const json = await res.json()
        await logApiCall("APP_CLIENT_PER_PLATFORM", platform, incidentId, "client", String(clientId), true)
        return { platform, ...json }
      } catch (e) {
        await logApiCall("APP_CLIENT_PER_PLATFORM", platform, incidentId, "client", String(clientId), false, e instanceof Error ? e.message : "Request failed")
        return { platform, status: "error", message: e instanceof Error ? e.message : "Request failed" }
      }
    })
  )
  return { date, results }
}

// Only SPEND_CLIENT (targeting the cross-platform V_SPEND_DAILY aggregate) lacks a
// live ad-platform API to validate against -- no single platform can confirm a
// cross-client-platform total. So instead compare the two internal reporting
// layers the client total is actually built from. Uses SPEND_USD, not native
// SPEND: a client's accounts can span multiple currencies (verified), so summing
// native amounts across them would be meaningless. Returns null if neither layer
// has any row for this client/date, so the caller can fall back to its own
// "nothing found" handling.
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
    const { checkType, targetTable, groupValue, createdAt, incidentId, incidentIds } = body

    if (!checkType || !groupValue) {
      return Response.json({ error: "checkType and groupValue are required" }, { status: 400 })
    }

    const resolveIds: number[] = Array.isArray(incidentIds)
      ? incidentIds.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id))
      : incidentId != null && Number.isInteger(Number(incidentId))
      ? [Number(incidentId)]
      : []

    // Shared exit point for every successful comparison below: decides whether the
    // incident's own reported number is within tolerance of the live API and, if
    // so, resolves it immediately (no separate manual "Save Resolved" click) --
    // same 2% tolerance the UI already uses to color-code a close match, just now
    // acted on automatically instead of only informing a human's judgment call.
    const finalize = async (
      payload: { date: string; results: PlatformResult[]; ourLabel?: string; compareLabel?: string; note?: string },
      requestParams: RequestParamsInfo
    ) => {
      requestParams.resolvedName = requestParams.resolvedName || firstResolvedName(payload.results)
      const { isMatch, details } = computeOwnSourceMatch(targetTable || "", payload.results)
      if (!isMatch || resolveIds.length === 0) {
        return Response.json({ ...payload, autoResolved: false, requestParams })
      }
      const resolutionNotes =
        `Auto-resolved: live spend validation matched within ${AUTO_RESOLVE_TOLERANCE_PCT}% tolerance for ${payload.date}.\n` +
        details.join("\n")
      await autoResolveIncidents(resolveIds, resolutionNotes)
      return Response.json({ ...payload, autoResolved: true, resolvedIds: resolveIds, resolutionNotes, requestParams })
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
    // Raw SRC_<PLATFORM>_% target tables (e.g. SRC_TIKTOK_AD_INSIGHTS) tell us
    // exactly which platform a check covers, regardless of check type.
    const directPlatform = platformFromTable(targetTable || "")

    try { await querySnowflake("USE ROLE MCP_MONITOR") } catch {}

    if (isExplicitClientCheck) {
      const clientId = Number(groupValue)
      if (!Number.isFinite(clientId)) {
        return Response.json({
          error: `Invalid client id: ${groupValue}`,
          requestParams: { groupType: "client", groupValue: String(groupValue), resolvedName: null, platforms: directPlatform ? [directPlatform] : [], date },
        }, { status: 400 })
      }

      if (directPlatform) {
        // SRC_SPEND_CLIENT targets one platform's raw source table -- a per-platform
        // client total, which that platform's own API CAN validate (unlike
        // SPEND_CLIENT's cross-platform V_SPEND_DAILY total, handled below).
        const clientName = await resolveClientName(clientId)
        if (!clientName) {
          return Response.json({
            error: `Could not resolve client name for CLIENT_ID ${groupValue}`,
            requestParams: { groupType: "client", groupValue: String(groupValue), resolvedName: null, platforms: [directPlatform], date },
          }, { status: 400 })
        }
        const requestParams: RequestParamsInfo = {
          groupType: "client",
          groupValue: String(groupValue),
          resolvedName: clientName,
          platforms: [directPlatform],
          date,
        }
        try {
          const res = await fetch(`${SPEND_VALIDATION_BASE_URL}/api/spend_validation/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platform: directPlatform, start_date: date, end_date: date, client: clientName }),
          })
          const json = await res.json()
          await logApiCall("APP_CLIENT_DIRECT_PLATFORM", directPlatform, resolveIds[0] ?? null, "client", String(clientId), true)
          return finalize({ date, results: [{ platform: directPlatform, ...json }] }, requestParams)
        } catch (e) {
          await logApiCall("APP_CLIENT_DIRECT_PLATFORM", directPlatform, resolveIds[0] ?? null, "client", String(clientId), false, e instanceof Error ? e.message : "Request failed")
          return Response.json({
            date,
            results: [{ platform: directPlatform, status: "error", message: e instanceof Error ? e.message : "Request failed" }],
            autoResolved: false,
            requestParams,
          })
        }
      }

      // Cross-platform client total: no single API confirms the combined figure,
      // but each platform the client actually runs on (from SRC_TS_ACCOUNT_LIST)
      // has its own API that can confirm its slice -- try that breakdown first,
      // and only fall back to the internal ADPIP-vs-MCP reporting comparison if
      // the client has no active account on any platform this service supports.
      const clientNameForBreakdown = await resolveClientName(clientId)
      if (clientNameForBreakdown) {
        const perPlatform = await runClientPerPlatformComparison(clientId, clientNameForBreakdown, date, incidentId != null && Number.isInteger(Number(incidentId)) ? Number(incidentId) : null)
        if (perPlatform) {
          return finalize(perPlatform, {
            groupType: "client",
            groupValue: String(groupValue),
            resolvedName: clientNameForBreakdown,
            platforms: perPlatform.results.map((r) => r.platform),
            date,
          })
        }
      }

      const result = await runClientSpendComparison(clientId, date)
      if (!result) {
        return Response.json({
          error: `No spend data found for CLIENT_ID ${groupValue} on ${date}`,
          requestParams: { groupType: "client", groupValue: String(groupValue), resolvedName: clientNameForBreakdown, platforms: ["reporting"], date },
        }, { status: 400 })
      }
      return finalize(result, {
        groupType: "client",
        groupValue: String(groupValue),
        resolvedName: clientNameForBreakdown,
        platforms: ["reporting"],
        date,
      })
    }

    // Resolve which platform(s) to check, and whether GROUP_VALUE is itself an
    // account/client, or the whole-platform code (e.g. monitor 1107's SUM_VALUE_GROUPED
    // on V_SPEND_DAILY groups by PLATFORM directly -- GROUP_VALUE is 'TIK'/'FB'/etc.,
    // not an account/client ID, so looking it up as one finds nothing).
    let platforms: string[] = []
    let isPlatformLevel = false
    let accountListName: string | null = null
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

      // No recent spend rows to infer the platform from (e.g. a newly onboarded,
      // not-yet-spending account) -- SRC_TS_ACCOUNT_LIST carries PLATFORM as a
      // static account attribute instead, so it still resolves in that case.
      if (platforms.length === 0) {
        const accountInfo = await resolveAccountFromList(String(groupValue))
        if (accountInfo) {
          accountListName = accountInfo.accountName
          if (accountInfo.platform) platforms = [accountInfo.platform]
        }
      }
    }

    if (platforms.length === 0) {
      const clientId = Number(groupValue)
      // Only try the client interpretation when we haven't already confirmed this
      // is a real, known account (just on an unsupported platform) -- no reason to
      // guess client when the account list already answered the question.
      if (isAmbiguousGroupedCheck && !isPlatformLevel && !accountListName && Number.isFinite(clientId)) {
        const clientNameForBreakdown = await resolveClientName(clientId)
        if (clientNameForBreakdown) {
          const perPlatform = await runClientPerPlatformComparison(clientId, clientNameForBreakdown, date, incidentId != null && Number.isInteger(Number(incidentId)) ? Number(incidentId) : null)
          if (perPlatform) {
            return finalize(perPlatform, {
              groupType: "client",
              groupValue: String(groupValue),
              resolvedName: clientNameForBreakdown,
              platforms: perPlatform.results.map((r) => r.platform),
              date,
            })
          }
        }
        const result = await runClientSpendComparison(clientId, date)
        if (result) {
          return finalize(result, {
            groupType: "client",
            groupValue: String(groupValue),
            resolvedName: clientNameForBreakdown,
            platforms: ["reporting"],
            date,
          })
        }
      }
      return Response.json({
        error:
          "No supported platform found for this incident's account/client in the last 7 days. " +
          "Live validation covers Meta, TikTok, Snapchat, Pinterest, AppLovin, and Google/YouTube only.",
        requestParams: {
          groupType: accountListName ? "account" : isAmbiguousGroupedCheck ? guessGroupType(String(groupValue)) : "account",
          groupValue: String(groupValue),
          resolvedName: accountListName,
          platforms: [],
          date,
        },
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
          await logApiCall("APP_ACCOUNT_PLATFORM", platform, resolveIds[0] ?? null, isPlatformLevel ? "platform" : "account", String(groupValue), true)
          return { platform, ...json }
        } catch (e) {
          await logApiCall("APP_ACCOUNT_PLATFORM", platform, resolveIds[0] ?? null, isPlatformLevel ? "platform" : "account", String(groupValue), false, e instanceof Error ? e.message : "Request failed")
          return { platform, status: "error", message: e instanceof Error ? e.message : "Request failed" }
        }
      })
    )

    return finalize({ date, results }, {
      groupType: isPlatformLevel ? "platform" : "account",
      groupValue: String(groupValue),
      resolvedName: accountListName,
      platforms,
      date,
    })
  } catch (e) {
    console.error(new Date().toISOString(), "[validate-vs-api]", e)
    return Response.json(
      { error: e instanceof Error ? e.message : "Live spend validation failed" },
      { status: 500 }
    )
  }
}

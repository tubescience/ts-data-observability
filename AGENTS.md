<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# OBSERVABILITY project rules

`ts_data_observability` is TubeScience's in-house data observability dashboard: Next.js 16
(Turbopack) App Router, Snowflake-backed via `snowflake-sdk` (role `MCP_MONITOR`), deployed to
`https://ts-data-observability.vercel.app`. It tracks data-quality checks (`OBSERVABILITY_RESULTS`),
the incidents they raise (`OBSERVABILITY_INCIDENTS`), their config (`OBSERVABILITY_CONFIG`), and
the monitors that run them (`OBSERVABILITY_MONITORS`), all in `TS_INGEST_DB.OBSERVABILITY`.

## Snowflake data-model gotchas (learned the hard way — verify before assuming otherwise)

- **`CHECK_TYPE` naming is inconsistent.** Config declares `SPEND_CLIENT`/`SPEND_ACCOUNT`, but
  ~15-20% of actual result/incident rows (same `CONFIG_ID`) use `SRC_SPEND_CLIENT`/`SRC_SPEND_ACCOUNT`
  instead. Match check types with the `SRC_` prefix stripped when comparing, unless the distinction
  itself matters (it does for Check Live Spend — see below).
- **`THRESHOLD`/`LAST_THRESHOLD` is not always a real pass/fail limit.** For `SUM_VALUE_GROUPED`'s
  day-of-week baseline anomaly check, it's just yesterday's raw value (`DETAILS.day_before`), not a
  limit. The real trigger is `|dow_zscore| >= 3` from `DETAILS.dow_baseline_mean`/`dow_baseline_std`
  (confirmed empirically against ~400 recent PASS/ANOMALY results — clean cutoff, no ambiguous
  cases). `ROW_COUNT`/`VOLUME` baseline-mode checks store their own `DETAILS.lower`/`DETAILS.upper`
  directly — read those verbatim rather than recomputing. See `lib/threshold-band.ts` for the
  3-tier precedence (stored lower/upper → DOW mean±3σ → plain ±pct band → null/no band).
- **`SUM_VALUE_GROUPED`/`DATA_RECENCY` are ambiguous in grain.** The same monitor can have separate
  `OBSERVABILITY_CONFIG` rows grouping by `CLIENT_ID`, `ACCOUNT_ID`, or `PLATFORM`, and nothing on
  the incident itself records which one produced it. `client_id` and `account_id` are disjoint
  numeric namespaces though (verified — no id exists as both), so it's always safe to try an
  account-shaped lookup first and fall back to a client-shaped one (or vice versa) rather than
  assuming a fixed grain from the check type alone.
- **`OBSERVABILITY_CONFIG` is not guaranteed unique per `(MONITOR_ID, CHECK_TYPE)`** — some have
  multiple legacy `CONFIG_ID` rows for the same pair. Joining on the raw table fans out matching
  incidents (caused a real "duplicate React key" bug). Dedupe first, e.g.
  `QUALIFY ROW_NUMBER() OVER (PARTITION BY MONITOR_ID, CHECK_TYPE ORDER BY CONFIG_ID DESC) = 1`.
- **Platform-code group values are not real entities.** `GROUP_VALUE` can be a platform code
  (`TIK`, `FB`, `APLVN`, `YT`, `SNAP`, `PIN`, etc.) rather than an account/client id — don't treat
  these as groupable entities (e.g. don't merge unrelated incidents just because they share `TIK`).
- **Never scan `V_SPEND_DAILY` (300M+ rows, in either `TS_MCP_PROD_DB.REPORTING` or
  `TS_PROD_DB.TGT_ADPIP_REPORT`) for name resolution or per-request lookups** — this alone cost
  3-10s per request in more than one route before being fixed. Use `NAME_LOOKUP_CACHE`
  (`TS_INGEST_DB.OBSERVABILITY`, `ENTITY_TYPE = 'CLIENT'|'ACCOUNT'`, refreshed daily by
  `OBS_TASK_REFRESH_NAME_CACHE`) for id→name lookups, or the small dimension tables
  `TS_PROD_DB.INGEST.SRC_TS_ACCOUNT_LIST` (~760 rows) / `SRC_TS_CLIENT_LIST` (~230 rows) if the
  cache doesn't cover what's needed.
- **PST dates must use explicit UTC arithmetic** (`Date.UTC`/`setUTCDate`/`getUTCDate`), never
  `new Date("YYYY-MM-DDT00:00:00")` — the latter parses in the *server's* local timezone, silently
  wrong whenever that's not UTC or PST/PDT (confirmed under `TZ=Asia/Tokyo`).
- **A check always evaluates the previous day's data relative to when it ran.** Features that
  re-validate an incident (Check Live Spend, etc.) must use the incident's own `CREATED_AT` minus
  one PST day as the comparison date — not "yesterday relative to whenever the button is clicked,"
  which is wrong for any incident checked more than a day after it fired.

## Check Live Spend (`/api/incidents/validate-vs-api`)

- `SPEND_ACCOUNT`/`SRC_SPEND_ACCOUNT`: pass `account_id` (raw `GROUP_VALUE`) directly to
  `spendvalidation.vercel.app`.
- `SRC_SPEND_CLIENT`: `TARGET_TABLE` names one platform's raw source table (e.g.
  `SRC_TIKTOK_AD_INSIGHTS`) — derive `platform` from the table name (`platformFromTable()`), resolve
  the client's name (`SRC_TS_CLIENT_LIST`), and pass `client` (the service matches clients by name,
  ILIKE, not by id — passing a raw `client_id` is silently ignored and returns every account on the
  platform instead of erroring).
- `SPEND_CLIENT`: targets the cross-platform `V_SPEND_DAILY` aggregate — no single platform API can
  confirm a cross-platform total, so this instead compares `SUM(SPEND_USD)` between
  `TS_PROD_DB.TGT_ADPIP_REPORT.V_SPEND_DAILY` and `TS_MCP_PROD_DB.REPORTING.V_SPEND_DAILY` directly
  in Snowflake. Uses `SPEND_USD`, not native `SPEND` — a client's accounts can span multiple
  currencies (verified), so summing native amounts would be meaningless.
- `SUM_VALUE_GROUPED`/`DATA_RECENCY` fall back to the client comparison above only when the normal
  account/platform lookup finds nothing (see the grain ambiguity note above).
- `ts-observability-ml.vercel.app` (Check ML Forecast) only supports `SPEND_CLIENT`/`SPEND_ACCOUNT`
  — confirmed by direct testing, not documented anywhere.

## `VALIDATE_INCIDENT` procedure

Owned by role `MCP_ENGINEER`; the app's `MCP_MONITOR` role only has `USAGE` (granted per-procedure,
not inherited from schema `USAGE`). Its per-check-type validation logic is hardcoded inside the
procedure body, which `MCP_MONITOR` can't view (`GET_DDL` returns an empty body) or edit — e.g. it
returns "re-validation not supported for this check type yet" for `VOLUME`. Adding support for a new
check type requires the procedure owner, not an app-side change.

## Workflow conventions

- Only push to GitHub, deploy (`vercel deploy --prod`), or touch Linear when explicitly asked —
  never proactively.
- Before any commit: `git diff` the staged files for secrets, and stage files explicitly (never
  `git add -A`) — an untracked `docs/` directory in this repo belongs to a separate/parallel session
  and should not be swept into commits.
- After running `tsc --noEmit`, `git checkout -- tsconfig.tsbuildinfo` (and `next-env.d.ts` if
  touched) — these are harmless build-artifact side effects of typechecking, not real changes.
- Local dev: port 3000 is often already taken by the sibling `ts-data-ingestion/control-panel`
  project — `next dev` falls back to 3001 automatically; verify with `lsof` before assuming a
  listening process on 3000 is this app.
- Linear: work is tracked as dated sub-issues (`Aug DD - <summary>`) under `ENG-2549`, assigned to
  the user, marked Done, with a comment summarizing that day's work and time spent — only when the
  user explicitly asks for one.

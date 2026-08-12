# Plan: Add Mozart Data Status Check

## Context

**Current state:**
- The `GENERATE_DAILY_STATUS_REPORT` procedure has a REPORTS section that shows Power BI status only.
- The `EAI_STATUS_PAGES` external access integration already allows `app.mozartdata.com` egress.
- The network rule `NL_STATUS_PAGES` includes `app.mozartdata.com`.
- The EAI currently allows one secret (`COALESCE_API_TOKEN`). The Mozart session cookie needs to be added.

**Target:**
- Fetch `https://app.mozartdata.com/warehouse?filter=is%3Ascheduled%2Cfailed`
- If the page contains failed transform rows, return "In Review"; otherwise "Up to date"
- Show this after Power BI in the REPORTS section of the daily report

**Key finding:**
Mozart's warehouse page is a React SPA. The HTML response likely returns a shell with JS that loads data via API calls. A better approach is to hit Mozart's internal API endpoint that powers that page (likely `/api/transforms?filter=scheduled,failed` or similar). If the API returns JSON with failed items, we parse that. If the HTML scrape approach doesn't yield structured data, we'll fall back to checking for specific failure indicators in the rendered HTML.

However, since we're using a session cookie, the simplest reliable approach is to fetch the page and check for known failure indicators in the HTML/JSON response.

## Implementation Steps

### Step 1: Create Snowflake secret for Mozart session cookie

```sql
CREATE OR REPLACE SECRET TS_INGEST_DB.OBSERVABILITY.MOZART_SESSION_COOKIE
    TYPE = GENERIC_STRING
    SECRET_STRING = 'sessionid=rhmsj481bgjfme41zvx82j9knu6l9kcg; csrftoken=bpgxqSUOAlWLuSQE6O0Gl3PFBFVyOohC';
```

### Step 2: Update EAI_STATUS_PAGES to allow the new secret

```sql
ALTER EXTERNAL ACCESS INTEGRATION EAI_STATUS_PAGES
SET ALLOWED_AUTHENTICATION_SECRETS = (
    TS_INGEST_DB.OBSERVABILITY.COALESCE_API_TOKEN,
    TS_INGEST_DB.OBSERVABILITY.MOZART_SESSION_COOKIE
);
```

### Step 3: Create `CHECK_MOZART_HEALTH` procedure

A JavaScript stored procedure that:
1. Reads the `MOZART_SESSION_COOKIE` secret
2. Fetches `https://app.mozartdata.com/warehouse?filter=is%3Ascheduled%2Cfailed`
3. Checks the response for indicators of failed transforms
4. Logs result to `OBSERVABILITY_RESULTS` with `CHECK_TYPE='EXTERNAL_STATUS'`, `TARGET_TABLE='app.mozartdata.com/warehouse'`
5. Returns PASS (no failures) or FAIL (failures detected)

```sql
CREATE OR REPLACE PROCEDURE TS_INGEST_DB.OBSERVABILITY.CHECK_MOZART_HEALTH()
RETURNS VARCHAR
LANGUAGE JAVASCRIPT
EXECUTE AS CALLER
EXTERNAL_ACCESS_INTEGRATIONS = (EAI_STATUS_PAGES)
SECRETS = ('cred' = TS_INGEST_DB.OBSERVABILITY.MOZART_SESSION_COOKIE)
AS
$$
  // ... fetch logic, parse response, insert into OBSERVABILITY_RESULTS
$$;
```

### Step 4: Update `GENERATE_DAILY_STATUS_REPORT`

After the Power BI line (`v_pbi_line`), add a Mozart line that reads the latest `EXTERNAL_STATUS` result for `app.mozartdata.com/warehouse`:

```sql
-- MOZART DATA
LET v_mozart_line VARCHAR;
SELECT CASE WHEN STATUS = 'PASS' 
    THEN v_tab || ':white_check_mark: Mozart Data: Up to date'
    ELSE v_tab || ':warning: Mozart Data: In Review, Data Engineering team is actively investigating.' 
    END
INTO v_mozart_line
FROM TS_INGEST_DB.OBSERVABILITY.OBSERVABILITY_RESULTS
WHERE CHECK_TYPE = 'EXTERNAL_STATUS' AND TARGET_TABLE = 'app.mozartdata.com/warehouse'
ORDER BY CHECK_TIMESTAMP DESC LIMIT 1;

IF (v_mozart_line IS NULL) THEN 
    v_mozart_line := v_tab || ':white_check_mark: Mozart Data: Up to date'; 
END IF;
```

Then in the REPORTS assembly:
```
|| '*REPORTS*' || v_nl || v_pbi_line || v_nl || v_mozart_line || v_nl
```

### Step 5: Test

1. Call `CHECK_MOZART_HEALTH()` — verify it fetches and returns a status
2. Call `GENERATE_DAILY_STATUS_REPORT()` — verify Mozart appears in REPORTS section

## Verification

- `CHECK_MOZART_HEALTH()` returns either "Mozart: PASS | No failed transforms" or "Mozart: FAIL | N failed transforms found"
- Latest result visible in `OBSERVABILITY_RESULTS` with `TARGET_TABLE='app.mozartdata.com/warehouse'`
- `GENERATE_DAILY_STATUS_REPORT()` output includes `:white_check_mark: Mozart Data: Up to date` or `:warning: Mozart Data: In Review...` in the REPORTS section

## Critical Files (Snowflake objects)

- `TS_INGEST_DB.OBSERVABILITY.CHECK_MOZART_HEALTH` — New procedure to create
- `TS_INGEST_DB.OBSERVABILITY.GENERATE_DAILY_STATUS_REPORT` — Add Mozart line to REPORTS section
- `TS_INGEST_DB.OBSERVABILITY.MOZART_SESSION_COOKIE` — New secret to store
- `EAI_STATUS_PAGES` — Needs secret list update

## Note on session cookie expiry

Session cookies expire. The stored `sessionid` will eventually become invalid. When that happens, `CHECK_MOZART_HEALTH` will detect the auth failure (redirect to login or 401) and should log it as an ERROR status with a message indicating cookie refresh is needed. This can be addressed later with a longer-lived API token if Mozart provides one.

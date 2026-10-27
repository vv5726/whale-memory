# verify-fresh-clone.ps1
#
# Clone the PUBLIC repo into a temp dir and walk through the README from scratch:
#   1) node src/cli.ts init          (must create the DB and seed anchors)
#   2) cp data/bot.example.json      (must exist in the repo)
#   3) ingest 3 turns + run LLM extraction with a FAKE model (no API key, no money)
#   4) assert the extracted events carry the v3 fields (etype/status/memory_value/place)
#
# Why: on 2026-10-26 someone used the GitHub copy and hit "no such column: stage".
# Root cause was the repo not being self-contained (v3 columns, people table,
# seed-anchors.json, bot.example.json were all missing). This script is the
# regression test for "a fresh clone can actually run".
#
# Usage:
#   pwsh -File tools/verify-fresh-clone.ps1
#   pwsh -File tools/verify-fresh-clone.ps1 -Repo <git url> -Branch master -Keep
#
# NOTE: keep this file ASCII-only. powershell.exe 5.1 reads .ps1 as ANSI,
# and UTF-8 Chinese comments break the script (learned the hard way).

param(
  [string]$Repo = "https://github.com/vv5726/whale-memory.git",
  [string]$Branch = "master",
  [switch]$Keep
)

# Do NOT set $ErrorActionPreference = "Stop" here: git writes progress to stderr
# ("Cloning into ..."), and Windows PowerShell 5.1 treats native stderr as a
# terminating error. Check $LASTEXITCODE explicitly instead.
$ProgressPreference = "SilentlyContinue"
$fails = 0
function Check($name, $ok, $detail = "") {
  if ($ok) { Write-Host ("  [PASS] " + $name + $(if ($detail) { "  " + $detail } else { "" })) }
  else { Write-Host ("  [FAIL] " + $name + $(if ($detail) { "  " + $detail } else { "" })) -ForegroundColor Red; $script:fails++ }
}

$tmp = Join-Path $env:TEMP ("wm-verify-" + (Get-Date -Format "HHmmss"))
Write-Host ("[1/5] clone " + $Repo + " -> " + $tmp)
$env:GIT_TERMINAL_PROMPT = "0"
$cloneOut = (& git -c http.sslBackend=openssl clone --depth 1 --branch $Branch $Repo $tmp 2>&1 | Out-String)
$cloneCode = $LASTEXITCODE
if ($cloneCode -ne 0) {
  # some networks only work without the openssl override
  $cloneOut = (& git clone --depth 1 --branch $Branch $Repo $tmp 2>&1 | Out-String)
  $cloneCode = $LASTEXITCODE
}
if ($cloneCode -ne 0) {
  Write-Host "  [FAIL] clone failed" -ForegroundColor Red
  Write-Host ($cloneOut.Trim() -replace "\s+", " ")
  exit 1
}

Push-Location $tmp
try {
  $commit = (git log --oneline -1)
  Write-Host ("       cloned: " + $commit)

  Write-Host "[2/5] node version >= 24"
  $nodeVersion = (node --version)
  $major = [int](($nodeVersion -replace "^v", "") -split "\.")[0]
  Check ("node " + $nodeVersion) ($major -ge 24)

  Write-Host "[3/5] README step: init"
  $initOut = (& node src/cli.ts init 2>&1 | Out-String)
  $initCode = $LASTEXITCODE
  Check "init exit code 0" ($initCode -eq 0) ($initOut.Trim() -replace "\s+", " ")
  Check "database created" (Test-Path "data/memory.db")

  Write-Host "[4/5] README step: copy example config"
  Check "data/bot.example.json exists in repo" (Test-Path "data/bot.example.json")
  Copy-Item "data/bot.example.json" "data/bot.json" -ErrorAction SilentlyContinue
  Check "bot.json copied" (Test-Path "data/bot.json")

  Write-Host "[5/5] ingest 3 turns + LLM extraction (fake model)"
  $e2e = @'
import { openDb } from "./src/db.ts";
import { sleepAsync } from "./src/sleep.ts";
import { DEFAULT_CONFIG } from "./src/config.ts";
import { ingestTurns } from "./src/extract.ts";
import { dayKey } from "./src/util.ts";

const db = openDb("data/memory.db");
const day = dayKey(Date.now());
ingestTurns(db, [
  { day, role: "user", text: "meet at the south gate bbq place saturday 3pm, no cilantro", speakerId: "10000001" },
  { day, role: "assistant", text: "noted", speakerId: "10000000" },
  { day, role: "user", text: "he still owes me 2000 and says he will pay next month", speakerId: "10000001" },
]);
const ids = db.prepare("SELECT id FROM turns ORDER BY seq ASC").all().map((r) => r.id);
const fake = {
  name: "fake",
  complete: async () =>
    JSON.stringify({
      events: [
        {
          type: "appointment",
          title: "bbq meetup saturday 3pm",
          people: ["10000001"],
          time_relative: "saturday afternoon",
          place: "south gate bbq",
          content: "meet at the south gate bbq place saturday 3pm",
          status: "agreed",
          next_action: "",
          evidence: [{ speaker: "10000001", msg_id: ids[0], quote: "south gate bbq" }],
          sensitivity: "normal",
          memory_value: 6,
        },
        {
          type: "todo",
          title: "owes 2000, pay next month",
          people: ["10000001"],
          content: "he owes 2000 and will pay next month",
          status: "follow-up",
          next_action: "check next month",
          evidence: [{ speaker: "10000001", msg_id: ids[2], quote: "2000" }],
          sensitivity: "private",
          memory_value: 8,
        },
      ],
      lexicon: [],
      persons: [],
    }),
};

const cfg = { ...DEFAULT_CONFIG, extractor: "llm", extractV3: true };
const stats = await sleepAsync(db, cfg, {}, fake);
const events = db
  .prepare("SELECT title, etype, status, memory_value, place FROM events WHERE etype <> '' ORDER BY ts DESC")
  .all();
console.log(
  JSON.stringify({
    inserted: stats.llm ? stats.llm.inserted : null,
    rejected: stats.llm ? stats.llm.rejected : null,
    newAnchors: stats.llm ? stats.llm.newAnchors : null,
    anchors: db.prepare("SELECT COUNT(*) c FROM anchors").get().c,
    eventAnchors: db.prepare("SELECT COUNT(*) c FROM event_anchors").get().c,
    events,
  }),
);
db.close();
'@
  Set-Content -Path "e2e.mjs" -Value $e2e -Encoding utf8
  $raw = (& node e2e.mjs 2>&1 | Out-String)
  Remove-Item "e2e.mjs" -Force -ErrorAction SilentlyContinue
  $jsonLine = ($raw -split "`n" | Where-Object { $_.Trim().StartsWith("{") } | Select-Object -Last 1)
  if (-not $jsonLine) {
    Check "extraction produced JSON summary" $false ($raw.Trim() -replace "\s+", " ")
  } else {
    $r = $jsonLine | ConvertFrom-Json
    Check "llm inserted >= 2" ($r.inserted -ge 2) ("inserted=" + $r.inserted + " rejected=" + $r.rejected)
    Check "v3 events have etype/status/memory_value" (($r.events | Where-Object { $_.etype -and $_.status -and $_.memory_value -gt 0 }).Count -ge 2) (($r.events | ConvertTo-Json -Compress))
    Check "anchors built" ($r.anchors -gt 17) ("anchors=" + $r.anchors)
    Check "event_anchors built" ($r.eventAnchors -gt 0) ("event_anchors=" + $r.eventAnchors)
  }
}
finally {
  Pop-Location
  if (-not $Keep) { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  else { Write-Host ("  kept: " + $tmp) }
}

Write-Host ""
if ($fails -eq 0) {
  Write-Host "RESULT: PASS  (a fresh clone can init, ingest and extract)" -ForegroundColor Green
  exit 0
}
Write-Host ("RESULT: FAIL  (" + $fails + " checks failed)") -ForegroundColor Red
exit 1

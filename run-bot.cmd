@echo off
cd /d "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory"
rem Normal logs already go to data\logs\bot.log (truncated at the top of every hour).
rem Do NOT redirect stdout again: it would write every line twice.
rem Keep stderr: uncaught exceptions do not go through console.*, only to stderr.
rem NOTE: keep this file ASCII-only. cmd.exe reads .cmd as ANSI,
rem and UTF-8 Chinese comments here break the script (seen 2026-10-26).
"D:\Node\node.exe" src\bot.ts 1>nul 2>> "data\logs\stderr.log"

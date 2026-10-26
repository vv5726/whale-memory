@echo off
cd /d "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory"
"D:\Node\node.exe" src\bot.ts >> "data\logs\stdout.log" 2>&1

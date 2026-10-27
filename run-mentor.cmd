@echo off
cd /d "C:\Users\Administrator\Documents\deepseek-harness\default-workspace\whale-memory"
"D:\Node\node.exe" tools\mentor-service.ts >> "data\logs\mentor.log" 2>&1

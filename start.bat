@echo off
rem Inicia la biblioteca. Copia config.example.bat a config.bat y edítalo.
cd /d "%~dp0"
if exist config.bat call config.bat
if "%PORT%"=="" set PORT=8000
node server.js
pause

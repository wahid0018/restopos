@echo off
rem Start RestoPOS.   start.bat            -> default restaurant (data\)
rem                   start.bat sharma     -> client folder clients\sharma
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 18 or newer is required: https://nodejs.org & pause & exit /b 1)
node -e "process.exit(+process.versions.node.split('.')[0]<18?1:0)" || (echo Your Node.js is too old. Install Node.js LTS from https://nodejs.org & pause & exit /b 1)
if "%~1"=="" (node server.js) else (node server.js --client %1)
pause

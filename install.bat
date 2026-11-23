@echo off
rem RestoPOS installer - double-click. Asks for administrator rights, installs to C:\RestoPOS.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"

@echo off
setlocal
cd /d "%~dp0"
title Macro Terminal

set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if not defined PY (
  where python >nul 2>nul
  if not errorlevel 1 set "PY=python"
)
if not defined PY goto nopython

if exist ".venv\Scripts\python.exe" goto avvio
echo Primo avvio: preparo l'ambiente (serve internet, una volta sola)...
%PY% -m venv .venv
if errorlevel 1 goto errenv
".venv\Scripts\python.exe" -m pip install --quiet flask
if errorlevel 1 goto errenv

:avvio
start "" "http://localhost:5051"
".venv\Scripts\python.exe" app.py
echo.
pause
exit /b 0

:nopython
echo Python 3 non trovato.
echo Installalo da https://www.python.org/downloads/ (spunta "Add python.exe to PATH") e rilancia.
pause
exit /b 1

:errenv
echo Impossibile preparare l'ambiente. Controlla la connessione e riprova.
rmdir /s /q .venv >nul 2>nul
pause
exit /b 1

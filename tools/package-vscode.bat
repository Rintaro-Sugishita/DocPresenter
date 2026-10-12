@echo off
rem Builds the DocPresenter VS Code extension and packs it into a .vsix file.
rem
rem   tools\package-vscode.bat            -> out\vsix\docpresenter-<version>.vsix
rem   tools\package-vscode.bat install    -> the same, then installs it into VS Code
rem
rem Install the .vsix elsewhere with:
rem   code --install-extension docpresenter-<version>.vsix
rem or VS Code: Extensions view, "..." menu, "Install from VSIX...".

setlocal
cd /d "%~dp0.."

where npm >nul 2>nul
if errorlevel 1 (
  echo [ERROR] npm was not found. Install Node.js first.
  goto :fail
)

if not exist node_modules (
  echo === npm install ===
  call npm install
  if errorlevel 1 goto :fail
)

echo === Build: typecheck and bundle ===
call npm run build:vscode
if errorlevel 1 goto :fail

for /f "usebackq delims=" %%v in (`node -p "require('./packages/app-vscode/package.json').version"`) do set VERSION=%%v
set OUTDIR=%CD%\out\vsix
set VSIX=%OUTDIR%\docpresenter-%VERSION%.vsix
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

echo === Package: %VSIX% ===
pushd packages\app-vscode
call "%~dp0..\node_modules\.bin\vsce.cmd" package --no-dependencies --allow-missing-repository --skip-license -o "%VSIX%"
set RESULT=%ERRORLEVEL%
popd
if not "%RESULT%"=="0" goto :fail

if /i "%~1"=="install" (
  echo === Install into VS Code ===
  call code --install-extension "%VSIX%" --force
  if errorlevel 1 goto :fail
  echo Installed. Reload the VS Code window to use the new build.
)

echo.
echo Done: %VSIX%
endlocal
exit /b 0

:fail
echo.
echo [ERROR] Packaging failed.
endlocal
exit /b 1

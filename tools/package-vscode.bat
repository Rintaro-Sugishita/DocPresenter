@echo off
rem Builds the two VS Code extensions and packs each into a .vsix file:
rem DocPresenter (documents) and DocPresenter Diagram (drawings), which the first
rem brings along as its extension pack.
rem
rem   tools\package-vscode.bat            -> out\vsix\docpresenter-<version>.vsix
rem                                          out\vsix\docpresenter-diagram-<version>.vsix
rem   tools\package-vscode.bat install    -> the same, then installs both into VS Code
rem
rem Install them elsewhere with, the diagram extension first:
rem   code --install-extension docpresenter-diagram-<version>.vsix
rem   code --install-extension docpresenter-<version>.vsix
rem or VS Code: Extensions view, "..." menu, "Install from VSIX...".
rem
rem Each .vsix carries the repository's LICENSE.md: it is copied into the package
rem folder for vsce to pick up, and removed again afterwards (also on failure).

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
for /f "usebackq delims=" %%v in (`node -p "require('./packages/app-vscode-diagram/package.json').version"`) do set DIAGRAM_VERSION=%%v
set OUTDIR=%CD%\out\vsix
set VSIX=%OUTDIR%\docpresenter-%VERSION%.vsix
set DIAGRAM_VSIX=%OUTDIR%\docpresenter-diagram-%DIAGRAM_VERSION%.vsix
if not exist "%OUTDIR%" mkdir "%OUTDIR%"

if not exist LICENSE.md (
  echo [ERROR] LICENSE.md was not found at the repository root.
  goto :fail
)
copy /y LICENSE.md packages\app-vscode-diagram\LICENSE.md >nul
if errorlevel 1 goto :fail
copy /y LICENSE.md packages\app-vscode\LICENSE.md >nul
if errorlevel 1 goto :fail

echo === Package: %DIAGRAM_VSIX% ===
pushd packages\app-vscode-diagram
call "%~dp0..\node_modules\.bin\vsce.cmd" package --no-dependencies --allow-missing-repository -o "%DIAGRAM_VSIX%"
set RESULT=%ERRORLEVEL%
popd
if not "%RESULT%"=="0" goto :fail

echo === Package: %VSIX% ===
pushd packages\app-vscode
call "%~dp0..\node_modules\.bin\vsce.cmd" package --no-dependencies --allow-missing-repository -o "%VSIX%"
set RESULT=%ERRORLEVEL%
popd
if not "%RESULT%"=="0" goto :fail

call :cleanlicense

if /i "%~1"=="install" (
  echo === Install into VS Code: the diagram extension first, then the one whose pack names it ===
  call code --install-extension "%DIAGRAM_VSIX%" --force
  if errorlevel 1 goto :fail
  call code --install-extension "%VSIX%" --force
  if errorlevel 1 goto :fail
  echo Installed. Reload the VS Code window to use the new build.
)

echo.
echo Done: %DIAGRAM_VSIX%
echo       %VSIX%
endlocal
exit /b 0

:fail
call :cleanlicense
echo.
echo [ERROR] Packaging failed.
endlocal
exit /b 1

rem Removes the LICENSE.md copies placed in the package folders for vsce.
:cleanlicense
if exist packages\app-vscode-diagram\LICENSE.md del /q packages\app-vscode-diagram\LICENSE.md
if exist packages\app-vscode\LICENSE.md del /q packages\app-vscode\LICENSE.md
exit /b 0

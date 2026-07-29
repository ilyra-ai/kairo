@echo off
setlocal enabledelayedexpansion
title Kairo - Publicar no GitHub (main)
cd /d "%~dp0"

echo ============================================================
echo   Kairo - Publicar no GitHub - branch main
echo ============================================================

rem ---------------------------------------------------------------
rem  Verificacao basica
rem ---------------------------------------------------------------
if not exist ".git" (
    echo [ERRO] Esta pasta nao e um repositorio Git ^(.git nao encontrado^).
    echo        Local atual: %CD%
    echo.
    pause
    exit /b 1
)

if exist ".git\index.lock" del /f /q ".git\index.lock" >nul 2>&1

rem ---------------------------------------------------------------
rem  Identidade do autor
rem ---------------------------------------------------------------
git config user.name "ilyra-ai"
git config user.email "douglas@ilyra.com.br"

rem ---------------------------------------------------------------
rem  Rede de seguranca: deixa de rastrear segredos/artefatos do Kairo
rem  (o .gitignore ja os ignora; isto protege se algo foi commitado antes)
rem ---------------------------------------------------------------
echo --- Removendo segredos/artefatos do versionamento ---
git rm -r --cached --quiet --ignore-unmatch "storage" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch ".env" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch ".env.local" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "node_modules" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "coverage" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "test-results" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "playwright-report" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "*.sqlite" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "*.db" >nul 2>&1

rem ---------------------------------------------------------------
rem  Adiciona todas as alteracoes
rem ---------------------------------------------------------------
echo --- Adicionando alteracoes ao stage ---
git add -A

rem ---------------------------------------------------------------
rem  Mensagem do commit: usa o argumento passado ou uma padrao.
rem  Uso: publicar-github.bat "sua mensagem de commit"
rem ---------------------------------------------------------------
set "MSG=%~1"
if "!MSG!"=="" set "MSG=chore(publicar): atualizacao do Kairo"

git diff --cached --quiet
if errorlevel 1 (
    echo --- Commit: !MSG! ---
    git commit -m "!MSG!"
) else (
    echo --- Nada novo para commitar ^(arvore limpa^) ---
)

rem ---------------------------------------------------------------
rem  Sincroniza com o remoto antes do push (evita rejeicao)
rem ---------------------------------------------------------------
echo --- Sincronizando com origin/main ^(pull --rebase^) ---
git pull --rebase --autostash origin main
if errorlevel 1 (
    echo.
    echo [ERRO] Conflito no rebase com o remoto.
    echo        Resolva os conflitos manualmente e rode novamente.
    echo        Para abortar: git rebase --abort
    echo.
    pause
    exit /b 1
)

rem ---------------------------------------------------------------
rem  Envia para o GitHub
rem ---------------------------------------------------------------
echo --- Enviando para origin main ^(push^) ---
git push origin main
if errorlevel 1 (
    echo.
    echo [ERRO] Falha no push. Verifique credencial/token ^(HTTPS^) ou
    echo        chave SSH ^(remoto SSH^), permissao no repositorio e internet.
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   [SUCESSO] Kairo publicado no GitHub ^(main^).
echo   Dica: publicar-github.bat "sua mensagem de commit"
echo ============================================================
pause
endlocal

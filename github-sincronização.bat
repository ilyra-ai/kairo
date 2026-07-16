@echo off
setlocal enabledelayedexpansion
title Kairo - Sincronizacao com GitHub (main)
cd /d "%~dp0"

echo ============================================================
echo   Kairo - Domine o Seu Tempo
echo   Sincronizacao com GitHub - branch main (origin)
echo ============================================================
echo.

rem ---------------------------------------------------------------
rem  0) Verificacoes basicas de ambiente
rem ---------------------------------------------------------------
where git >nul 2>&1
if errorlevel 1 (
    echo [ERRO] Git nao encontrado no PATH.
    echo        Instale em https://git-scm.com/download/win e reabra o terminal.
    echo.
    pause
    exit /b 1
)

if not exist ".git" (
    echo [ERRO] Esta pasta nao e um repositorio Git ^(.git nao encontrado^).
    echo        Local atual: %CD%
    echo.
    pause
    exit /b 1
)

rem ---------------------------------------------------------------
rem  1) Corrige lock travado de operacoes anteriores interrompidas
rem ---------------------------------------------------------------
if exist ".git\index.lock" (
    echo --- Removendo lock travado ^(.git\index.lock^) ---
    del /f /q ".git\index.lock" >nul 2>&1
)

rem ---------------------------------------------------------------
rem  2) Garante identidade do autor dos commits
rem ---------------------------------------------------------------
echo --- Configurando identidade do commit ---
git config user.name "ilyra-ai"
git config user.email "douglas@ilyra.com.br"

rem ---------------------------------------------------------------
rem  3) CAUSA RAIZ: deixa de rastrear bancos, segredos e artefatos
rem     que NAO deveriam estar no versionamento. O .gitignore ja os
rem     ignora, mas arquivos commitados ANTES da regra continuam
rem     rastreados. "git rm --cached" para de rastrear SEM apagar do
rem     disco. O --ignore-unmatch evita erro quando nao existir.
rem ---------------------------------------------------------------
echo --- Deixando de rastrear bancos de dados locais ---
git rm -r --cached --quiet --ignore-unmatch "storage" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "*.db" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "*.sqlite" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "*.sqlite3" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "*.db-journal" >nul 2>&1

echo --- Deixando de rastrear segredos e dependencias ---
git rm -r --cached --quiet --ignore-unmatch ".env" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch ".env.local" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "node_modules" >nul 2>&1

echo --- Deixando de rastrear artefatos de QA e cobertura ---
git rm -r --cached --quiet --ignore-unmatch "coverage" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "test-results" >nul 2>&1
git rm -r --cached --quiet --ignore-unmatch "playwright-report" >nul 2>&1

rem ---------------------------------------------------------------
rem  4) Adiciona TODAS as alteracoes (o .gitignore protege
rem     storage/ node_modules/ .env/ *.sqlite/ coverage/ etc.)
rem ---------------------------------------------------------------
echo --- Adicionando alteracoes ao stage ---
git add -A

rem ---------------------------------------------------------------
rem  5) Commit apenas se houver algo preparado (evita commit vazio)
rem ---------------------------------------------------------------
git diff --cached --quiet
if errorlevel 1 (
    echo --- Criando commit ---
    for /f "tokens=1-3 delims=/ " %%a in ("%date%") do set HOJE=%%a-%%b-%%c
    set HORA=%time:~0,5%
    git commit -m "chore(sync): sincronizacao main - Kairo [!HOJE! !HORA!]"
) else (
    echo --- Nada novo para commitar ^(arvore limpa^) ---
)

rem ---------------------------------------------------------------
rem  6) Detecta o remoto configurado (SSH ou HTTPS)
rem ---------------------------------------------------------------
set "URL_ORIGIN="
for /f "delims=" %%u in ('git remote get-url origin 2^>nul') do set "URL_ORIGIN=%%u"
if "!URL_ORIGIN!"=="" (
    echo [ERRO] Nenhum remoto 'origin' configurado.
    echo        Configure com:
    echo        git remote add origin https://github.com/ilyra-ai/kairo.git
    echo.
    pause
    exit /b 1
)
echo --- Remoto origin: !URL_ORIGIN! ---

rem ---------------------------------------------------------------
rem  6b) Se o remoto for SSH, testa a conexao antes do push
rem ---------------------------------------------------------------
echo !URL_ORIGIN! | findstr /b /c:"git@" >nul
if not errorlevel 1 (
    echo --- Testando conexao SSH com o GitHub ---
    ssh -T -o BatchMode=yes -o StrictHostKeyChecking=accept-new git@github.com 2>&1 | findstr /i "successfully" >nul
    if errorlevel 1 (
        echo [AVISO] Conexao SSH ainda nao autenticada.
        echo         Configure sua chave SSH no GitHub e rode de novo.
    ) else (
        echo [OK] SSH autenticado no GitHub.
    )
) else (
    echo --- Remoto HTTPS: a autenticacao usara o Gerenciador de
    echo     Credenciais do Windows ou o seu token pessoal ^(PAT^).
)

rem ---------------------------------------------------------------
rem  7) Traz o que houver no remoto (rebase) para evitar rejeicao
rem     por historico divergente ^(non-fast-forward^)
rem ---------------------------------------------------------------
echo.
echo --- Sincronizando com origin/main ^(pull --rebase^) ---
git pull --rebase --autostash origin main
if errorlevel 1 (
    echo.
    echo [ERRO] Houve conflito no rebase com o remoto.
    echo        Resolva os conflitos manualmente e rode novamente.
    echo        Para abortar: git rebase --abort
    echo.
    pause
    exit /b 1
)

rem ---------------------------------------------------------------
rem  8) Envia para o GitHub
rem ---------------------------------------------------------------
echo.
echo --- Enviando para origin main ^(push^) ---
git push origin main
if errorlevel 1 (
    echo.
    echo [ERRO] Falha no push. Causas mais comuns:
    echo        - Credencial/token nao autorizado ^(HTTPS^)
    echo        - Chave SSH nao liberada no GitHub ^(remoto SSH^)
    echo        - Sem permissao de escrita no repositorio
    echo        - Sem acesso a internet
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   [SUCESSO] Kairo sincronizado com o GitHub ^(main^).
echo ============================================================
echo.
pause
endlocal

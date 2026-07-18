@echo off
title Kairo - Servidor local para QA (nao feche esta janela)
cd /d "%~dp0"
echo ============================================================
echo   Kairo - Iniciando servidor local para QA navegado
echo   Endereco: http://localhost:3000
echo   Mantenha esta janela aberta durante o QA.
echo ============================================================
if not exist "node_modules" (
    echo --- Instalando dependencias ^(primeira vez^) ---
    call npm ci --no-audit --no-fund
)
call npm start
pause

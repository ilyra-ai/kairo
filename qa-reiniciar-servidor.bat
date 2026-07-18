@echo off
title Kairo - Reiniciar servidor local de QA
cd /d "%~dp0"
echo ============================================================
echo   Kairo - Reiniciando o servidor local de QA
echo   Encerra apenas o processo que ocupa a porta 3000.
echo ============================================================
echo.

echo --- Procurando processo na porta 3000 ---
set "ENCONTROU="
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3000 .*LISTENING"') do (
    if not "%%p"=="0" (
        echo     Encerrando PID %%p
        taskkill /F /PID %%p >nul 2>&1
        set "ENCONTROU=1"
    )
)
if not defined ENCONTROU echo     Nenhum processo ocupando a porta 3000.

timeout /t 2 /nobreak >nul

echo.
echo --- Iniciando o servidor com o codigo atual ---
echo     Endereco: http://localhost:3000
echo     Mantenha esta janela aberta durante o QA.
echo.
call npm start
pause

@echo off
setlocal EnableDelayedExpansion
title Kairo - Domine o Seu Tempo
chcp 65001 >nul

REM ==========================================================================
REM  Kairo - Orquestrador de Projeto (Windows 11)
REM  Domine o Seu Tempo - Painel de controle premium (2026)
REM  Uso: duplo-clique em run.bat  ou  run.bat start ^| dev ^| install ^| reset
REM ==========================================================================

REM --- Habilita sequencias ANSI (Windows 10/11) ---
for /f "delims=" %%a in ('echo prompt $E^| cmd') do set "ESC=%%a"
set "ROXO=%ESC%[38;2;124;111;255m"
set "LARANJA=%ESC%[38;2;255;139;90m"
set "VERDE=%ESC%[38;2;76;201;145m"
set "VERM=%ESC%[38;2;255;95;95m"
set "AMAR=%ESC%[38;2;241;196;15m"
set "CINZA=%ESC%[38;2;150;150;170m"
set "BRANCO=%ESC%[38;2;245;245;250m"
set "NEG=%ESC%[1m"
set "RST=%ESC%[0m"

set "PORTA=%PORT%"
if "%PORTA%"=="" set "PORTA=3000"
cd /d "%~dp0"

REM --- Roteamento por argumento direto ---
if /i "%~1"=="start"   goto SUBIR_START
if /i "%~1"=="dev"     goto SUBIR_DEV
if /i "%~1"=="install" ( call :INSTALAR & pause & goto EOF )
if /i "%~1"=="reset"   ( call :RESET_DB & pause & goto EOF )
goto MENU

:CABECALHO
cls
echo(
echo   %ROXO%%NEG%+==========================================================+%RST%
echo   %ROXO%%NEG%^|%RST%   %LARANJA%(o)%RST%  %BRANCO%%NEG%K A I R O%RST%   %CINZA%- Domine o Seu Tempo%RST%                %ROXO%%NEG%^|%RST%
echo   %ROXO%%NEG%^|%RST%   %CINZA%Orquestrador de Projeto - Windows 11 - Edicao 2026%RST%     %ROXO%%NEG%^|%RST%
echo   %ROXO%%NEG%+==========================================================+%RST%
echo(
exit /b

:BARRA
REM  %1 = rotulo   %2 = passos
set "ROTULO=%~1"
set /a TOTAL=%~2
set /a I=0
:BARRA_LOOP
set /a PCT=I*100/TOTAL
set /a FILL=I*32/TOTAL
set "BAR="
for /l %%x in (1,1,%FILL%) do set "BAR=!BAR!#"
set /a EMPT=32-FILL
for /l %%x in (1,1,%EMPT%) do set "BAR=!BAR!."
<nul set /p "=  %ROXO%%ROTULO%%RST% [%LARANJA%!BAR!%RST%] %NEG%!PCT!%%%RST%%ESC%[0K`r"
ping -n 1 -w 30 127.0.0.1 >nul
set /a I+=1
if !I! LEQ %TOTAL% goto BARRA_LOOP
echo(
exit /b

:CHECAR
echo   %BRANCO%%NEG%Diagnostico do ambiente%RST%
echo   %CINZA%--------------------------------------------%RST%
where node >nul 2>&1
if %errorlevel%==0 (
  for /f "delims=" %%v in ('node -v') do echo   %VERDE%[ok]%RST% Node.js ....... %BRANCO%%%v%RST%
) else (
  echo   %VERM%[x]%RST% Node.js nao encontrado. Instale: %ROXO%https://nodejs.org%RST%
)
where npm >nul 2>&1
if %errorlevel%==0 (
  for /f "delims=" %%v in ('npm -v') do echo   %VERDE%[ok]%RST% npm ........... %BRANCO%%%v%RST%
) else (
  echo   %VERM%[x]%RST% npm nao encontrado.
)
if exist node_modules (
  echo   %VERDE%[ok]%RST% Dependencias .. %BRANCO%instaladas%RST%
) else (
  echo   %AMAR%[..]%RST% Dependencias .. %AMAR%ausentes ^(use a opcao 3^)%RST%
)
netstat -ano | findstr /r /c:":%PORTA% .*LISTENING" >nul 2>&1
if %errorlevel%==0 (
  echo   %AMAR%[..]%RST% Porta %PORTA% ..... %AMAR%em uso%RST%
) else (
  echo   %VERDE%[ok]%RST% Porta %PORTA% ..... %BRANCO%livre%RST%
)
echo(
exit /b

:INSTALAR
call :CABECALHO
if not exist package.json (
  echo   %VERM%[x] package.json nao encontrado neste diretorio.%RST%
  exit /b 1
)
echo   %BRANCO%Instalando dependencias do Kairo...%RST%
call :BARRA "Preparando" 10
call npm install --no-audit --no-fund
if %errorlevel%==0 (
  echo   %VERDE%[ok] Dependencias prontas.%RST%
) else (
  echo   %VERM%[x] Falha ao instalar dependencias.%RST%
)
exit /b

:RESET_DB
call :CABECALHO
if exist database.sqlite (
  call :BARRA "Removendo banco atual" 10
  del /f /q database.sqlite
  echo   %VERDE%[ok] Banco removido. Sera recriado ^(seed^) na proxima inicializacao.%RST%
) else (
  echo   %AMAR%[..] Nenhum banco encontrado - nada a fazer.%RST%
)
exit /b

:ABRIR_NAV
echo   %ROXO%^>^>%RST% Abrindo %BRANCO%http://localhost:%PORTA%%RST% ...
start "" "http://localhost:%PORTA%"
exit /b

:SUBIR_START
set "MODO=start"
goto PREPARAR
:SUBIR_DEV
set "MODO=dev"
goto PREPARAR

:PREPARAR
call :CABECALHO
call :CHECAR
if not exist node_modules ( call :INSTALAR )
call :BARRA "Preparando servidor" 16
echo(
echo   %VERDE%%NEG%^> Servidor Kairo iniciando em modo '%MODO%'%RST%
echo   %CINZA%   URL: %ROXO%http://localhost:%PORTA%%RST%
echo   %CINZA%   ^(Feche esta janela ou Ctrl+C para encerrar^)%RST%
echo(
REM Abre o navegador apos um pequeno atraso, em paralelo
start "" /b cmd /c "ping -n 3 127.0.0.1 >nul & start """" ""http://localhost:%PORTA%"""
set "PORT=%PORTA%"
if /i "%MODO%"=="dev" ( call npm run dev ) else ( call npm start )
goto EOF

:MENU
call :CABECALHO
echo   %BRANCO%%NEG%Escolha uma acao:%RST%
echo(
echo    %ROXO%1%RST%  %VERDE%^>%RST%  Iniciar aplicacao  %CINZA%^(producao^)%RST%
echo    %ROXO%2%RST%  %AMAR%*%RST%  Modo desenvolvimento  %CINZA%^(nodemon, hot-reload^)%RST%
echo    %ROXO%3%RST%  %LARANJA%v%RST%  Instalar / atualizar dependencias
echo    %ROXO%4%RST%  %LARANJA%o%RST%  Reiniciar banco de dados  %CINZA%^(seed limpo^)%RST%
echo    %ROXO%5%RST%  %ROXO%^>^>%RST% Abrir no navegador
echo    %ROXO%6%RST%  %VERDE%ok%RST% Diagnostico do ambiente
echo    %ROXO%0%RST%  %VERM%x%RST%  Sair
echo(
set /p "OPC=  %BRANCO%-^> Opcao: %RST%"
if "%OPC%"=="1" goto SUBIR_START
if "%OPC%"=="2" goto SUBIR_DEV
if "%OPC%"=="3" ( call :INSTALAR & echo( & pause & goto MENU )
if "%OPC%"=="4" ( call :RESET_DB & echo( & pause & goto MENU )
if "%OPC%"=="5" ( call :CABECALHO & call :ABRIR_NAV & echo( & pause & goto MENU )
if "%OPC%"=="6" ( call :CABECALHO & call :CHECAR & pause & goto MENU )
if "%OPC%"=="0" goto SAIR
goto MENU

:SAIR
echo(
echo   %ROXO%Ate logo! Foque no que importa. (o)%RST%
echo(
timeout /t 1 >nul
goto EOF

:EOF
endlocal

@echo off
title Kairo - Provisionamento do administrador
cd /d "%~dp0"
echo Provisionando conta administrativa...
node scripts\admin\provisionar-administrador.mjs --email "admin@admin.com" --senha "admin230982@" --nome "Administrador Kairo"
echo.
echo Pressione uma tecla para fechar.
pause >nul

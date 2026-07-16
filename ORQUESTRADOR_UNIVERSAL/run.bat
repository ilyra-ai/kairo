@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "ORCH_SELF=%~f0"
set "ORCH_BATCH_ARGS=%*"
where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo ERRO: Windows PowerShell 5.1 ou superior nao foi encontrado.
    exit /b 1
)
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$p=$env:ORCH_SELF; $m='#<ORCHESTRATOR_POWERSHELL>'; $t=[IO.File]::ReadAllText($p); $i=$t.LastIndexOf($m); if($i -lt 0){Write-Error 'Payload PowerShell nao encontrado.'; exit 97}; $c=$t.Substring($i+$m.Length); & ([ScriptBlock]::Create($c))"
set "ORCH_EXIT=%ERRORLEVEL%"
endlocal & exit /b %ORCH_EXIT%
#<ORCHESTRATOR_POWERSHELL>

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ORQUESTRADOR UNIVERSAL — TUI Noir Elite para Windows 11
# Arquivo único: run.bat na raiz do projeto.
# Requer apenas o Windows PowerShell 5.1, incluído no Windows 11.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$script:Version = '5.0.0'
if ($env:ORCH_PROJECT_DIR) {
    $script:ProjectDir = [IO.Path]::GetFullPath($env:ORCH_PROJECT_DIR)
    if (-not (Test-Path -LiteralPath $script:ProjectDir -PathType Container)) { throw "ORCH_PROJECT_DIR inválido: $env:ORCH_PROJECT_DIR" }
} else {
    $script:ProjectDir = [IO.Path]::GetFullPath((Split-Path -Parent $env:ORCH_SELF))
}
$script:ComponentMode = ($env:ORCH_COMPONENT_MODE -eq '1')
$script:OrchDir = Join-Path $script:ProjectDir '.orchestrator'
$script:LogFile = Join-Path $script:OrchDir 'orchestrator-windows.log'
$script:PidFile = Join-Path $script:OrchDir 'server-windows.pid'
$script:MetaFile = Join-Path $script:OrchDir 'server-windows.json'
$script:DepsStampFile = Join-Path $script:OrchDir 'dependencies-windows.sha256'
$script:DetectionFile = Join-Path $script:OrchDir 'detection-windows.json'
New-Item -ItemType Directory -Path $script:OrchDir -Force | Out-Null
if (-not (Test-Path $script:LogFile)) { New-Item -ItemType File -Path $script:LogFile -Force | Out-Null }

# ──────────────────────────────────────────────────────────────────────────────
# Argumentos
# ──────────────────────────────────────────────────────────────────────────────
$script:ListActions = $false
$script:RequestedAction = ''
$script:BootstrapOnly = $false
$script:DryRun = $false
$script:NoBootstrap = $false
$script:NonInteractive = $false
$script:Port = 0
$script:PortExplicit = $false

function Split-OrchestratorArguments {
    param([string]$Raw)
    if ([string]::IsNullOrWhiteSpace($Raw)) { return @() }
    $items = New-Object System.Collections.Generic.List[string]
    foreach ($m in [regex]::Matches($Raw, '"(?:[^"\\]|\\.)*"|\S+')) {
        $v = $m.Value
        if ($v.Length -ge 2 -and $v.StartsWith('"') -and $v.EndsWith('"')) {
            $v = $v.Substring(1, $v.Length - 2).Replace('\"','"')
        }
        $items.Add($v)
    }
    return $items.ToArray()
}

function Show-Help {
@'
Uso: run.bat [opções]

Opções:
  --list-actions          Lista somente as ações realmente detectadas.
  --action ID             Executa uma ação detectada.
  --port N                Define a porta preferencial.
  --bootstrap-only        Instala/verifica dependências e encerra.
  --dry-run               Mostra comandos sem alterar o projeto.
  --no-bootstrap          Não instala runtimes/dependências automaticamente.
  --help, -h              Exibe esta ajuda.

Variáveis:
  PORT=N                  Porta preferencial.
  NO_COLOR=1              Desativa cores ANSI.
  ORCH_AUTO_CONFIRM=1     Confirma ações destrutivas não interativas.

Coloque este run.bat na raiz do projeto e execute-o nessa raiz.
'@ | Write-Host
}

function Test-ValidPort {
    param([string]$Value)
    $n = 0
    return [int]::TryParse($Value, [ref]$n) -and $n -ge 1 -and $n -le 65535
}

if ($env:PORT -and (Test-ValidPort $env:PORT)) {
    $script:Port = [int]$env:PORT
    $script:PortExplicit = $true
}

$parsedArgs = Split-OrchestratorArguments $env:ORCH_BATCH_ARGS
for ($i = 0; $i -lt $parsedArgs.Count; $i++) {
    $arg = $parsedArgs[$i]
    switch -Regex ($arg) {
        '^--list-actions$' { $script:ListActions = $true; $script:NonInteractive = $true; continue }
        '^--bootstrap-only$' { $script:BootstrapOnly = $true; $script:NonInteractive = $true; continue }
        '^--dry-run$' { $script:DryRun = $true; continue }
        '^--no-bootstrap$' { $script:NoBootstrap = $true; continue }
        '^(--help|-h)$' { Show-Help; exit 0 }
        '^--action=(.+)$' { $script:RequestedAction = $Matches[1]; $script:NonInteractive = $true; continue }
        '^--port=(\d+)$' {
            if (-not (Test-ValidPort $Matches[1])) { throw "Porta inválida: $($Matches[1])" }
            $script:Port = [int]$Matches[1]; $script:PortExplicit = $true; continue
        }
        '^--action$' {
            if ($i + 1 -ge $parsedArgs.Count) { throw '--action exige um identificador.' }
            $i++; $script:RequestedAction = $parsedArgs[$i]; $script:NonInteractive = $true; continue
        }
        '^--port$' {
            if ($i + 1 -ge $parsedArgs.Count) { throw '--port exige um número.' }
            $i++
            if (-not (Test-ValidPort $parsedArgs[$i])) { throw "Porta inválida: $($parsedArgs[$i])" }
            $script:Port = [int]$parsedArgs[$i]; $script:PortExplicit = $true; continue
        }
        default { throw "Argumento desconhecido: $arg" }
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# Console ANSI / UTF-8
# ──────────────────────────────────────────────────────────────────────────────
try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $global:OutputEncoding = [Console]::OutputEncoding
} catch {}

try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OrchestratorConsole {
    [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr GetStdHandle(int nStdHandle);
    [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);
    [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
    public static void EnableVT() {
        IntPtr h = GetStdHandle(-11);
        uint mode;
        if (GetConsoleMode(h, out mode)) SetConsoleMode(h, mode | 0x0004 | 0x0008);
    }
}
'@
    [OrchestratorConsole]::EnableVT()
} catch {}

$script:Esc = [char]27
$script:UseColor = -not $env:NO_COLOR -and -not [Console]::IsOutputRedirected
function Ansi([string]$Code) { if ($script:UseColor) { return "$script:Esc[$Code" } return '' }
$script:FGMain = Ansi '38;2;230;237;243m'
$script:FGSec = Ansi '38;2;139;148;158m'
$script:FGDim = Ansi '38;2;110;118;129m'
$script:AccentCyan = Ansi '38;2;86;211;255m'
$script:AccentMint = Ansi '38;2;125;239;161m'
$script:AccentAmber = Ansi '38;2;255;183;77m'
$script:AccentRose = Ansi '38;2;255;107;129m'
$script:StateOk = Ansi '38;2;63;185;80m'
$script:StateWarn = Ansi '38;2;210;153;34m'
$script:StateErr = Ansi '38;2;248;81;73m'
$script:BGHover = Ansi '48;2;33;38;45m'
$script:Bold = Ansi '1m'
$script:Dim = Ansi '2m'
$script:Reset = Ansi '0m'
$script:EraseLine = Ansi 'K'

$script:IDot = '•'
$script:IArr = '→'
$script:ICheck = '✔'
$script:IWarn = '⚠'
$script:ICross = '✖'
$script:ITerm = '❯'

# ──────────────────────────────────────────────────────────────────────────────
# Estado e modelos
# ──────────────────────────────────────────────────────────────────────────────
$script:Selected = 0
$script:MenuTop = 0
$script:MenuVisible = 8
$script:CurrentTask = 'Standby'
$script:Progress = 0
$script:StartTime = Get-Date
$script:LastMessage = ''
$script:LastStatus = ''
$script:ScrollPosition = 0
$script:LiveRows = 5
$script:LogMax = 1000
$script:InAltScreen = $false
$script:CleanupDone = $false
$script:AppActive = $false
$script:ServerPid = 0
$script:ServerStartTicks = 0L
$script:ServerCommandFile = ''
$script:LastActionExitCode = 0
$script:ProjectName = Split-Path -Leaf $script:ProjectDir
$script:ProjectVersion = ''
$script:ProjectKind = 'Projeto'
$script:RuntimeSummary = ''
$script:DefaultPort = 8000
$script:NodeManager = ''
$script:NodeDeclaredManager = ''
$script:PythonManager = ''
$script:PythonCommand = ''
$script:DockerComposeCommand = 'docker compose'
$script:Stacks = New-Object System.Collections.ArrayList
$script:Manifests = New-Object System.Collections.ArrayList
$script:Dependencies = New-Object System.Collections.ArrayList
$script:Runtimes = New-Object System.Collections.ArrayList
$script:Actions = New-Object System.Collections.ArrayList
$script:ComponentDirs = New-Object System.Collections.ArrayList
$script:ComponentDescriptions = New-Object System.Collections.ArrayList
$script:LiveLines = New-Object System.Collections.ArrayList
$script:LogLines = New-Object System.Collections.ArrayList

function Write-Log {
    param([string]$Level, [string]$Message)
    $entry = '[{0}] [{1}] {2}' -f (Get-Date -Format 'HH:mm:ss'), $Level, $Message
    [void]$script:LogLines.Add($entry)
    while ($script:LogLines.Count -gt $script:LogMax) { $script:LogLines.RemoveAt(0) }
    Add-Content -LiteralPath $script:LogFile -Value $entry -Encoding UTF8
}
function Write-PlainInfo([string]$Message) { Write-Host "  [INFO] $Message"; Write-Log 'INFO' $Message }
function Write-PlainOk([string]$Message) { Write-Host "  [ OK ] $Message"; Write-Log ' OK ' $Message }
function Write-PlainWarn([string]$Message) { Write-Host "  [AVISO] $Message"; Write-Log 'WARN' $Message }
function Write-PlainError([string]$Message) { [Console]::Error.WriteLine("  [ERRO] $Message"); Write-Log 'ERRO' $Message }

function Add-Unique {
    param([System.Collections.ArrayList]$List, [string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return }
    if (-not $List.Contains($Value)) { [void]$List.Add($Value) }
}
function Add-Stack([string]$Name) { Add-Unique $script:Stacks $Name }
function Add-Manifest([string]$Path) { if (Test-Path -LiteralPath $Path -PathType Leaf) { Add-Unique $script:Manifests ([IO.Path]::GetFullPath($Path)) } }
function Add-Dependency {
    param([string]$Command, [string]$Description)
    if ([string]::IsNullOrWhiteSpace($Command)) { return }
    foreach ($item in $script:Dependencies) { if ($item.Command -eq $Command) { return } }
    [void]$script:Dependencies.Add([pscustomobject]@{ Command=$Command; Description=$Description })
}
function Add-Runtime {
    param([string]$Command, [string]$Name, [string[]]$WingetIds, [string]$Installer='winget')
    foreach ($item in $script:Runtimes) { if ($item.Command -eq $Command) { return } }
    [void]$script:Runtimes.Add([pscustomobject]@{ Command=$Command; Name=$Name; WingetIds=$WingetIds; Installer=$Installer })
}
function Add-Action {
    param([string]$Id,[string]$Label,[string]$Description,[string]$Command='',[string]$Kind='command',[bool]$Confirm=$false)
    $internal = @('health','logs','stop','exit','refresh','python_imports','subproject')
    if ([string]::IsNullOrWhiteSpace($Command) -and -not $internal.Contains($Kind)) { return }

    $baseId = $Id
    $suffix = 2
    while ($null -ne ($script:Actions | Where-Object { $_.Id -eq $Id } | Select-Object -First 1)) {
        $Id = '{0}_{1}' -f $baseId, $suffix
        $suffix++
    }
    [void]$script:Actions.Add([pscustomobject]@{Id=$Id;Label=$Label;Description=$Description;Command=$Command;Kind=$Kind;Confirm=$Confirm})
}
function Relative-Path([string]$Path) {
    $root = $script:ProjectDir.TrimEnd('\') + '\'
    if ($Path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { return $Path.Substring($root.Length) }
    return $Path
}
function Test-Command([string]$Name) { return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue) }
function Quote-Cmd([string]$Value) { return '"' + $Value.Replace('"','""') + '"' }

# ──────────────────────────────────────────────────────────────────────────────
# JSON, arquivos e dependências
# ──────────────────────────────────────────────────────────────────────────────
function Read-JsonFile([string]$Path) {
    try { return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json) } catch { return $null }
}
function Get-JsonProperty($Object, [string]$Name) {
    if ($null -eq $Object) { return $null }
    $p = $Object.PSObject.Properties[$Name]
    if ($null -eq $p) { return $null }
    return $p.Value
}
function Test-NodeDependency {
    param([string]$Dependency)
    $files = Get-ChildItem -LiteralPath $script:ProjectDir -Filter package.json -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\(node_modules|\.git|dist|build)\\' } |
        Select-Object -First 100
    foreach ($file in $files) {
        $pkg = Read-JsonFile $file.FullName
        foreach ($section in @('dependencies','devDependencies','peerDependencies','optionalDependencies')) {
            $obj = Get-JsonProperty $pkg $section
            if ($null -ne $obj -and $null -ne $obj.PSObject.Properties[$Dependency]) { return $true }
        }
    }
    return $false
}
function Add-StackForNodeDependency([string]$Dependency,[string]$Label) { if (Test-NodeDependency $Dependency) { Add-Stack $Label } }
function Test-TextInPythonManifests([string]$Pattern) {
    foreach ($name in @('pyproject.toml','requirements.txt','requirements-dev.txt','Pipfile','poetry.lock','uv.lock','setup.py','setup.cfg')) {
        $path = Join-Path $script:ProjectDir $name
        if (Test-Path $path) {
            if (Select-String -LiteralPath $path -Pattern $Pattern -Quiet -ErrorAction SilentlyContinue) { return $true }
        }
    }
    return $false
}
function Find-PythonFile([string]$Pattern) {
    $files = Get-ChildItem -LiteralPath $script:ProjectDir -Filter *.py -File -Recurse -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -notmatch '\\(\.venv|venv|site-packages|node_modules|\.git|dist|build)\\' } |
        Select-Object -First 1000
    foreach ($file in $files) {
        if (Select-String -LiteralPath $file.FullName -Pattern $Pattern -Quiet -ErrorAction SilentlyContinue) { return $file.FullName }
    }
    return ''
}

# ──────────────────────────────────────────────────────────────────────────────
# Detecção Node.js e frameworks web/mobile/IA
# ──────────────────────────────────────────────────────────────────────────────
function Get-NodeRunner {
    switch ($script:NodeManager) { 'pnpm' { 'pnpm run' } 'yarn' { 'yarn' } 'bun' { 'bun run' } default { 'npm run' } }
}
function Get-NodeExec {
    switch ($script:NodeManager) { 'pnpm' { 'pnpm exec' } 'yarn' { 'yarn' } 'bun' { 'bunx' } default { 'npm exec --' } }
}
function Add-NodeScriptAction([string]$Name,[string]$Runner) {
    switch -Regex ($Name) {
        '^(dev|develop)$' { Add-Action 'START_DEV' '🚀 Iniciar Desenvolvimento' "Executar script $Name" "$Runner $Name" 'server'; break }
        '^(start|serve)$' { Add-Action 'START_PROD' '🌐 Iniciar Aplicação' "Executar script $Name" "$Runner $Name" 'server'; break }
        '^preview$' { Add-Action 'PREVIEW' '👁 Visualizar Build' 'Executar script preview' "$Runner preview" 'server'; break }
        '^build$' { Add-Action 'BUILD' '🏗 Construir Projeto' 'Executar script build' "$Runner build"; break }
        '^(test|test:unit|test:integration)$' { Add-Action ("TEST_"+$Name.Replace(':','_')) '🧪 Executar Testes' "Executar script $Name" "$Runner $Name"; break }
        '^lint$' { Add-Action 'LINT' '🔎 Executar Lint' 'Executar script lint' "$Runner lint"; break }
        '^(format|format:write)$' { Add-Action 'FORMAT' '✨ Formatar Código' "Executar script $Name" "$Runner $Name"; break }
        '^(typecheck|type-check|check:types)$' { Add-Action 'TYPECHECK' '🧬 Verificar Tipos' "Executar script $Name" "$Runner $Name"; break }
        '^(check|validate)$' { Add-Action 'CHECK' '✅ Executar Verificações' "Executar script $Name" "$Runner $Name"; break }
        '^(e2e|test:e2e|qa|test:qa)$' { Add-Action 'E2E' '🌐 Testes E2E / QA' "Executar script $Name" "$Runner $Name"; break }
        '^storybook$' { Add-Action 'STORYBOOK' '📚 Iniciar Storybook' 'Executar Storybook' "$Runner storybook" 'server'; break }
        '^build-storybook$' { Add-Action 'BUILD_STORYBOOK' '📦 Construir Storybook' 'Executar build-storybook' "$Runner build-storybook"; break }
        '^(db:migrate|migrate|migration:run|prisma:migrate|typeorm:migration:run)$' { Add-Action 'MIGRATE' '🗄 Aplicar Migrações' "Executar script $Name" "$Runner $Name"; break }
        '^(db:push|prisma:push)$' { Add-Action 'DB_PUSH' '🗄 Sincronizar Banco' "Executar script $Name" "$Runner $Name"; break }
        '^(db:seed|seed|prisma:seed)$' { Add-Action 'SEED' '🌱 Popular Banco' "Executar script $Name" "$Runner $Name"; break }
        '^(db:reset|reset|prisma:reset)$' { Add-Action 'RESET_DB' '♻ Resetar Banco' "Executar script $Name" "$Runner $Name" 'command' $true; break }
        '^clean$' { Add-Action 'CLEAN' '🧹 Limpar Artefatos' 'Executar script clean' "$Runner clean" 'command' $true; break }
    }
}
function Detect-NodeProject {
    $file = Join-Path $script:ProjectDir 'package.json'
    if (-not (Test-Path $file)) { return }
    $pkg = Read-JsonFile $file
    if ($null -eq $pkg) { throw 'package.json inválido.' }
    Add-Stack 'Node.js'; Add-Manifest $file
    foreach ($name in @('package-lock.json','npm-shrinkwrap.json','pnpm-lock.yaml','yarn.lock','bun.lock','bun.lockb')) { Add-Manifest (Join-Path $script:ProjectDir $name) }
    $declared = [string](Get-JsonProperty $pkg 'packageManager')
    $script:NodeDeclaredManager = $declared
    if ($declared -like 'pnpm@*' -or (Test-Path (Join-Path $script:ProjectDir 'pnpm-lock.yaml'))) { $script:NodeManager='pnpm' }
    elseif ($declared -like 'yarn@*' -or (Test-Path (Join-Path $script:ProjectDir 'yarn.lock'))) { $script:NodeManager='yarn' }
    elseif ($declared -like 'bun@*' -or (Test-Path (Join-Path $script:ProjectDir 'bun.lock')) -or (Test-Path (Join-Path $script:ProjectDir 'bun.lockb'))) { $script:NodeManager='bun' }
    else { $script:NodeManager='npm' }
    $n = [string](Get-JsonProperty $pkg 'name'); if ($n) { $script:ProjectName=$n }
    $v = [string](Get-JsonProperty $pkg 'version'); if ($v) { $script:ProjectVersion=$v }
    $script:ProjectKind='Aplicação Node.js'; $script:DefaultPort=3000
    Add-Runtime 'node' 'Node.js LTS' @('OpenJS.NodeJS.LTS')
    Add-Runtime 'npm' 'npm' @('OpenJS.NodeJS.LTS')
    switch ($script:NodeManager) {
        'pnpm' { if (Test-Path (Join-Path $script:ProjectDir 'pnpm-lock.yaml')) { Add-Dependency 'pnpm install --frozen-lockfile' 'Dependências Node.js via pnpm' } else { Add-Dependency 'pnpm install' 'Dependências Node.js via pnpm' } }
        'yarn' { if (Test-Path (Join-Path $script:ProjectDir 'yarn.lock')) { Add-Dependency 'yarn install --immutable || yarn install --frozen-lockfile' 'Dependências Node.js via Yarn' } else { Add-Dependency 'yarn install' 'Dependências Node.js via Yarn' } }
        'bun' { if ((Test-Path (Join-Path $script:ProjectDir 'bun.lock')) -or (Test-Path (Join-Path $script:ProjectDir 'bun.lockb'))) { Add-Dependency 'bun install --frozen-lockfile' 'Dependências Node.js via Bun' } else { Add-Dependency 'bun install' 'Dependências Node.js via Bun' } }
        default { if ((Test-Path (Join-Path $script:ProjectDir 'package-lock.json')) -or (Test-Path (Join-Path $script:ProjectDir 'npm-shrinkwrap.json'))) { Add-Dependency 'npm ci' 'Dependências Node.js via npm' } else { Add-Dependency 'npm install' 'Dependências Node.js via npm' } }
    }
    $runner=Get-NodeRunner
    $scripts=Get-JsonProperty $pkg 'scripts'
    if ($null -ne $scripts) { foreach ($prop in $scripts.PSObject.Properties) { Add-NodeScriptAction $prop.Name $runner } }
    $map = @{
        'react'='React';'next'='Next.js';'vue'='Vue';'nuxt'='Nuxt';'@angular/core'='Angular';'svelte'='Svelte';'@sveltejs/kit'='SvelteKit';
        'astro'='Astro';'@remix-run/react'='Remix';'gatsby'='Gatsby';'solid-js'='SolidJS';'@builder.io/qwik'='Qwik';'vite'='Vite';
        '@nestjs/core'='NestJS';'express'='Express';'fastify'='Fastify';'koa'='Koa';'@adonisjs/core'='AdonisJS';'@strapi/strapi'='Strapi';
        'expo'='Expo';'react-native'='React Native';'@ionic/react'='Ionic';'@ionic/angular'='Ionic';'@capacitor/core'='Capacitor';'@nativescript/core'='NativeScript';
        '@playwright/test'='Playwright';'cypress'='Cypress';'vitest'='Vitest';'jest'='Jest';'@storybook/react'='Storybook';
        '@tensorflow/tfjs'='TensorFlow.js';'@tensorflow/tfjs-node'='TensorFlow.js';'onnxruntime-node'='ONNX Runtime';'@huggingface/transformers'='Transformers.js';
        '@xenova/transformers'='Transformers.js';'langchain'='LangChain.js';'llamaindex'='LlamaIndex';'openai'='OpenAI SDK';'ai'='Vercel AI SDK'
    }
    foreach ($key in $map.Keys) { Add-StackForNodeDependency $key $map[$key] }
    if (Test-NodeDependency 'next') { $script:ProjectKind='Aplicação Next.js' }
    elseif (Test-NodeDependency '@nestjs/core') { $script:ProjectKind='API NestJS' }
    elseif (Test-NodeDependency 'vite') { $script:ProjectKind='Aplicação Vite' }
    $exec=Get-NodeExec
    if ((Test-NodeDependency '@playwright/test') -and ($null -eq ($script:Actions | Where-Object { $_.Id -eq 'E2E' } | Select-Object -First 1))) {
        if ((Test-Path (Join-Path $script:ProjectDir 'playwright.config.ts')) -or (Test-Path (Join-Path $script:ProjectDir 'playwright.config.js'))) { Add-Action 'PLAYWRIGHT' '🌐 Executar Playwright' 'Configuração Playwright detectada' "$exec playwright test" }
    }
    if (Test-NodeDependency 'cypress') {
        if ((Test-Path (Join-Path $script:ProjectDir 'cypress.config.ts')) -or (Test-Path (Join-Path $script:ProjectDir 'cypress.config.js'))) { Add-Action 'CYPRESS' '🌐 Executar Cypress' 'Configuração Cypress detectada' "$exec cypress run" }
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# Detecção Python, IA e dados
# ──────────────────────────────────────────────────────────────────────────────
function Get-BasePythonCommand {
    $venv = Join-Path $script:ProjectDir '.venv\Scripts\python.exe'
    if (Test-Path $venv) { return (Quote-Cmd $venv) }
    if (Test-Command 'py') { return 'py -3' }
    if (Test-Command 'python') { return 'python' }
    throw 'Python foi solicitado pelo projeto, mas nenhum interpretador base está disponível após o bootstrap.'
}
function Get-PythonCommand {
    switch ($script:PythonManager) {
        'uv' { return 'uv run python' }
        'poetry' { return 'poetry run python' }
        'pipenv' { return 'pipenv run python' }
        'conda' {
            $prefix = Join-Path $script:OrchDir 'conda-env'
            return "micromamba run -p $(Quote-Cmd $prefix) python"
        }
    }
    $venv = Join-Path $script:ProjectDir '.venv\Scripts\python.exe'
    if (Test-Path $venv) { return (Quote-Cmd $venv) }
    if (Test-Command 'py') { return 'py -3' }
    return 'python'
}
function Find-FastApiModule {
    $file=Find-PythonFile '^[ \t]*(app|application)[ \t]*=[ \t]*FastAPI\('
    if (-not $file) { return '' }
    $line=(Select-String -LiteralPath $file -Pattern '^[ \t]*(app|application)[ \t]*=[ \t]*FastAPI\(' | Select-Object -First 1).Line
    $var=([regex]::Match($line,'^[ \t]*([A-Za-z_][A-Za-z0-9_]*)')).Groups[1].Value
    $rel=(Relative-Path $file) -replace '\.py$','' -replace '\\','.'
    return "$rel`:$var"
}
function Find-FlaskModule {
    $file=Find-PythonFile '^[ \t]*(app|application)[ \t]*=[ \t]*Flask\('
    if (-not $file) { return '' }
    return ((Relative-Path $file) -replace '\.py$','' -replace '\\','.')
}
function Detect-PythonEcosystem {
    $map=@{
      '(^|[^A-Za-z0-9_-])(torch|pytorch)([^A-Za-z0-9_-]|$)'='PyTorch';'tensorflow'='TensorFlow';'(^|[^A-Za-z0-9_-])jax([^A-Za-z0-9_-]|$)'='JAX';
      'transformers'='Hugging Face Transformers';'diffusers'='Diffusers';'langchain'='LangChain';'(llama-index|llama_index)'='LlamaIndex';
      'scikit-learn'='scikit-learn';'xgboost'='XGBoost';'lightgbm'='LightGBM';'pandas'='pandas';'polars'='Polars';'numpy'='NumPy';
      'pyspark'='PySpark';'(^|[^A-Za-z0-9_-])ray([^A-Za-z0-9_-]|$)'='Ray';'mlflow'='MLflow';'airflow'='Apache Airflow';
      'streamlit'='Streamlit';'gradio'='Gradio';'(jupyterlab|jupyter)'='Jupyter';'fastai'='fastai';'ultralytics'='Ultralytics';'onnxruntime'='ONNX Runtime'
    }
    foreach($pattern in $map.Keys){if(Test-TextInPythonManifests $pattern){Add-Stack $map[$pattern]}}
    $py=Get-PythonCommand
    if(Test-TextInPythonManifests 'streamlit'){
        $f=Find-PythonFile '(^|\s)(import\s+streamlit|from\s+streamlit)'
        if($f){Add-Action 'STREAMLIT' '📊 Iniciar Streamlit' ("Aplicação em "+(Relative-Path $f)) "$py -m streamlit run $(Quote-Cmd (Relative-Path $f)) --server.address 0.0.0.0 --server.port %PORT%" 'server'}
    }
    if(Test-TextInPythonManifests 'gradio'){
        $f=Find-PythonFile '(^|\s)(import\s+gradio|from\s+gradio)'
        if($f -and (Select-String -LiteralPath $f -Pattern '\.launch\(' -Quiet)){Add-Action 'GRADIO' '🧠 Iniciar Gradio' ("Aplicação em "+(Relative-Path $f)) "$py $(Quote-Cmd (Relative-Path $f))" 'server'}
    }
    if((Test-TextInPythonManifests '(jupyterlab|jupyter)') -and (Get-ChildItem $script:ProjectDir -Filter *.ipynb -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1)){
        Add-Action 'JUPYTER' '📓 Iniciar Jupyter Lab' 'Notebooks detectados' "$py -m jupyter lab --ip 0.0.0.0 --port %PORT% --no-browser" 'server'
    }
    if((Test-TextInPythonManifests 'mlflow') -and ((Test-Path (Join-Path $script:ProjectDir 'mlruns')) -or (Test-Path (Join-Path $script:ProjectDir 'mlflow.db')))){
        Add-Action 'MLFLOW' '📈 Iniciar MLflow' 'Armazenamento MLflow detectado' "$py -m mlflow ui --host 0.0.0.0 --port %PORT%" 'server'
    }
}
function Detect-PythonProject {
    $found=$false
    foreach($name in @('pyproject.toml','requirements.txt','requirements-dev.txt','Pipfile','poetry.lock','uv.lock','setup.py','setup.cfg','manage.py','environment.yml','environment.yaml','conda-lock.yml','conda-lock.yaml')){
        $p=Join-Path $script:ProjectDir $name;if(Test-Path $p){Add-Manifest $p;$found=$true}
    }
    if(-not $found){return}
    Add-Stack 'Python';$script:ProjectKind='Aplicação Python';$script:DefaultPort=8000
    $condaFile = @('environment.yml','environment.yaml','conda-lock.yml','conda-lock.yaml') | ForEach-Object { Join-Path $script:ProjectDir $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
    if($condaFile){
        Add-Stack 'Conda/Mamba';$script:PythonManager='conda';Add-Runtime 'micromamba' 'Micromamba' @() 'micromamba'
        $prefix=Join-Path $script:OrchDir 'conda-env';$rel=Relative-Path $condaFile
        $condaCmd="if exist $(Quote-Cmd (Join-Path $prefix 'conda-meta')) (micromamba update -y -p $(Quote-Cmd $prefix) -f $(Quote-Cmd $rel)) else (micromamba create -y -p $(Quote-Cmd $prefix) -f $(Quote-Cmd $rel))"
        Add-Dependency $condaCmd 'Ambiente Conda/Mamba declarado pelo projeto'
    } else {
        Add-Runtime 'python' 'Python 3' @('Python.Python.3.14','Python.Python.3.13','Python.Python.3.12')
    }
    if($script:PythonManager -eq 'conda'){}
    elseif(Test-Path (Join-Path $script:ProjectDir 'uv.lock')){$script:PythonManager='uv';Add-Dependency 'uv sync --frozen' 'Dependências Python via uv'}
    elseif((Test-Path (Join-Path $script:ProjectDir 'poetry.lock')) -or (Test-TextInPythonManifests '\[tool\.poetry\]')){$script:PythonManager='poetry';Add-Dependency 'poetry install --no-interaction' 'Dependências Python via Poetry'}
    elseif(Test-Path (Join-Path $script:ProjectDir 'Pipfile')){$script:PythonManager='pipenv';Add-Dependency 'pipenv sync --dev' 'Dependências Python via Pipenv'}
    elseif(Test-Path (Join-Path $script:ProjectDir 'requirements.txt')){$script:PythonManager='pip';Add-Dependency '".venv\Scripts\python.exe" -m pip install -r requirements.txt' 'Dependências do requirements.txt';if(Test-Path (Join-Path $script:ProjectDir 'requirements-dev.txt')){Add-Dependency '".venv\Scripts\python.exe" -m pip install -r requirements-dev.txt' 'Dependências de desenvolvimento'}}
    elseif(Test-Path (Join-Path $script:ProjectDir 'pyproject.toml')){$script:PythonManager='pip';Add-Dependency '".venv\Scripts\python.exe" -m pip install -e .' 'Projeto Python do pyproject.toml'}
    $py=Get-PythonCommand
    if(Test-Path (Join-Path $script:ProjectDir 'manage.py')){
        Add-Stack 'Django';$script:ProjectKind='Aplicação Django'
        Add-Action 'START_DJANGO' '🚀 Iniciar Django' 'manage.py runserver' "$py manage.py runserver 0.0.0.0:%PORT%" 'server'
        Add-Action 'MIGRATE_DJANGO' '🗄 Aplicar Migrações' 'Django migrate' "$py manage.py migrate --noinput"
        Add-Action 'MAKE_MIGRATIONS' '🧱 Gerar Migrações' 'Django makemigrations' "$py manage.py makemigrations --noinput"
        Add-Action 'CHECK_DJANGO' '✅ Verificar Django' 'Django system check' "$py manage.py check"
        Add-Action 'TEST_DJANGO' '🧪 Testes Django' 'Django test' "$py manage.py test"
        Add-Action 'COLLECT_STATIC' '📦 Coletar Estáticos' 'Django collectstatic' "$py manage.py collectstatic --noinput"
    } else {
        $fast=Find-FastApiModule
        if($fast){Add-Stack 'FastAPI';$script:ProjectKind='API FastAPI';Add-Action 'START_FASTAPI_DEV' '🚀 Iniciar FastAPI Dev' 'Uvicorn com reload' "$py -m uvicorn $fast --host 0.0.0.0 --port %PORT% --reload" 'server';Add-Action 'START_FASTAPI' '🌐 Iniciar FastAPI' 'Uvicorn produção' "$py -m uvicorn $fast --host 0.0.0.0 --port %PORT%" 'server'}
        else{$flask=Find-FlaskModule;if($flask){Add-Stack 'Flask';$script:ProjectKind='Aplicação Flask';Add-Action 'START_FLASK' '🚀 Iniciar Flask' 'Aplicação Flask detectada' "$py -m flask --app $flask run --host 0.0.0.0 --port %PORT% --debug" 'server'}}
    }
    if(Test-TextInPythonManifests 'pytest'){Add-Action 'PYTEST' '🧪 Executar Pytest' 'Testes Python' "$py -m pytest"}
    if(Test-TextInPythonManifests 'ruff'){Add-Action 'RUFF' '🔎 Executar Ruff' 'Ruff check' "$py -m ruff check .";Add-Action 'RUFF_FORMAT' '✨ Formatar com Ruff' 'Ruff format' "$py -m ruff format ."}
    if(Test-TextInPythonManifests 'mypy'){Add-Action 'MYPY' '🧬 Verificar Tipos' 'Mypy' "$py -m mypy ."}
    Detect-PythonEcosystem
}

# ──────────────────────────────────────────────────────────────────────────────
# Outros ecossistemas
# ──────────────────────────────────────────────────────────────────────────────
function Detect-PhpProject {
    $file=Join-Path $script:ProjectDir 'composer.json';if(-not(Test-Path $file)){return}
    Add-Stack 'PHP';Add-Manifest $file;Add-Manifest (Join-Path $script:ProjectDir 'composer.lock');$script:ProjectKind='Aplicação PHP';$script:DefaultPort=8000
    Add-Runtime 'php' 'PHP' @() 'php';Add-Runtime 'composer' 'Composer' @('Composer.Composer') 'composer'
    Add-Dependency 'composer install --no-interaction --prefer-dist' 'Dependências PHP via Composer'
    if(Test-Path (Join-Path $script:ProjectDir 'artisan')){Add-Stack 'Laravel';$script:ProjectKind='Aplicação Laravel';Add-Action 'START_LARAVEL' '🚀 Iniciar Laravel' 'artisan serve' 'php artisan serve --host=0.0.0.0 --port=%PORT%' 'server';Add-Action 'MIGRATE_LARAVEL' '🗄 Aplicar Migrações' 'artisan migrate' 'php artisan migrate --force';Add-Action 'SEED_LARAVEL' '🌱 Popular Banco' 'artisan db:seed' 'php artisan db:seed --force';Add-Action 'RESET_LARAVEL' '♻ Resetar Banco' 'artisan migrate:fresh' 'php artisan migrate:fresh --force' 'command' $true;Add-Action 'TEST_LARAVEL' '🧪 Testes Laravel' 'artisan test' 'php artisan test'}
}
function Detect-RubyProject {
    $file=Join-Path $script:ProjectDir 'Gemfile';if(-not(Test-Path $file)){return}
    Add-Stack 'Ruby';Add-Manifest $file;Add-Manifest (Join-Path $script:ProjectDir 'Gemfile.lock');$script:ProjectKind='Projeto Ruby';$script:DefaultPort=3000
    Add-Runtime 'ruby' 'Ruby com DevKit' @('RubyInstallerTeam.RubyWithDevKit.3.4','RubyInstallerTeam.RubyWithDevKit.3.3');Add-Dependency 'bundle install' 'Dependências Ruby via Bundler'
    if((Test-Path (Join-Path $script:ProjectDir 'bin\rails')) -or (Test-Path (Join-Path $script:ProjectDir 'config\application.rb'))){Add-Stack 'Rails';$script:ProjectKind='Aplicação Rails';Add-Action 'START_RAILS' '🚀 Iniciar Rails' 'Rails server' 'bundle exec rails server -b 0.0.0.0 -p %PORT%' 'server';Add-Action 'MIGRATE_RAILS' '🗄 Aplicar Migrações' 'Rails db:migrate' 'bundle exec rails db:migrate';Add-Action 'SEED_RAILS' '🌱 Popular Banco' 'Rails db:seed' 'bundle exec rails db:seed';Add-Action 'TEST_RAILS' '🧪 Testes Rails' 'Rails test' 'bundle exec rails test'}
}
function Detect-GoProject {
    $file=Join-Path $script:ProjectDir 'go.mod';if(-not(Test-Path $file)){return}
    Add-Stack 'Go';Add-Manifest $file;Add-Manifest (Join-Path $script:ProjectDir 'go.sum');$script:ProjectKind='Projeto Go';$script:DefaultPort=8080
    Add-Runtime 'go' 'Go' @('GoLang.Go');Add-Dependency 'go mod download' 'Módulos Go'
    $main=Get-ChildItem $script:ProjectDir -Filter *.go -File -ErrorAction SilentlyContinue|Where-Object{Select-String $_.FullName -Pattern '^package\s+main' -Quiet}|Select-Object -First 1
    if(-not $main){$main=Get-ChildItem (Join-Path $script:ProjectDir 'cmd') -Filter *.go -File -Recurse -ErrorAction SilentlyContinue|Where-Object{Select-String $_.FullName -Pattern '^package\s+main' -Quiet}|Select-Object -First 1}
    if($main){$script:ProjectKind='Aplicação Go';$target='.';if($main.FullName -match '\\cmd\\'){$target='.'+(Split-Path -Parent (Relative-Path $main.FullName)).Insert(0,'\')};Add-Action 'START_GO' '🚀 Iniciar Aplicação Go' 'Entrypoint Go detectado' "go run $(Quote-Cmd $target)" 'server'}
    Add-Action 'BUILD_GO' '🏗 Construir Go' 'go build ./...' 'go build ./...';Add-Action 'TEST_GO' '🧪 Testes Go' 'go test ./...' 'go test ./...';Add-Action 'VET_GO' '🔎 Go Vet' 'go vet ./...' 'go vet ./...'
}
function Detect-RustProject {
    $file=Join-Path $script:ProjectDir 'Cargo.toml';if(-not(Test-Path $file)){return}
    Add-Stack 'Rust';Add-Manifest $file;Add-Manifest (Join-Path $script:ProjectDir 'Cargo.lock');$script:ProjectKind='Projeto Rust';$script:DefaultPort=8080
    Add-Runtime 'cargo' 'Rustup' @('Rustlang.Rustup');Add-Dependency 'cargo fetch --locked || cargo fetch' 'Crates Rust'
    if((Test-Path (Join-Path $script:ProjectDir 'src\main.rs')) -or (Select-String $file -Pattern '^\[\[bin\]\]' -Quiet)){Add-Action 'START_RUST' '🚀 Iniciar Aplicação Rust' 'Binário Rust detectado' 'cargo run' 'server'}
    Add-Action 'BUILD_RUST' '🏗 Construir Rust' 'cargo build' 'cargo build';Add-Action 'BUILD_RUST_RELEASE' '📦 Build Release' 'cargo build --release' 'cargo build --release';Add-Action 'TEST_RUST' '🧪 Testes Rust' 'cargo test' 'cargo test';Add-Action 'CLIPPY' '🔎 Clippy' 'cargo clippy' 'cargo clippy --all-targets --all-features -- -D warnings';Add-Action 'FORMAT_RUST' '✨ Formatar Rust' 'cargo fmt' 'cargo fmt --all'
}
function Detect-DotNetProject {
    $projects=Get-ChildItem $script:ProjectDir -Include *.csproj,*.fsproj -File -Recurse -ErrorAction SilentlyContinue|Select-Object -First 50
    $solution=Get-ChildItem $script:ProjectDir -Filter *.sln -File -Recurse -ErrorAction SilentlyContinue|Select-Object -First 1
    if(-not $projects -and -not $solution){return}
    Add-Stack '.NET';if($solution){Add-Manifest $solution.FullName};foreach($p in $projects){Add-Manifest $p.FullName};$script:ProjectKind='Projeto .NET';$script:DefaultPort=5000
    $ids=@('Microsoft.DotNet.SDK.10','Microsoft.DotNet.SDK.9','Microsoft.DotNet.SDK.8');Add-Runtime 'dotnet' '.NET SDK' $ids;Add-Dependency 'dotnet restore' 'Pacotes NuGet';Add-Action 'BUILD_DOTNET' '🏗 Construir .NET' 'dotnet build' 'dotnet build --no-restore'
    if($projects|Where-Object{$_.BaseName -match 'Tests?$'}|Select-Object -First 1){Add-Action 'TEST_DOTNET' '🧪 Testes .NET' 'Projetos de teste detectados' 'dotnet test --no-restore'}
    $run=$projects|Where-Object{(Select-String $_.FullName -Pattern 'Microsoft\.NET\.Sdk\.Web|<OutputType>\s*(Exe|WinExe)' -Quiet) -or (Test-Path (Join-Path $_.DirectoryName 'Properties\launchSettings.json'))}|Select-Object -First 1
    if($run){$script:ProjectKind='Aplicação .NET';$script:ProjectName=$run.BaseName;Add-Action 'START_DOTNET' '🚀 Iniciar Aplicação .NET' ("Projeto "+(Relative-Path $run.FullName)) "dotnet run --project $(Quote-Cmd (Relative-Path $run.FullName)) --no-restore --urls http://0.0.0.0:%PORT%" 'server'}
    Add-Action 'FORMAT_DOTNET' '✨ Formatar .NET' 'dotnet format' 'dotnet format'
}
function Detect-JavaProject {
    $gradlew=Join-Path $script:ProjectDir 'gradlew.bat';$gradle=Join-Path $script:ProjectDir 'build.gradle';$gradlekts=Join-Path $script:ProjectDir 'build.gradle.kts';$mvnw=Join-Path $script:ProjectDir 'mvnw.cmd';$pom=Join-Path $script:ProjectDir 'pom.xml'
    if((Test-Path $gradlew) -or (Test-Path $gradle) -or (Test-Path $gradlekts)){Add-Stack 'Gradle';Add-Manifest $gradle;Add-Manifest $gradlekts;$script:ProjectKind='Projeto Java/Kotlin Gradle';$script:DefaultPort=8080;Add-Runtime 'java' 'OpenJDK' @('Microsoft.OpenJDK.21');$cmd=if(Test-Path $gradlew){'gradlew.bat'}else{Add-Runtime 'gradle' 'Gradle' @() 'gradle';'gradle'};Add-Dependency "$cmd dependencies" 'Dependências Gradle';if(Select-String @($gradle,$gradlekts) -Pattern 'spring-boot|org\.springframework\.boot' -Quiet -ErrorAction SilentlyContinue){Add-Stack 'Spring Boot';Add-Action 'START_SPRING' '🚀 Iniciar Spring Boot' 'Gradle bootRun' "$cmd bootRun --args=--server.port=%PORT%" 'server'};if(Select-String @($gradle,$gradlekts) -Pattern 'com\.android\.application' -Quiet -ErrorAction SilentlyContinue){Add-Stack 'Android';Add-Action 'BUILD_ANDROID' '📱 Build Android Debug' 'Gradle assembleDebug' "$cmd assembleDebug"};Add-Action 'BUILD_GRADLE' '🏗 Build Gradle' 'Gradle build' "$cmd build";Add-Action 'TEST_GRADLE' '🧪 Testes Gradle' 'Gradle test' "$cmd test"}
    elseif((Test-Path $mvnw) -or (Test-Path $pom)){Add-Stack 'Maven';Add-Manifest $pom;$script:ProjectKind='Projeto Java/Kotlin Maven';$script:DefaultPort=8080;Add-Runtime 'java' 'OpenJDK' @('Microsoft.OpenJDK.21');$cmd=if(Test-Path $mvnw){'mvnw.cmd'}else{Add-Runtime 'mvn' 'Apache Maven' @() 'maven';'mvn'};Add-Dependency "$cmd -q -DskipTests dependency:go-offline" 'Dependências Maven';if(Select-String $pom -Pattern 'spring-boot' -Quiet){Add-Stack 'Spring Boot';Add-Action 'START_SPRING' '🚀 Iniciar Spring Boot' 'Maven spring-boot:run' "$cmd spring-boot:run -Dspring-boot.run.arguments=--server.port=%PORT%" 'server'};Add-Action 'BUILD_MAVEN' '🏗 Build Maven' 'Maven package' "$cmd package";Add-Action 'TEST_MAVEN' '🧪 Testes Maven' 'Maven test' "$cmd test"}
}
function Detect-FlutterProject {
    $file=Join-Path $script:ProjectDir 'pubspec.yaml';if(-not(Test-Path $file)){return}
    Add-Manifest $file;Add-Manifest (Join-Path $script:ProjectDir 'pubspec.lock')
    $isFlutter=Select-String $file -Pattern '^\s*flutter:\s*$|sdk:\s*flutter' -Quiet
    if($isFlutter){Add-Stack 'Dart';Add-Stack 'Flutter';$script:ProjectKind='Aplicação Flutter';$script:DefaultPort=8080;Add-Runtime 'flutter' 'Flutter SDK' @() 'flutter';Add-Dependency 'flutter pub get' 'Dependências Flutter/Dart';Add-Action 'FLUTTER_DOCTOR' '🩺 Flutter Doctor' 'Validar toolchains' 'flutter doctor -v';Add-Action 'FLUTTER_ANALYZE' '🔎 Analisar Flutter' 'flutter analyze' 'flutter analyze';if(Test-Path (Join-Path $script:ProjectDir 'test')){Add-Action 'FLUTTER_TEST' '🧪 Testes Flutter' 'flutter test' 'flutter test'};if(Test-Path (Join-Path $script:ProjectDir 'web\index.html')){Add-Action 'FLUTTER_WEB' '🌐 Iniciar Flutter Web' 'Dispositivo web-server' 'flutter run -d web-server --web-hostname 0.0.0.0 --web-port %PORT%' 'server';Add-Action 'FLUTTER_BUILD_WEB' '📦 Build Flutter Web' 'flutter build web' 'flutter build web'};if(Test-Path (Join-Path $script:ProjectDir 'android')){Add-Stack 'Android';Add-Action 'FLUTTER_BUILD_APK' '📱 Build APK' 'flutter build apk' 'flutter build apk';Add-Action 'FLUTTER_BUILD_AAB' '📦 Build AAB' 'flutter build appbundle' 'flutter build appbundle'}}
    else{Add-Stack 'Dart';$script:ProjectKind='Aplicação Dart';Add-Runtime 'dart' 'Dart SDK' @() 'dart';Add-Dependency 'dart pub get' 'Dependências Dart';Add-Action 'DART_ANALYZE' '🔎 Analisar Dart' 'dart analyze' 'dart analyze';if(Test-Path (Join-Path $script:ProjectDir 'test')){Add-Action 'DART_TEST' '🧪 Testes Dart' 'dart test' 'dart test'}}
}
function Detect-DockerProject {
    $compose=$null;foreach($n in @('compose.yaml','compose.yml','docker-compose.yaml','docker-compose.yml')){$p=Join-Path $script:ProjectDir $n;if(Test-Path $p){$compose=$n;break}}
    $dockerfile=Join-Path $script:ProjectDir 'Dockerfile';if(-not $compose -and -not(Test-Path $dockerfile)){return}
    Add-Stack 'Docker';if($compose){Add-Manifest (Join-Path $script:ProjectDir $compose)};Add-Manifest $dockerfile;Add-Runtime 'docker' 'Docker Desktop' @('Docker.DockerDesktop')
    if($compose){Add-Action 'DOCKER_UP' '🐳 Subir Containers' 'docker compose up' "docker compose -f $(Quote-Cmd $compose) up" 'server';Add-Action 'DOCKER_UP_BUILD' '🧱 Construir e Subir' 'docker compose up --build' "docker compose -f $(Quote-Cmd $compose) up --build" 'server';Add-Action 'DOCKER_BUILD' '📦 Construir Imagens' 'docker compose build' "docker compose -f $(Quote-Cmd $compose) build";Add-Action 'DOCKER_DOWN' '🛑 Derrubar Containers' 'docker compose down' "docker compose -f $(Quote-Cmd $compose) down";Add-Action 'DOCKER_CONFIG' '✅ Validar Compose' 'docker compose config' "docker compose -f $(Quote-Cmd $compose) config --quiet"}
    elseif(Test-Path $dockerfile){$image=($script:ProjectName.ToLowerInvariant() -replace '[^a-z0-9._-]','-');Add-Action 'DOCKER_BUILD' '📦 Construir Imagem' 'Dockerfile detectado' "docker build -t $image ."}
}
function Detect-RProject {
    $renv=Join-Path $script:ProjectDir 'renv.lock';$desc=Join-Path $script:ProjectDir 'DESCRIPTION';$rproj=Get-ChildItem $script:ProjectDir -Filter *.Rproj -File -ErrorAction SilentlyContinue|Select-Object -First 1
    if(-not(Test-Path $renv) -and -not(Test-Path $desc) -and -not $rproj){return}
    Add-Stack 'R';Add-Manifest $renv;Add-Manifest $desc;if($rproj){Add-Manifest $rproj.FullName};$script:ProjectKind='Projeto R';$script:DefaultPort=3838;Add-Runtime 'Rscript' 'R' @('RProject.R')
    if(Test-Path $renv){Add-Dependency 'Rscript -e "if (!requireNamespace(''renv'', quietly=TRUE)) install.packages(''renv'', repos=''https://cloud.r-project.org''); renv::restore(prompt=FALSE)"' 'Dependências R via renv'}
    if(Test-Path (Join-Path $script:ProjectDir 'app.R')){Add-Stack 'Shiny';Add-Action 'SHINY' '📊 Iniciar Shiny' 'app.R detectado' 'Rscript -e "shiny::runApp(''.'', host=''0.0.0.0'', port=as.integer(Sys.getenv(''PORT'')))"' 'server'}
}
function Detect-JuliaProject {
    $file=Join-Path $script:ProjectDir 'Project.toml';if(-not(Test-Path $file)){return}
    Add-Stack 'Julia';Add-Manifest $file;Add-Manifest (Join-Path $script:ProjectDir 'Manifest.toml');$script:ProjectKind='Projeto Julia';Add-Runtime 'julia' 'Julia' @('Julialang.Julia');Add-Dependency 'julia --project=. -e "using Pkg; Pkg.instantiate()"' 'Dependências Julia';if(Test-Path (Join-Path $script:ProjectDir 'test\runtests.jl')){Add-Action 'JULIA_TEST' '🧪 Testes Julia' 'Pkg.test' 'julia --project=. -e "using Pkg; Pkg.test()"'}
}

# ──────────────────────────────────────────────────────────────────────────────
# Porta e detecção geral
# ──────────────────────────────────────────────────────────────────────────────
function Get-ComponentManifestSummary([string]$Dir) {
    $names=New-Object System.Collections.Generic.List[string]
    foreach($name in @('package.json','pyproject.toml','requirements.txt','Pipfile','manage.py','composer.json','Gemfile','go.mod','Cargo.toml','pubspec.yaml','pom.xml','build.gradle','build.gradle.kts','environment.yml','environment.yaml','renv.lock','Project.toml','compose.yaml','compose.yml','docker-compose.yaml','docker-compose.yml')){if(Test-Path (Join-Path $Dir $name)){[void]$names.Add($name)}}
    Get-ChildItem $Dir -File -ErrorAction SilentlyContinue|Where-Object{$_.Extension-in@('.csproj','.fsproj','.sln')}|ForEach-Object{[void]$names.Add($_.Name)}
    return ($names -join ', ')
}
function Test-RootNodeWorkspaces {
    $file=Join-Path $script:ProjectDir 'package.json';if(-not(Test-Path $file)){return $false};$pkg=Read-JsonFile $file;if($null-eq$pkg){return $false};$ws=Get-JsonProperty $pkg 'workspaces';if($null-eq$ws){return $false};if($ws-is[Array]){return $ws.Count-gt0};$packages=Get-JsonProperty $ws 'packages';return($null-ne$packages-and$packages.Count-gt0)
}
function Detect-WorkspaceComponents {
    if($script:ComponentMode){return}
    $max=30;if($env:ORCH_MAX_COMPONENTS){[void][int]::TryParse($env:ORCH_MAX_COMPONENTS,[ref]$max)};if($max-lt1){return}
    $names=@('package.json','pyproject.toml','requirements.txt','Pipfile','manage.py','composer.json','Gemfile','go.mod','Cargo.toml','pubspec.yaml','pom.xml','build.gradle','build.gradle.kts','environment.yml','environment.yaml','renv.lock','Project.toml','compose.yaml','compose.yml','docker-compose.yaml','docker-compose.yml')
    $rootWorkspaces=Test-RootNodeWorkspaces;$seen=@{};$count=0
    $files=Get-ChildItem -LiteralPath $script:ProjectDir -File -Recurse -ErrorAction SilentlyContinue|Where-Object{
        ($names-contains$_.Name-or$_.Extension-in@('.csproj','.fsproj','.sln'))-and$_.DirectoryName-ne$script:ProjectDir-and$_.FullName-notmatch '\\(\.git|node_modules|\.venv|venv|vendor|dist|build|target|coverage|\.orchestrator|__pycache__)\\'
    }
    foreach($file in $files){
        $dir=$file.DirectoryName;$relative=Relative-Path $dir;$depth=($relative-split '[\\/]').Count;if($depth-gt6-or$seen.ContainsKey($dir)){continue}
        if($rootWorkspaces-and$file.Name-eq'package.json'){$other=$false;foreach($n in $names|Where-Object{$_-ne'package.json'}){if(Test-Path(Join-Path $dir $n)){$other=$true;break}};if(-not$other){continue}}
        $summary=Get-ComponentManifestSummary $dir;if([string]::IsNullOrWhiteSpace($summary)){continue};$seen[$dir]=$true;[void]$script:ComponentDirs.Add($dir);[void]$script:ComponentDescriptions.Add($summary);$count++;Add-Action "COMPONENT_$count" "🧩 Gerenciar $([IO.Path]::GetFileName($dir))" "$relative — $summary" $dir 'subproject';if($count-ge$max){break}
    }
    if($script:ComponentDirs.Count-gt0){Add-Stack "Workspace ($($script:ComponentDirs.Count) componentes)"}
}
function Invoke-ComponentScript([string]$Dir,[string[]]$Arguments) {
    $oldProject=$env:ORCH_PROJECT_DIR;$oldMode=$env:ORCH_COMPONENT_MODE
    try{$env:ORCH_PROJECT_DIR=$Dir;$env:ORCH_COMPONENT_MODE='1';& $env:ORCH_SELF @Arguments;return$LASTEXITCODE}
    finally{$env:ORCH_PROJECT_DIR=$oldProject;$env:ORCH_COMPONENT_MODE=$oldMode}
}
function Bootstrap-WorkspaceComponents {
    if($script:ComponentMode-or$script:NoBootstrap-or$script:ComponentDirs.Count-eq0){return}
    foreach($dir in $script:ComponentDirs){$rel=Relative-Path $dir;Write-PlainInfo "Preparando componente: $rel";$args=@('--bootstrap-only');if($script:DryRun){$args+='--dry-run'};$code=Invoke-ComponentScript $dir $args;if($code-ne0){throw "O bootstrap do componente $rel falhou com código $code."}}
}
function Open-Subproject([string]$Dir) {
    $rel=Relative-Path $Dir;if(-not(Test-Path $Dir -PathType Container)){$script:LastStatus='err';$script:LastMessage="Componente não existe mais: $rel";return 1}
    if($script:NonInteractive){return(Invoke-ComponentScript $Dir @('--no-bootstrap','--list-actions'))}
    if($script:InAltScreen){[Console]::Write("$script:Esc[?1049l$script:Esc[?25h");$script:InAltScreen=$false}
    $code=Invoke-ComponentScript $Dir @();[Console]::Write("$script:Esc[?1049h$script:Esc[?25l");$script:InAltScreen=$true;$script:LastStatus=if($code-eq0){'ok'}else{'err'};$script:LastMessage="Componente $rel encerrado com código $code.";return$code
}

function Detect-Port {
    if($script:PortExplicit){return}
    foreach($name in @('.env.local','.env.development','.env.dev','.env')){$p=Join-Path $script:ProjectDir $name;if(Test-Path $p){$line=Get-Content $p|Where-Object{$_ -match '^\s*(PORT|SERVER_PORT|APP_PORT)\s*='}|Select-Object -Last 1;if($line){$v=($line -split '=',2)[1].Trim(' ','"',"'");if(Test-ValidPort $v){$script:Port=[int]$v;return}}}}
    $package=Join-Path $script:ProjectDir 'package.json';if(Test-Path $package){$pkg=Read-JsonFile $package;$scripts=Get-JsonProperty $pkg 'scripts';if($scripts){foreach($prop in $scripts.PSObject.Properties){$m=[regex]::Match([string]$prop.Value,'(?:--port|-p)(?:=|\s+)(\d{2,5})');if($m.Success-and(Test-ValidPort $m.Groups[1].Value)){$script:Port=[int]$m.Groups[1].Value;return}}}}
    $launch=Get-ChildItem $script:ProjectDir -Filter launchSettings.json -File -Recurse -ErrorAction SilentlyContinue|Where-Object{$_.FullName-notmatch '\\(node_modules|\.git|build|dist)\\'}|Select-Object -First 1
    if($launch){$text=Get-Content $launch.FullName -Raw;if($text -match 'https?://[^:"/]+:(\d+)'){if(Test-ValidPort $Matches[1]){$script:Port=[int]$Matches[1];return}}}
    foreach($name in @('compose.yaml','compose.yml','docker-compose.yaml','docker-compose.yml')){$p=Join-Path $script:ProjectDir $name;if(Test-Path $p){$text=Get-Content $p -Raw;$m=[regex]::Match($text,'["'']?(\d{2,5}):\d{2,5}["'']?');if($m.Success-and(Test-ValidPort $m.Groups[1].Value)){$script:Port=[int]$m.Groups[1].Value;return}}}
    foreach($name in @('application.properties','application.yml','application.yaml')){$p=Get-ChildItem $script:ProjectDir -Filter $name -File -Recurse -ErrorAction SilentlyContinue|Select-Object -First 1;if($p){$text=Get-Content $p.FullName -Raw;$m=[regex]::Match($text,'server[.:]\s*port\s*[:=]\s*(\d{2,5})');if($m.Success-and(Test-ValidPort $m.Groups[1].Value)){$script:Port=[int]$m.Groups[1].Value;return}}}
}
function Reset-Detection {
    $script:Stacks.Clear();$script:Manifests.Clear();$script:Dependencies.Clear();$script:Runtimes.Clear();$script:Actions.Clear();$script:ComponentDirs.Clear();$script:ComponentDescriptions.Clear()
    $script:ProjectName=Split-Path -Leaf $script:ProjectDir;$script:ProjectVersion='';$script:ProjectKind='Projeto';$script:RuntimeSummary='';$script:DefaultPort=8000;$script:NodeManager='';$script:NodeDeclaredManager='';$script:PythonManager=''
    if(-not $script:PortExplicit){$script:Port=0}
}
function Refresh-ServerState {
    $script:AppActive=$false;$script:ServerPid=0
    if(-not(Test-Path $script:MetaFile)){return}
    try{$m=Read-JsonFile $script:MetaFile;if($null -eq $m){return};$p=Get-Process -Id ([int]$m.Pid) -ErrorAction Stop;$ticks=$p.StartTime.ToUniversalTime().Ticks;if($ticks -eq [long]$m.StartTicks -and [string]$m.ProjectDir -eq $script:ProjectDir){$script:AppActive=$true;$script:ServerPid=$p.Id;$script:ServerStartTicks=$ticks;$script:ServerCommandFile=[string]$m.CommandFile;return}}catch{}
    Remove-Item $script:PidFile,$script:MetaFile -Force -ErrorAction SilentlyContinue
}
function Detect-Project {
    Reset-Detection
    Detect-NodeProject;Detect-PythonProject;Detect-PhpProject;Detect-RubyProject;Detect-GoProject;Detect-RustProject;Detect-DotNetProject;Detect-JavaProject;Detect-FlutterProject;Detect-DockerProject;Detect-RProject;Detect-JuliaProject;Detect-WorkspaceComponents
    Detect-Port;if($script:Port -eq 0){$script:Port=$script:DefaultPort}
    $script:RuntimeSummary=if($script:Stacks.Count){$script:Stacks -join ', '}else{'Nenhuma stack reconhecida'}
    foreach($d in $script:Dependencies){Add-Action ("INSTALL_DEPS_"+$script:Actions.Count) '📦 Instalar Dependências' $d.Description $d.Command}
    if($script:NodeManager){switch($script:NodeManager){'pnpm'{Add-Action 'CHECK_NODE_DEPS' '🧩 Validar Dependências Node' 'pnpm list' 'pnpm list --depth 0'}'yarn'{Add-Action 'CHECK_NODE_DEPS' '🧩 Validar Dependências Node' 'yarn list' 'yarn list --depth=0'}'bun'{Add-Action 'CHECK_NODE_DEPS' '🧩 Validar Dependências Node' 'bun pm ls' 'bun pm ls'}default{Add-Action 'CHECK_NODE_DEPS' '🧩 Validar Dependências Node' 'npm ls' 'npm ls --depth=0'}}}
    if($script:PythonManager){$pyCheck=Get-PythonCommand;Add-Action 'CHECK_PY_IMPORTS' '🧩 Validar Imports Python' 'Analisar imports instalados' '' 'python_imports';Add-Action 'CHECK_PY_DEPS' '🔗 Validar Dependências Python' 'pip check' "$pyCheck -m pip check"}
    Refresh-ServerState;if($script:AppActive){Add-Action 'STOP' '🛑 Encerrar Servidor' 'Encerrar processo iniciado por este orquestrador' '' 'stop'}
    Add-Action 'HEALTH' '🏥 Saúde do Projeto' 'Validar runtimes, manifestos e dependências' '' 'health';Add-Action 'LOGS' '📜 Visualizar Logs' 'Abrir histórico' '' 'logs';Add-Action 'REFRESH' '🔄 Redetectar Projeto' 'Atualizar menu' '' 'refresh';Add-Action 'EXIT' '🚪 Sair' 'Encerrar orquestrador' '' 'exit'
    [pscustomobject]@{ProjectName=$script:ProjectName;ProjectVersion=$script:ProjectVersion;ProjectKind=$script:ProjectKind;Stacks=$script:RuntimeSummary;NodeManager=$script:NodeManager;PythonManager=$script:PythonManager;Port=$script:Port;DetectedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content $script:DetectionFile -Encoding UTF8
}

# ──────────────────────────────────────────────────────────────────────────────
# Instalação real de runtimes e dependências
# ──────────────────────────────────────────────────────────────────────────────
function Refresh-ProcessPath {
    $machine=[Environment]::GetEnvironmentVariable('Path','Machine');$user=[Environment]::GetEnvironmentVariable('Path','User');$env:Path="$machine;$user"
    $extra=@("$env:USERPROFILE\.cargo\bin","$env:USERPROFILE\.bun\bin","$env:USERPROFILE\.local\bin","$env:USERPROFILE\AppData\Roaming\Python\Scripts")
    foreach($p in $extra){if(Test-Path $p){$env:Path="$p;$env:Path"}}
}
function Ensure-WinGet {
    if(Test-Command 'winget'){return}
    if($script:DryRun){Write-PlainInfo '[dry-run] registrar ou reinstalar o App Installer oficial para disponibilizar WinGet';return}

    Write-PlainInfo 'WinGet ausente. Tentando registrar o App Installer do Windows 11...'
    try {
        Add-AppxPackage -RegisterByFamilyName -MainPackage 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe' -ErrorAction Stop
    } catch {
        Write-PlainWarn "O registro do App Installer não foi suficiente: $($_.Exception.Message)"
    }
    Start-Sleep -Seconds 2
    Refresh-ProcessPath
    if(Test-Command 'winget'){Write-PlainOk 'WinGet registrado com sucesso.';return}

    Write-PlainInfo 'Baixando o App Installer oficial mais recente da Microsoft...'
    $tmp=Join-Path ([IO.Path]::GetTempPath()) ('orch-winget-'+[Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $tmp -Force | Out-Null
    try {
        $bundle=Join-Path $tmp 'Microsoft.DesktopAppInstaller.msixbundle'
        Invoke-OrchestratorDownload 'https://aka.ms/getwinget' $bundle
        Add-AppxPackage -Path $bundle -ForceApplicationShutdown -ErrorAction Stop
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
    Refresh-ProcessPath
    if(-not(Test-Command 'winget')){throw 'O App Installer foi processado, mas o comando winget não ficou disponível. Verifique políticas corporativas, Microsoft Store e registro do pacote.'}
    Write-PlainOk 'WinGet instalado e disponível.'
}
function Install-WingetPackage {
    param([string]$Name,[string[]]$Ids)
    Ensure-WinGet
    foreach($id in $Ids){
        & winget show --exact --id $id --accept-source-agreements *> $null
        if($LASTEXITCODE -eq 0){
            if($script:DryRun){Write-PlainInfo "[dry-run] winget install --exact --id $id";return}
            Write-PlainInfo "Instalando $Name pelo WinGet ($id)..."
            & winget install --exact --id $id --accept-package-agreements --accept-source-agreements --silent
            if($LASTEXITCODE -eq 0){Refresh-ProcessPath;return}
        }
    }
    throw "Nenhum pacote WinGet válido foi encontrado para $Name. IDs tentados: $($Ids -join ', ')"
}
function Add-UserPath([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) { return }
    $parts = @($env:Path -split ';' | Where-Object { $_ })
    if (-not ($parts | Where-Object { $_.TrimEnd('\\') -ieq $Path.TrimEnd('\\') })) { $env:Path = "$Path;$env:Path" }
    $userPath = [Environment]::GetEnvironmentVariable('Path','User')
    $userParts = @($userPath -split ';' | Where-Object { $_ })
    if (-not ($userParts | Where-Object { $_.TrimEnd('\\') -ieq $Path.TrimEnd('\\') })) {
        $updated = if ([string]::IsNullOrWhiteSpace($userPath)) { $Path } else { "$userPath;$Path" }
        [Environment]::SetEnvironmentVariable('Path',$updated,'User')
    }
}
function Get-RuntimeRoot {
    $root = Join-Path $env:LOCALAPPDATA 'OrchestratorRuntimes'
    New-Item -ItemType Directory -Path $root -Force | Out-Null
    return $root
}
function Invoke-OrchestratorDownload([string]$Uri,[string]$Destination) {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination
}
function Install-FlutterOfficial {
    $root=Get-RuntimeRoot;$sdk=Join-Path $root 'flutter';$bin=Join-Path $sdk 'bin'
    if(Test-Path (Join-Path $bin 'flutter.bat')){Add-UserPath $bin;return}
    if($script:DryRun){Write-PlainInfo "[dry-run] baixar Flutter stable oficial em $sdk";return}
    $index=Invoke-RestMethod 'https://storage.googleapis.com/flutter_infra_release/releases/releases_windows.json'
    $hash=[string]$index.current_release.stable;$release=$index.releases|Where-Object{$_.hash-eq$hash}|Select-Object -First 1
    if($null-eq$release){throw 'Não foi possível localizar a versão estável do Flutter.'}
    $tmp=Join-Path ([IO.Path]::GetTempPath()) ('orch-flutter-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $tmp|Out-Null
    try{$zip=Join-Path $tmp 'flutter.zip';$uri='https://storage.googleapis.com/flutter_infra_release/releases/'+[string]$release.archive;Invoke-OrchestratorDownload $uri $zip;if(Test-Path $sdk){Remove-Item $sdk -Recurse -Force};Expand-Archive -LiteralPath $zip -DestinationPath $root -Force}finally{Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue}
    Add-UserPath $bin;& (Join-Path $bin 'flutter.bat') config --no-analytics *> $null
}
function Install-DartOfficial {
    $root=Get-RuntimeRoot;$sdk=Join-Path $root 'dart-sdk';$bin=Join-Path $sdk 'bin'
    if(Test-Path (Join-Path $bin 'dart.exe')){Add-UserPath $bin;return}
    if($script:DryRun){Write-PlainInfo "[dry-run] baixar Dart SDK stable oficial em $sdk";return}
    $versionInfo=Invoke-RestMethod 'https://storage.googleapis.com/dart-archive/channels/stable/release/latest/VERSION';$version=[string]$versionInfo.version
    if([string]::IsNullOrWhiteSpace($version)){throw 'Não foi possível determinar a versão estável do Dart.'}
    $tmp=Join-Path ([IO.Path]::GetTempPath()) ('orch-dart-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $tmp|Out-Null
    try{$zip=Join-Path $tmp 'dart.zip';Invoke-OrchestratorDownload "https://storage.googleapis.com/dart-archive/channels/stable/release/$version/sdk/dartsdk-windows-x64-release.zip" $zip;if(Test-Path $sdk){Remove-Item $sdk -Recurse -Force};Expand-Archive $zip $root -Force}finally{Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue}
    Add-UserPath $bin
}
function Install-GradleOfficial {
    $root=Get-RuntimeRoot;$current=Invoke-RestMethod 'https://services.gradle.org/versions/current';$version=[string]$current.version;$sdk=Join-Path $root "gradle-$version";$bin=Join-Path $sdk 'bin'
    if(Test-Path (Join-Path $bin 'gradle.bat')){Add-UserPath $bin;return}
    if($script:DryRun){Write-PlainInfo "[dry-run] baixar Gradle $version oficial em $sdk";return}
    $tmp=Join-Path ([IO.Path]::GetTempPath()) ('orch-gradle-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $tmp|Out-Null
    try{$zip=Join-Path $tmp 'gradle.zip';Invoke-OrchestratorDownload ([string]$current.downloadUrl) $zip;if($current.checksum){$actual=(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant();if($actual-ne([string]$current.checksum).ToLowerInvariant()){throw 'Checksum SHA-256 do Gradle não confere.'}};Expand-Archive $zip $root -Force}finally{Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue}
    Add-UserPath $bin
}
function Install-MavenOfficial {
    $root=Get-RuntimeRoot;$page=(Invoke-WebRequest -UseBasicParsing 'https://maven.apache.org/download.cgi').Content
    $match=[regex]::Match($page,'apache-maven-([0-9]+\.[0-9]+\.[0-9]+)-bin\.zip')
    if(-not$match.Success){throw 'Não foi possível descobrir a versão estável do Maven.'};$version=$match.Groups[1].Value;$sdk=Join-Path $root "apache-maven-$version";$bin=Join-Path $sdk 'bin'
    if(Test-Path (Join-Path $bin 'mvn.cmd')){Add-UserPath $bin;return}
    if($script:DryRun){Write-PlainInfo "[dry-run] baixar Maven $version oficial em $sdk";return}
    $base="https://dlcdn.apache.org/maven/maven-3/$version/binaries/apache-maven-$version-bin.zip";$tmp=Join-Path ([IO.Path]::GetTempPath()) ('orch-maven-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $tmp|Out-Null
    try{$zip=Join-Path $tmp 'maven.zip';Invoke-OrchestratorDownload $base $zip;$expected=((Invoke-WebRequest -UseBasicParsing "$base.sha512").Content -split '\s+')[0].Trim().ToLowerInvariant();$actual=(Get-FileHash $zip -Algorithm SHA512).Hash.ToLowerInvariant();if($expected-and$actual-ne$expected){throw 'Checksum SHA-512 do Maven não confere.'};Expand-Archive $zip $root -Force}finally{Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue}
    Add-UserPath $bin
}
function Install-PhpOfficial {
    $root=Get-RuntimeRoot
    $base='https://downloads.php.net/~windows/releases/'
    if($script:DryRun){Write-PlainInfo "[dry-run] descobrir e instalar PHP Windows x64 estável oficial em $root";return}
    $page=(Invoke-WebRequest -UseBasicParsing $base).Content
    $candidates=New-Object System.Collections.Generic.List[object]
    foreach($m in [regex]::Matches($page,'href="(php-([0-9]+\.[0-9]+\.[0-9]+)-Win32-vs[0-9]+-x64\.zip)"')){
        try{$candidates.Add([pscustomobject]@{Name=$m.Groups[1].Value;Version=[version]$m.Groups[2].Value})}catch{}
    }
    $candidate=$candidates|Sort-Object Version -Descending|Select-Object -First 1
    if($null-eq$candidate){throw 'Não foi possível descobrir o pacote PHP Windows x64 estável no repositório oficial.'}
    $sdk=Join-Path $root ('php-'+$candidate.Version.ToString())
    $exe=Join-Path $sdk 'php.exe'
    if(Test-Path $exe){Add-UserPath $sdk;return}
    $tmp=Join-Path ([IO.Path]::GetTempPath()) ('orch-php-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $tmp|Out-Null
    try{
        $zip=Join-Path $tmp $candidate.Name
        Invoke-OrchestratorDownload ($base+$candidate.Name) $zip
        $sums=(Invoke-WebRequest -UseBasicParsing ($base+'sha256sum.txt')).Content
        $escaped=[regex]::Escape($candidate.Name)
        $hashMatch=[regex]::Match($sums,"(?im)^([a-f0-9]{64})\\s+\\*?$escaped\\s*$")
        if(-not$hashMatch.Success){throw "Checksum SHA-256 oficial não encontrado para $($candidate.Name)."}
        $expected=$hashMatch.Groups[1].Value.ToLowerInvariant();$actual=(Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()
        if($actual-ne$expected){throw 'Checksum SHA-256 do PHP não confere.'}
        if(Test-Path $sdk){Remove-Item $sdk -Recurse -Force}
        New-Item -ItemType Directory $sdk -Force|Out-Null
        Expand-Archive -LiteralPath $zip -DestinationPath $sdk -Force
        $iniDev=Join-Path $sdk 'php.ini-development';$ini=Join-Path $sdk 'php.ini'
        if((Test-Path $iniDev)-and-not(Test-Path $ini)){Copy-Item $iniDev $ini}
    }finally{Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue}
    Add-UserPath $sdk
    try{& $exe -v *> $null}catch{
        if(Test-Command 'winget'){
            Install-WingetPackage 'Microsoft Visual C++ Redistributable x64' @('Microsoft.VCRedist.2015+.x64')
            Refresh-ProcessPath
        }
        & $exe -v *> $null
    }
    if($LASTEXITCODE-ne0){throw 'PHP foi extraído, mas php.exe não pôde ser executado.'}
}
function Install-ComposerOfficial {
    if(Test-Command 'winget'){try{Install-WingetPackage 'Composer' @('Composer.Composer');if(Test-Command 'composer'){return}}catch{Write-PlainWarn $_.Exception.Message}}
    if(-not(Test-Command 'php')){throw 'PHP precisa estar disponível antes da instalação do Composer.'}
    $root=Join-Path (Get-RuntimeRoot) 'composer';New-Item -ItemType Directory $root -Force|Out-Null;$cmd=Join-Path $root 'composer.cmd';$phar=Join-Path $root 'composer.phar'
    if((Test-Path $cmd)-and(Test-Path $phar)){Add-UserPath $root;return}
    if($script:DryRun){Write-PlainInfo "[dry-run] instalar Composer oficial em $root";return}
    $tmp=Join-Path ([IO.Path]::GetTempPath()) ('orch-composer-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $tmp|Out-Null
    try{$setup=Join-Path $tmp 'composer-setup.php';Invoke-OrchestratorDownload 'https://getcomposer.org/installer' $setup;$expected=(Invoke-WebRequest -UseBasicParsing 'https://composer.github.io/installer.sig').Content.Trim().ToLowerInvariant();$actual=(Get-FileHash $setup -Algorithm SHA384).Hash.ToLowerInvariant();if($actual-ne$expected){throw 'Assinatura SHA-384 do instalador Composer não confere.'};& php $setup --quiet --install-dir=$root --filename=composer.phar;if($LASTEXITCODE-ne0){throw 'Instalador oficial do Composer falhou.'};Set-Content $cmd "@echo off`r`nphp `"%~dp0composer.phar`" %*" -Encoding ASCII}finally{Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue}
    Add-UserPath $root
}
function Install-MicromambaOfficial {
    $root=Join-Path (Get-RuntimeRoot) 'micromamba';New-Item -ItemType Directory $root -Force|Out-Null;$exe=Join-Path $root 'micromamba.exe'
    if(Test-Path $exe){Add-UserPath $root;return}
    if($script:DryRun){Write-PlainInfo "[dry-run] instalar Micromamba oficial em $root";return}
    $tmp=Join-Path ([IO.Path]::GetTempPath()) ('orch-mamba-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory $tmp|Out-Null
    try{$archive=Join-Path $tmp 'micromamba.tar.bz2';Invoke-OrchestratorDownload 'https://micro.mamba.pm/api/micromamba/win-64/latest' $archive;& tar.exe -xjf $archive -C $tmp;if($LASTEXITCODE-ne0){throw 'Falha ao extrair Micromamba.'};$found=Get-ChildItem $tmp -Filter micromamba.exe -File -Recurse|Select-Object -First 1;if(-not$found){throw 'micromamba.exe não foi encontrado no pacote oficial.'};Copy-Item $found.FullName $exe -Force}finally{Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue}
    Add-UserPath $root
}
function Ensure-SpecialRuntime($Runtime) {
    switch([string]$Runtime.Installer){'flutter'{Install-FlutterOfficial}'dart'{Install-DartOfficial}'gradle'{Install-GradleOfficial}'maven'{Install-MavenOfficial}'php'{Install-PhpOfficial}'composer'{Install-ComposerOfficial}'micromamba'{Install-MicromambaOfficial}default{throw "Instalador especial desconhecido: $($Runtime.Installer)"}}
}

function Ensure-Runtimes {
    if($script:NoBootstrap){return}
    foreach($runtime in $script:Runtimes){
        if(Test-Command $runtime.Command){continue}
        if([string]$runtime.Installer -eq 'winget'){Install-WingetPackage $runtime.Name $runtime.WingetIds}else{Ensure-SpecialRuntime $runtime}
        Refresh-ProcessPath
        if(-not(Test-Command $runtime.Command)){throw "$($runtime.Name) foi instalado, mas o comando $($runtime.Command) ainda não está disponível no processo atual."}
    }
    if($script:NodeManager -eq 'pnpm' -and -not(Test-Command 'pnpm')){if(Test-Command 'corepack'){& corepack enable;& corepack prepare $script:NodeDeclaredManager --activate}else{& npm install --global pnpm};if($LASTEXITCODE -ne 0){throw 'Falha ao instalar pnpm.'}}
    if($script:NodeManager -eq 'yarn' -and -not(Test-Command 'yarn')){if(Test-Command 'corepack'){& corepack enable;if($script:NodeDeclaredManager){& corepack prepare $script:NodeDeclaredManager --activate}}else{& npm install --global yarn};if($LASTEXITCODE -ne 0){throw 'Falha ao instalar Yarn.'}}
    if($script:NodeManager -eq 'bun' -and -not(Test-Command 'bun')){Install-WingetPackage 'Bun' @('Oven-sh.Bun')}
    if($script:PythonManager){
        $base=Get-BasePythonCommand
        if($script:PythonManager -eq 'uv' -and -not(Test-Command 'uv')){if($script:DryRun){Write-PlainInfo '[dry-run] instalar uv pelo instalador oficial'}else{Invoke-Expression ((Invoke-RestMethod 'https://astral.sh/uv/install.ps1'))};Refresh-ProcessPath}
        if($script:PythonManager -eq 'poetry' -and -not(Test-Command 'poetry')){Invoke-PlainCommand "$base -m pip install --user poetry" 'Instalando Poetry'|Out-Null;Refresh-ProcessPath}
        if($script:PythonManager -eq 'pipenv' -and -not(Test-Command 'pipenv')){Invoke-PlainCommand "$base -m pip install --user pipenv" 'Instalando Pipenv'|Out-Null;Refresh-ProcessPath}
        if($script:PythonManager -eq 'pip' -and -not(Test-Path (Join-Path $script:ProjectDir '.venv\Scripts\python.exe'))){Invoke-PlainCommand "$base -m venv .venv" 'Criando ambiente virtual Python'|Out-Null}
    }
}
function Get-ManifestFingerprint {
    $sb=New-Object Text.StringBuilder
    foreach($m in $script:Manifests|Sort-Object){if(Test-Path $m){[void]$sb.AppendLine((Relative-Path $m));[void]$sb.AppendLine((Get-FileHash $m -Algorithm SHA256).Hash)}}
    [void]$sb.AppendLine($script:RuntimeSummary);[void]$sb.AppendLine($script:NodeManager);[void]$sb.AppendLine($script:PythonManager)
    $sha=[Security.Cryptography.SHA256]::Create();try{$bytes=[Text.Encoding]::UTF8.GetBytes($sb.ToString());return ([BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-','').ToLowerInvariant()}finally{$sha.Dispose()}
}
function Test-DependenciesPresent {
    if((Test-Path (Join-Path $script:ProjectDir 'package.json')) -and -not(Test-Path (Join-Path $script:ProjectDir 'node_modules'))){return $false}
    if($script:PythonManager -eq 'pip' -and -not(Test-Path (Join-Path $script:ProjectDir '.venv\Scripts\python.exe'))){return $false}
    if($script:PythonManager -eq 'conda' -and -not(Test-Path (Join-Path $script:OrchDir 'conda-env\conda-meta'))){return $false}
    if((Test-Path (Join-Path $script:ProjectDir 'composer.json')) -and -not(Test-Path (Join-Path $script:ProjectDir 'vendor'))){return $false}
    return $true
}
function New-CommandProcess {
    param([string]$Command,[bool]$Capture=$true,[string]$Purpose='command')
    $id=[Guid]::NewGuid().ToString('N');$cmdFile=Join-Path $script:OrchDir "$Purpose-$id.cmd"
    $content="@echo off`r`nsetlocal`r`nset `"PORT=$script:Port`"`r`ncd /d `"$script:ProjectDir`"`r`n$Command`r`nexit /b %errorlevel%`r`n"
    Set-Content -LiteralPath $cmdFile -Value $content -Encoding ASCII
    $psi=New-Object Diagnostics.ProcessStartInfo;$psi.FileName=$env:ComSpec;$psi.Arguments="/D /S /C `"`"$cmdFile`"`"";$psi.WorkingDirectory=$script:ProjectDir;$psi.UseShellExecute=$false;$psi.CreateNoWindow=$true
    if($Capture){$psi.RedirectStandardOutput=$true;$psi.RedirectStandardError=$true}
    $p=New-Object Diagnostics.Process;$p.StartInfo=$psi
    if($Capture){
        $queue=New-Object 'System.Collections.Concurrent.ConcurrentQueue[string]'
        $outHandler=[Diagnostics.DataReceivedEventHandler]{param($sender,$e)if($null-ne$e.Data){$queue.Enqueue($e.Data)}}
        $errHandler=[Diagnostics.DataReceivedEventHandler]{param($sender,$e)if($null-ne$e.Data){$queue.Enqueue($e.Data)}}
        $p.add_OutputDataReceived($outHandler);$p.add_ErrorDataReceived($errHandler)
        [void]$p.Start();$p.BeginOutputReadLine();$p.BeginErrorReadLine()
        return [pscustomobject]@{Process=$p;Queue=$queue;CommandFile=$cmdFile;OutHandler=$outHandler;ErrHandler=$errHandler}
    }
    [void]$p.Start();return [pscustomobject]@{Process=$p;CommandFile=$cmdFile}
}
function Invoke-PlainCommand {
    param([string]$Command,[string]$Description)
    if($script:DryRun){Write-PlainInfo "[dry-run] $Description`: $Command";return 0}
    Write-PlainInfo $Description;$ctx=New-CommandProcess $Command $true 'bootstrap';$line=$null
    while(-not $ctx.Process.HasExited -or -not $ctx.Queue.IsEmpty){while($ctx.Queue.TryDequeue([ref]$line)){Write-Host $line;Add-Content $script:LogFile $line -Encoding UTF8};Start-Sleep -Milliseconds 30}
    $ctx.Process.WaitForExit();$code=$ctx.Process.ExitCode;Remove-Item $ctx.CommandFile -Force -ErrorAction SilentlyContinue
    if($code -eq 0){Write-PlainOk "$Description concluído."}else{Write-PlainError "$Description falhou com código $code."};return $code
}
function Install-ProjectDependencies {
    if($script:NoBootstrap -or $script:Dependencies.Count -eq 0){return}
    $current=Get-ManifestFingerprint;$previous=if(Test-Path $script:DepsStampFile){(Get-Content $script:DepsStampFile -Raw).Trim()}else{''}
    if($current -eq $previous -and (Test-DependenciesPresent)){Write-PlainOk 'Dependências já correspondem aos manifestos atuais.';return}
    foreach($d in $script:Dependencies){$code=Invoke-PlainCommand $d.Command $d.Description;if($code -ne 0){throw "Falha na instalação: $($d.Description)"}}
    if(-not $script:DryRun){Set-Content $script:DepsStampFile $current -Encoding ASCII}
}
function Bootstrap-All {
    Write-Host "`n  ORQUESTRADOR UNIVERSAL v$script:Version"
    Write-Host "  Projeto: $script:ProjectDir`n"
    if($script:NoBootstrap){Write-PlainWarn 'Bootstrap automático desativado.'}
    Detect-Project;Ensure-Runtimes;Detect-Project;Install-ProjectDependencies;Detect-Project;Bootstrap-WorkspaceComponents;Detect-Project;Write-PlainOk "Bootstrap concluído. Stack: $script:RuntimeSummary"
}

# ──────────────────────────────────────────────────────────────────────────────
# TUI, processos e ações
# ──────────────────────────────────────────────────────────────────────────────
function Add-LiveLine([string]$Line){if([string]::IsNullOrWhiteSpace($Line)){return};if($script:NonInteractive){Write-Host "  $Line"};[void]$script:LiveLines.Add($Line);while($script:LiveLines.Count-gt$script:LogMax){$script:LiveLines.RemoveAt(0)};if($script:ScrollPosition-lt5){$script:ScrollPosition=0};Write-Log 'INFO' "live: $Line"}
function Refresh-LiveFromLog {$script:LiveLines.Clear();if(Test-Path $script:LogFile){$lines=Get-Content $script:LogFile -Tail $script:LogMax -ErrorAction SilentlyContinue;foreach($l in $lines){[void]$script:LiveLines.Add([string]$l)}}}
function Truncate([string]$Text,[int]$Max){if($Max-le0){return''};if($null-eq$Text){return''};if($Text.Length-le$Max){return$Text};if($Max-eq1){return$Text.Substring(0,1)};return$Text.Substring(0,$Max-1)+'…'}
function Update-Dimensions {try{$script:TermCols=[Math]::Max([Console]::WindowWidth,40);$script:TermRows=[Math]::Max([Console]::WindowHeight,20)}catch{$script:TermCols=100;$script:TermRows=30};$script:LiveRows=5;$script:MenuVisible=[Math]::Min(12,[Math]::Max(4,$script:TermRows-$script:LiveRows-15))}
function Update-MenuWindow {$total=$script:Actions.Count;if($total-eq0){$script:Selected=0;$script:MenuTop=0;return};if($script:Selected-lt0){$script:Selected=0};if($script:Selected-ge$total){$script:Selected=$total-1};if($script:Selected-lt$script:MenuTop){$script:MenuTop=$script:Selected};if($script:Selected-ge$script:MenuTop+$script:MenuVisible){$script:MenuTop=$script:Selected-$script:MenuVisible+1};$max=[Math]::Max(0,$total-$script:MenuVisible);if($script:MenuTop-gt$max){$script:MenuTop=$max}}
function Draw-UI {
    if($script:NonInteractive){return};Update-Dimensions;Update-MenuWindow;$elapsed=(Get-Date)-$script:StartTime;$timer='{0:00}:{1:00}:{2:00}'-f[int]$elapsed.TotalHours,$elapsed.Minutes,$elapsed.Seconds;$title=Truncate $script:ProjectName 32;$stack=Truncate $script:RuntimeSummary 40
    $b=New-Object Text.StringBuilder;[void]$b.Append("$script:Esc[H")
    [void]$b.Append("$script:EraseLine`n$script:EraseLine  $script:FGDim$script:Dim$script:IDot $title$script:Bold • ORCH v$script:Version$script:Reset $script:FGDim— $timer  │  Porta: $script:Port$script:Reset`n")
    [void]$b.Append("$script:EraseLine  $script:AccentCyan$script:Bold$(Truncate $script:CurrentTask ($script:TermCols-10))$script:Reset`n")
    $w=[Math]::Max(10,$script:TermCols-13);$filled=[int]($script:Progress*$w/100);$empty=$w-$filled;[void]$b.Append("$script:EraseLine  $script:AccentMint"+('━'*$filled)+"$script:FGDim"+('─'*$empty)+" $script:AccentCyan$script:Bold$script:Progress%$script:Reset`n")
    [void]$b.Append("$script:EraseLine  $script:FGSec$script:Dim"+('─'*[Math]::Max(1,$script:TermCols-6))+"$script:Reset`n`n")
    $end=[Math]::Min($script:Actions.Count,$script:MenuTop+$script:MenuVisible);if($script:Actions.Count-gt$script:MenuVisible){[void]$b.Append("$script:EraseLine  $script:FGDim$script:Dim Menu $($script:MenuTop+1)-$end de $($script:Actions.Count)$script:Reset`n")}
    for($i=$script:MenuTop;$i-lt$end;$i++){$a=$script:Actions[$i];$label=(Truncate $a.Label 28).PadRight(28);$desc=Truncate $a.Description ([Math]::Max(0,$script:TermCols-41));if($i-eq$script:Selected){[void]$b.Append("$script:EraseLine  $script:BGHover$script:AccentCyan$script:Bold$script:IArr  $label$script:Reset $script:FGSec$desc$script:Reset`n")}else{[void]$b.Append("$script:EraseLine     $script:FGSec$label$script:Reset $script:FGDim$desc$script:Reset`n")}}
    [void]$b.Append("$script:EraseLine`n");$total=$script:LiveLines.Count
    if($total-gt0){[void]$b.Append("$script:EraseLine  $script:FGDim$script:ITerm LIVE OUTPUT:$script:Reset");if($script:ScrollPosition-gt0){[void]$b.Append(" $script:StateWarn[SCROLL: -$script:ScrollPosition]$script:Reset")};[void]$b.Append("`n");$start=[Math]::Max(0,$total-$script:LiveRows-$script:ScrollPosition);$finish=[Math]::Min($total,$start+$script:LiveRows);$indicator=0;if($total-gt$script:LiveRows){$indicator=[int]($script:ScrollPosition*($script:LiveRows-1)/($total-$script:LiveRows))};for($j=0;$j-lt$script:LiveRows;$j++){$idx=$start+$j;$line=if($idx-lt$finish){[string]$script:LiveLines[$idx]}else{''};$bar=if($total-gt$script:LiveRows-and($script:LiveRows-1-$j)-eq$indicator){"$script:AccentCyan█$script:Reset"}else{"$script:FGDim┃$script:Reset"};[void]$b.Append("$script:EraseLine  $bar $script:AccentAmber$(Truncate $line ($script:TermCols-10))$script:Reset`n")}}
    else{for($j=0;$j-lt$script:LiveRows+1;$j++){[void]$b.Append("$script:EraseLine`n")}}
    [void]$b.Append("$script:EraseLine`n");if($script:LastMessage){$state=switch($script:LastStatus){'ok'{"$script:StateOk$script:ICheck"}'warn'{"$script:StateWarn$script:IWarn"}'err'{"$script:StateErr$script:ICross"}default{$script:FGSec}};[void]$b.Append("$script:EraseLine  $script:FGDim$script:Dim STATUS:$script:Reset $state $script:LastMessage$script:Reset`n")}else{[void]$b.Append("$script:EraseLine`n")};[void]$b.Append("$script:EraseLine`n$script:EraseLine  $script:FGDim$script:Dim[↑↓/jk] Mover  [Enter] Executar  [a/z] Scroll  [L] Logs  [Q] Sair$script:Reset$script:Esc[J")
    [Console]::Write($b.ToString())
}
function Boot-Sequence {if($script:NonInteractive){return};Update-Dimensions;[Console]::Write("$script:Esc[?1049h$script:Esc[?25l$script:Esc[2J");$script:InAltScreen=$true;$frames=@('⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏');for($i=1;$i-le30;$i++){try{[Console]::SetCursorPosition([Math]::Max(0,[int](($script:TermCols-36)/2)),[int]($script:TermRows/2))}catch{};[Console]::Write("$script:AccentCyan$($frames[$i%10])$script:Reset $script:FGMain$script:Bold🐾 $(Truncate $script:ProjectName 26)$script:Reset $script:FGDim v$script:Version$script:Reset");Start-Sleep -Milliseconds 50}}
function Test-PortOpen([int]$Port){try{$c=New-Object Net.Sockets.TcpClient;$a=$c.BeginConnect('127.0.0.1',$Port,$null,$null);$ok=$a.AsyncWaitHandle.WaitOne(100);if($ok){$c.EndConnect($a)};$c.Close();return$ok}catch{return$false}}
function Stop-ValidatedServerTree([int]$Pid) {
    if($Pid-le0){return}
    & taskkill.exe /PID $Pid /T *> $null
    for($i=0;$i-lt30;$i++){if(-not(Get-Process -Id $Pid -ErrorAction SilentlyContinue)){return};Start-Sleep -Milliseconds 100}
    & taskkill.exe /PID $Pid /T /F *> $null
}
function Start-ServerAction([string]$Command){
    Refresh-ServerState
    if($script:AppActive){$script:LastStatus='warn';$script:LastMessage="Servidor já ativo: PID $script:ServerPid";return 1}
    if($script:DryRun){Add-LiveLine "[dry-run] $Command";$script:Progress=100;$script:LastStatus='ok';$script:LastMessage='Comando validado em dry-run.';return 0}
    if(Test-PortOpen $script:Port){$script:LastStatus='err';$script:LastMessage="A porta $script:Port já está ocupada; nenhum processo externo foi encerrado.";Write-Log 'ERRO' $script:LastMessage;return 1}
    Clear-Content $script:LogFile -ErrorAction SilentlyContinue
    $id=[Guid]::NewGuid().ToString('N');$cmdFile=Join-Path $script:OrchDir "server-$id.cmd"
    $content="@echo off`r`nsetlocal`r`nset `"PORT=$script:Port`"`r`ncd /d `"$script:ProjectDir`"`r`n$Command >> `"$script:LogFile`" 2>&1`r`nexit /b %errorlevel%`r`n"
    Set-Content $cmdFile $content -Encoding ASCII
    $p=Start-Process $env:ComSpec -ArgumentList '/D','/S','/C',"`"`"$cmdFile`"`"" -WorkingDirectory $script:ProjectDir -WindowStyle Hidden -PassThru
    $script:ServerPid=$p.Id;$script:ServerStartTicks=$p.StartTime.ToUniversalTime().Ticks;$script:ServerCommandFile=$cmdFile
    Set-Content $script:PidFile $p.Id -Encoding ASCII
    [pscustomobject]@{Pid=$p.Id;StartTicks=$script:ServerStartTicks;ProjectDir=$script:ProjectDir;Port=$script:Port;CommandFile=$cmdFile;StartedAt=(Get-Date).ToString('o')}|ConvertTo-Json|Set-Content $script:MetaFile -Encoding UTF8
    $ready=$false
    for($i=0;$i-lt300;$i++){
        if($p.HasExited){Refresh-LiveFromLog;$script:LastStatus='err';$script:LastMessage="Servidor encerrou durante a inicialização com código $($p.ExitCode).";Remove-Item $script:PidFile,$script:MetaFile,$cmdFile -Force -ErrorAction SilentlyContinue;return 1}
        if(Test-PortOpen $script:Port){$ready=$true;break}
        Start-Sleep -Milliseconds 200;$script:Progress=20+[int](70*$i/300);Refresh-LiveFromLog;Draw-UI
    }
    if(-not$ready){$script:LastStatus='err';$script:LastMessage='O processo permaneceu ativo, mas não abriu a porta TCP em 60 segundos.';Stop-ValidatedServerTree $p.Id;Remove-Item $script:PidFile,$script:MetaFile,$cmdFile -Force -ErrorAction SilentlyContinue;$script:ServerPid=0;$script:AppActive=$false;return 1}
    $script:AppActive=$true;$script:Progress=100;$script:LastStatus='ok';$script:LastMessage="Servidor ativo: PID $script:ServerPid, porta $script:Port";return 0
}
function Stop-Server {
    Refresh-ServerState
    if(-not$script:AppActive){$script:LastStatus='warn';$script:LastMessage='Nenhum servidor do orquestrador está ativo.';return 0}
    $pid=$script:ServerPid;$script:CurrentTask="Encerrando servidor PID $pid...";$script:Progress=20;Draw-UI
    Stop-ValidatedServerTree $pid
    Remove-Item $script:PidFile,$script:MetaFile,$script:ServerCommandFile -Force -ErrorAction SilentlyContinue
    $script:AppActive=$false;$script:ServerPid=0;$script:Progress=100;$script:LastStatus='ok';$script:LastMessage='Servidor encerrado com segurança.';return 0
}
function Invoke-LiveCommand([string]$Command,[string]$Label){$script:LiveLines.Clear();$script:ScrollPosition=0;$script:Progress=5;$script:CurrentTask=$Label;$script:LastMessage='';Draw-UI;if($script:DryRun){Add-LiveLine "[dry-run] $Command";$script:Progress=100;$script:LastStatus='ok';$script:LastMessage='Comando exibido sem execução.';return 0};$ctx=New-CommandProcess $Command $true 'action';$line=$null;$spin=0;while(-not$ctx.Process.HasExited-or-not$ctx.Queue.IsEmpty){while($ctx.Queue.TryDequeue([ref]$line)){Add-LiveLine $line};$spin=($spin+1)%70;$script:Progress=10+$spin;Draw-UI;Start-Sleep -Milliseconds 40};$ctx.Process.WaitForExit();$code=$ctx.Process.ExitCode;Remove-Item $ctx.CommandFile -Force -ErrorAction SilentlyContinue;$script:Progress=100;if($code-eq0){$script:LastStatus='ok';$script:LastMessage="$Label concluído com sucesso."}else{$script:LastStatus='err';$script:LastMessage="$Label falhou com código $code."};Draw-UI;return$code}
function Validate-PythonImports {$script:LiveLines.Clear();$script:CurrentTask='Validando imports Python...';$script:Progress=10;Draw-UI;$py=Get-PythonCommand;if([string]::IsNullOrWhiteSpace($py)){$script:LastStatus='err';$script:LastMessage='Python não encontrado.';return 1};$checker=Join-Path $script:OrchDir 'check_imports.py';@'
import ast, importlib.util, pathlib, sys
root=pathlib.Path(sys.argv[1]).resolve(); skip={'.venv','venv','node_modules','.git','build','dist','__pycache__'}
local={p.stem for p in root.glob('*.py')}; local.update(p.name for p in root.iterdir() if p.is_dir() and (p/'__init__.py').exists())
stdlib=set(getattr(sys,'stdlib_module_names',())); imports=set(); errors=[]
for path in root.rglob('*.py'):
    if any(x in skip for x in path.parts): continue
    try: tree=ast.parse(path.read_text(encoding='utf-8',errors='replace'))
    except SyntaxError as e: errors.append(f'{path.relative_to(root)}:{e.lineno}: {e.msg}'); continue
    for n in ast.walk(tree):
        if isinstance(n,ast.Import): imports.update(a.name.split('.')[0] for a in n.names)
        elif isinstance(n,ast.ImportFrom) and n.level==0 and n.module: imports.add(n.module.split('.')[0])
missing=[]
for name in sorted(imports):
    if name in stdlib or name in local: continue
    try: ok=importlib.util.find_spec(name) is not None
    except Exception: ok=False
    if not ok: missing.append(name)
print(f'Imports externos encontrados: {len(imports)}')
for e in errors: print('AVISO sintaxe:',e)
if missing:
    print('Imports não resolvidos após instalar os manifestos:'); [print('  -',x) for x in missing]
    print('O orquestrador não adivinha nomes de pacotes. Declare-os no requirements/pyproject.'); raise SystemExit(1)
print('Todos os imports analisáveis foram resolvidos.')
'@|Set-Content $checker -Encoding UTF8;$code=Invoke-LiveCommand "$py $(Quote-Cmd $checker) $(Quote-Cmd $script:ProjectDir)" 'Validar Imports Python';Remove-Item $checker -Force -ErrorAction SilentlyContinue;return$code}
function Health-Check {$script:LiveLines.Clear();$script:CurrentTask='Verificando Saúde do Projeto...';$script:Progress=10;Draw-UI;$issues=0;Add-LiveLine "Projeto: $script:ProjectDir";Add-LiveLine "Stack: $script:RuntimeSummary";foreach($r in $script:Runtimes){if(Test-Command $r.Command){Add-LiveLine "✔ Runtime $($r.Command): disponível"}else{Add-LiveLine "✖ Runtime ausente: $($r.Command)";$issues++}};foreach($m in $script:Manifests){if(Test-Path $m){Add-LiveLine "✔ Manifesto: $(Relative-Path $m)"}else{Add-LiveLine "✖ Manifesto ausente: $(Relative-Path $m)";$issues++}};if(Test-DependenciesPresent){Add-LiveLine '✔ Estruturas de dependências presentes'}else{Add-LiveLine '⚠ Dependências precisam ser instaladas';$issues++};Refresh-ServerState;if($script:AppActive){Add-LiveLine "✔ Servidor ativo: PID $script:ServerPid"}else{Add-LiveLine '• Nenhum servidor do orquestrador ativo'};$script:Progress=100;if($issues-eq0){$script:LastStatus='ok';$script:LastMessage='Saúde 100% OK.'}else{$script:LastStatus='warn';$script:LastMessage="$issues problema(s) detectado(s)."};Draw-UI;return[bool]($issues-eq0)}
function Show-Logs {if($script:NonInteractive){Get-Content $script:LogFile -Tail $script:LogMax;return};[Console]::Write("$script:Esc[2J$script:Esc[H`n  $script:AccentCyan$script:Bold$script:ITerm LOG VIEWER$script:Reset`n`n");$n=[Math]::Max(5,$script:TermRows-8);Get-Content $script:LogFile -Tail $n -ErrorAction SilentlyContinue|ForEach-Object{[Console]::WriteLine("    $script:FGSec$_$script:Reset")};[Console]::Write("`n  $script:FGDim Pressione qualquer tecla para voltar$script:Reset");[void][Console]::ReadKey($true)}
function Confirm-Action([string]$Text){if($env:ORCH_AUTO_CONFIRM-eq'1'){return$true};if($script:NonInteractive){Write-PlainError 'A ação exige ORCH_AUTO_CONFIRM=1.';return$false};[Console]::Write("$script:Esc[2J$script:Esc[H`n  $script:StateWarn$script:Bold$Text$script:Reset`n`n  Digite CONFIRMAR: ");return([Console]::ReadLine()-eq'CONFIRMAR')}
function Cleanup([int]$Code=0){if($script:CleanupDone){return};$script:CleanupDone=$true;if($script:InAltScreen){[Console]::Write("$script:Esc[?1049l$script:Esc[?25h");$script:InAltScreen=$false};if(-not$script:NonInteractive){Write-Host "`n  $script:AccentRose■ Orquestrador encerrado. Até logo.$script:Reset`n"}}
function Execute-Action([int]$Index){
    $script:LastActionExitCode=0;$a=$script:Actions[$Index]
    if($a.Confirm-and-not(Confirm-Action $a.Description)){$script:LastStatus='warn';$script:LastMessage='Operação cancelada.';$script:LastActionExitCode=4;return 4}
    switch($a.Kind){
        'server'{$script:LiveLines.Clear();$script:CurrentTask=$a.Label;$script:Progress=10;Draw-UI;$script:LastActionExitCode=Start-ServerAction $a.Command;Refresh-LiveFromLog}
        'command'{$script:LastActionExitCode=Invoke-LiveCommand $a.Command $a.Label}
        'stop'{$script:LastActionExitCode=Stop-Server}
        'health'{if(Health-Check){$script:LastActionExitCode=0}else{$script:LastActionExitCode=1}}
        'python_imports'{$script:LastActionExitCode=Validate-PythonImports}
        'logs'{Show-Logs;$script:LastActionExitCode=0}
        'refresh'{Detect-Project;$script:Selected=0;$script:MenuTop=0;$script:Progress=100;$script:LastStatus='ok';$script:LastMessage='Projeto redetectado.';$script:LastActionExitCode=0}
        'subproject'{$script:LastActionExitCode=Open-Subproject $a.Command}
        'exit'{Cleanup 0;exit 0}
        default{$script:LastStatus='err';$script:LastMessage="Tipo de ação desconhecido: $($a.Kind)";$script:LastActionExitCode=2}
    }
    if($script:NonInteractive-and$script:LastMessage){
        switch($script:LastStatus){
            'ok'{Write-PlainOk $script:LastMessage}
            'warn'{Write-PlainWarn $script:LastMessage}
            'err'{Write-PlainError $script:LastMessage}
            default{Write-PlainInfo $script:LastMessage}
        }
    }
    return $script:LastActionExitCode
}
function List-ActionsOutput {Write-Output "PROJETO`t$script:ProjectName";Write-Output "STACK`t$script:RuntimeSummary";Write-Output "PORTA`t$script:Port";foreach($a in $script:Actions){Write-Output "$($a.Id)`t$($a.Label)`t$($a.Description)"}}
function Interactive-Loop {Boot-Sequence;while($true){Refresh-ServerState;if($script:AppActive){Refresh-LiveFromLog};Draw-UI;if([Console]::KeyAvailable){$k=[Console]::ReadKey($true);switch($k.Key){'UpArrow'{$script:Selected=($script:Selected-1+$script:Actions.Count)%$script:Actions.Count}'DownArrow'{$script:Selected=($script:Selected+1)%$script:Actions.Count}'PageUp'{$script:ScrollPosition=[Math]::Min([Math]::Max(0,$script:LiveLines.Count-$script:LiveRows),$script:ScrollPosition+$script:LiveRows)}'PageDown'{$script:ScrollPosition=[Math]::Max(0,$script:ScrollPosition-$script:LiveRows)}'Enter'{$script:ScrollPosition=0;Execute-Action $script:Selected;Detect-Project;if($script:Selected-ge$script:Actions.Count){$script:Selected=$script:Actions.Count-1}}default{switch($k.KeyChar){'j'{$script:Selected=($script:Selected+1)%$script:Actions.Count}'k'{$script:Selected=($script:Selected-1+$script:Actions.Count)%$script:Actions.Count}'a'{$script:ScrollPosition=[Math]::Min([Math]::Max(0,$script:LiveLines.Count-$script:LiveRows),$script:ScrollPosition+1)}'z'{$script:ScrollPosition=[Math]::Max(0,$script:ScrollPosition-1)}'l'{Show-Logs}'L'{Show-Logs}'r'{Detect-Project;$script:Selected=0;$script:MenuTop=0}'R'{Detect-Project;$script:Selected=0;$script:MenuTop=0}'q'{Cleanup 0;exit 0}'Q'{Cleanup 0;exit 0}}}}};Start-Sleep -Milliseconds 50}}

# ──────────────────────────────────────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────────────────────────────────────
try {
    Set-Location $script:ProjectDir
    Bootstrap-All
    if($script:BootstrapOnly){exit 0}
    if($script:ListActions){List-ActionsOutput;exit 0}
    if($script:RequestedAction){$index=-1;for($i=0;$i-lt$script:Actions.Count;$i++){if($script:Actions[$i].Id-eq$script:RequestedAction){$index=$i;break}};if($index-lt0){Write-PlainError "Ação não disponível: $script:RequestedAction";List-ActionsOutput;exit 3};[void](Execute-Action $index);exit $script:LastActionExitCode}
    if([Console]::IsInputRedirected-or[Console]::IsOutputRedirected){throw 'O modo TUI exige terminal interativo. Use --list-actions ou --action ID.'}
    Interactive-Loop
} catch {
    Write-PlainError $_.Exception.Message
    Cleanup 1
    exit 1
} finally {
    Cleanup 0
}

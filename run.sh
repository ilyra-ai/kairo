#!/usr/bin/env bash
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
#  ORQUESTRADOR UNIVERSAL — TUI Noir Elite
#  Compatibilidade principal: WSL2 Ubuntu / Linux com Bash 4+
#
#  Este arquivo deve permanecer na raiz do projeto.
#
#  Uso:
#    bash run.sh                         Abre o menu TUI interativo
#    bash run.sh --list-actions          Lista apenas ações detectadas
#    bash run.sh --action ID             Executa uma ação detectada
#    bash run.sh --port N                Define a porta preferencial
#    bash run.sh --bootstrap-only        Instala/verifica dependências e encerra
#    bash run.sh --dry-run               Mostra comandos sem executá-los
#    bash run.sh --no-bootstrap          Não instala dependências automaticamente
#    bash run.sh --help                  Exibe ajuda
#
#  Princípios:
#    • não inventa ações;
#    • não cria credenciais ou dados administrativos;
#    • usa manifestos, lockfiles e scripts existentes como fonte de verdade;
#    • instala dependências do orquestrador e do projeto quando comprovadas;
#    • preserva código de saída, logs e restauração do terminal.
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

set -o pipefail

readonly REQUIRED_BASH_VERSION=4
if (( BASH_VERSINFO[0] < REQUIRED_BASH_VERSION )); then
    printf 'ERRO: Bash %s+ é obrigatório. Versão atual: %s\n' "$REQUIRED_BASH_VERSION" "$BASH_VERSION" >&2
    exit 1
fi

readonly ORCH_VERSION="5.0.0"
readonly SCRIPT_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
if [[ -n "${ORCH_PROJECT_DIR:-}" ]]; then
    PROJECT_DIR="$(cd "$ORCH_PROJECT_DIR" 2>/dev/null && pwd -P)" || {
        printf 'ERRO: ORCH_PROJECT_DIR inválido: %s\n' "$ORCH_PROJECT_DIR" >&2
        exit 2
    }
else
    PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
fi
readonly PROJECT_DIR
readonly COMPONENT_MODE="${ORCH_COMPONENT_MODE:-0}"
readonly ORCH_DIR="${PROJECT_DIR}/.orchestrator"
readonly LOG_FILE="${ORCH_DIR}/orchestrator.log"
readonly PID_FILE="${ORCH_DIR}/server.pid"
readonly META_FILE="${ORCH_DIR}/server.meta"
readonly LOCK_FILE="${ORCH_DIR}/orchestrator.lock"
readonly DEPS_STAMP_FILE="${ORCH_DIR}/dependencies.sha256"
readonly DETECTION_FILE="${ORCH_DIR}/detection.env"

# Runtimes instalados sem privilégios administrativos pelo próprio orquestrador.
export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$HOME/.bun/bin:$HOME/.dotnet:$HOME/.local/share/flutter/bin:$HOME/.local/share/dart-sdk/bin:$PATH"
[[ -d "$HOME/.dotnet" ]] && export DOTNET_ROOT="$HOME/.dotnet"

PORT="${PORT:-}"
PORT_EXPLICIT=false
[[ -n "$PORT" ]] && PORT_EXPLICIT=true
DRY_RUN=false
NO_BOOTSTRAP=false
BOOTSTRAP_ONLY=false
LIST_ACTIONS=false
REQUESTED_ACTION=""
NON_INTERACTIVE=false

mkdir -p "$ORCH_DIR" 2>/dev/null || {
    printf 'ERRO: não foi possível criar %s\n' "$ORCH_DIR" >&2
    exit 1
}
chmod 700 "$ORCH_DIR" 2>/dev/null || true
touch "$LOG_FILE" 2>/dev/null || {
    printf 'ERRO: não foi possível gravar em %s\n' "$LOG_FILE" >&2
    exit 1
}
chmod 600 "$LOG_FILE" 2>/dev/null || true

# ──────────────────────────────────────────────────────────────────────────────
# Paleta Noir Elite do TUI de referência
# ──────────────────────────────────────────────────────────────────────────────
FG_MAIN="\033[38;2;230;237;243m"
FG_SEC="\033[38;2;139;148;158m"
FG_DIM="\033[38;2;110;118;129m"
ACCENT_CYAN="\033[38;2;86;211;255m"
ACCENT_MINT="\033[38;2;125;239;161m"
ACCENT_AMBER="\033[38;2;255;183;77m"
ACCENT_ROSE="\033[38;2;255;107;129m"
STATE_OK="\033[38;2;63;185;80m"
STATE_WARN="\033[38;2;210;153;34m"
STATE_ERR="\033[38;2;248;81;73m"
BG_HOVER="\033[48;2;33;38;45m"
BOLD="\033[1m"
DIM="\033[2m"
RST="\033[0m"
EL="\033[K"

I_DOT="•"
I_ARR="→"
I_CHECK="✔"
I_WARN="⚠"
I_CROSS="✖"
I_TERM="❯"

if [[ ! -t 1 || "${NO_COLOR:-}" != "" ]]; then
    FG_MAIN=""; FG_SEC=""; FG_DIM=""; ACCENT_CYAN=""; ACCENT_MINT=""
    ACCENT_AMBER=""; ACCENT_ROSE=""; STATE_OK=""; STATE_WARN=""
    STATE_ERR=""; BG_HOVER=""; BOLD=""; DIM=""; RST=""; EL=""
fi

# ──────────────────────────────────────────────────────────────────────────────
# Estado global do TUI
# ──────────────────────────────────────────────────────────────────────────────
SELECTED=0
MENU_TOP=0
MENU_VISIBLE=8
CURRENT_TASK="Standby"
PROGRESS=0
START_TIME=$(date +%s)
SERVER_PID=""
SERVER_PGID=""
APP_ACTIVE=false
NEED_REPAINT=true
LAST_MSG=""
LAST_STATUS=""
SCROLL_POS=0
NR_LINES=5
MENU_OVERHEAD=25
TERM_LINES=24
TERM_COLS=80
LOG_MAX=1000
CLEANUP_DONE=false
IN_ALT_SCREEN=false
ACTIVE_COMMAND_PID=""

PROJECT_NAME="$(basename "$PROJECT_DIR")"
PROJECT_VERSION=""
PROJECT_KIND="Projeto"
PACKAGE_MANAGER=""
NODE_PACKAGE_MANAGER=""
PYTHON_PACKAGE_MANAGER=""
NODE_DECLARED_PACKAGE_MANAGER=""
DOCKER_COMPOSE_CMD="docker compose"
RUNTIME_SUMMARY=""
DEFAULT_PORT=8000

STACKS=()
MANIFESTS=()
DEPENDENCY_COMMANDS=()
DEPENDENCY_DESCRIPTIONS=()
REQUIRED_RUNTIME_COMMANDS=()
REQUIRED_RUNTIME_PACKAGES=()

ACTION_IDS=()
ACTION_LABELS=()
ACTION_DESCS=()
ACTION_CMDS=()
ACTION_KINDS=()
ACTION_CONFIRMS=()
COMPONENT_DIRS=()
COMPONENT_DESCRIPTIONS=()

LIVE_LINES=()
LOG_LINES=()

# ──────────────────────────────────────────────────────────────────────────────
# Utilidades e logging
# ──────────────────────────────────────────────────────────────────────────────
now_ts() { date '+%Y-%m-%d %H:%M:%S'; }

log_msg() {
    local level="$1" msg="$2"
    local entry="[$(date '+%H:%M:%S')] [$level] $msg"
    LOG_LINES+=("$entry")
    ((${#LOG_LINES[@]} > LOG_MAX)) && LOG_LINES=("${LOG_LINES[@]:1}")
    printf '%s\n' "$entry" >> "$LOG_FILE" 2>/dev/null || true
}
log_info() { log_msg "INFO" "$1"; }
log_ok()   { log_msg " OK " "$1"; }
log_warn() { log_msg "WARN" "$1"; }
log_err()  { log_msg "ERRO" "$1"; }

plain_info() { printf '  [INFO] %s\n' "$1"; log_info "$1"; }
plain_ok()   { printf '  [ OK ] %s\n' "$1"; log_ok "$1"; }
plain_warn() { printf '  [AVISO] %s\n' "$1"; log_warn "$1"; }
plain_err()  { printf '  [ERRO] %s\n' "$1" >&2; log_err "$1"; }

command_exists() { command -v "$1" >/dev/null 2>&1; }
trim() { local s="$*"; s="${s#"${s%%[![:space:]]*}"}"; s="${s%"${s##*[![:space:]]}"}"; printf '%s' "$s"; }

shell_quote() { printf '%q' "$1"; }

join_by() {
    local delimiter="$1"; shift
    local out="" item
    for item in "$@"; do
        [[ -n "$out" ]] && out+="$delimiter"
        out+="$item"
    done
    printf '%s' "$out"
}

safe_read_first_line() {
    local file="$1"
    [[ -f "$file" ]] || return 1
    IFS= read -r REPLY < "$file" || true
    printf '%s' "$REPLY"
}

project_relative() {
    local path="$1"
    printf '%s' "${path#"$PROJECT_DIR"/}"
}

# ──────────────────────────────────────────────────────────────────────────────
# Argumentos
# ──────────────────────────────────────────────────────────────────────────────
show_help() {
    cat <<'HELP'
Uso: bash run.sh [opções]

Opções:
  --list-actions          Lista somente as ações realmente detectadas no projeto.
  --action ID             Executa uma ação pelo identificador exibido na lista.
  --port N                Define a porta preferencial do servidor.
  --bootstrap-only        Instala/verifica dependências e encerra.
  --dry-run               Não altera o projeto; apenas mostra comandos.
  --no-bootstrap          Desativa instalação automática de requisitos.
  --help, -h              Exibe esta ajuda.

Variáveis:
  PORT=N                  Porta preferencial.
  NO_COLOR=1              Desativa cores ANSI.
  ORCH_AUTO_CONFIRM=1     Confirma operações destrutivas em modo não interativo.

O script deve permanecer na raiz do projeto. Ele detecta manifestos, lockfiles,
scripts e ferramentas existentes e só oferece ações que tenham implementação real.
HELP
}

validate_port() {
    local value="$1"
    [[ "$value" =~ ^[0-9]+$ ]] || return 1
    (( value >= 1 && value <= 65535 )) || return 1
}

while (($# > 0)); do
    case "$1" in
        --list-actions) LIST_ACTIONS=true; NON_INTERACTIVE=true; shift ;;
        --action)
            [[ $# -ge 2 ]] || { plain_err "--action exige um identificador."; exit 2; }
            REQUESTED_ACTION="$2"; NON_INTERACTIVE=true; shift 2 ;;
        --action=*) REQUESTED_ACTION="${1#*=}"; NON_INTERACTIVE=true; shift ;;
        --port)
            [[ $# -ge 2 ]] || { plain_err "--port exige um número."; exit 2; }
            validate_port "$2" || { plain_err "Porta inválida: $2"; exit 2; }
            PORT="$2"; PORT_EXPLICIT=true; shift 2 ;;
        --port=*)
            value="${1#*=}"
            validate_port "$value" || { plain_err "Porta inválida: $value"; exit 2; }
            PORT="$value"; PORT_EXPLICIT=true; shift ;;
        --bootstrap-only) BOOTSTRAP_ONLY=true; NON_INTERACTIVE=true; shift ;;
        --dry-run) DRY_RUN=true; shift ;;
        --no-bootstrap) NO_BOOTSTRAP=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) plain_err "Argumento desconhecido: $1"; show_help; exit 2 ;;
    esac
done

# ──────────────────────────────────────────────────────────────────────────────
# Bootstrap do próprio orquestrador no WSL2/Ubuntu
# ──────────────────────────────────────────────────────────────────────────────
is_debian_family() {
    [[ -f /etc/debian_version ]] || command_exists apt-get
}

sudo_prefix() {
    if (( EUID == 0 )); then
        printf ''
    elif command_exists sudo; then
        printf 'sudo'
    else
        return 1
    fi
}

apt_install_packages() {
    local packages=("$@")
    ((${#packages[@]} > 0)) || return 0
    local sudo_cmd
    sudo_cmd="$(sudo_prefix)" || {
        plain_err "São necessários privilégios administrativos e o comando sudo não está disponível."
        return 1
    }
    if $DRY_RUN; then
        plain_info "[dry-run] ${sudo_cmd:+$sudo_cmd }apt-get update"
        plain_info "[dry-run] ${sudo_cmd:+$sudo_cmd }apt-get install -y ${packages[*]}"
        return 0
    fi
    plain_info "Atualizando catálogo APT para instalar requisitos ausentes..."
    ${sudo_cmd:+$sudo_cmd }apt-get update -y
    plain_info "Instalando requisitos: ${packages[*]}"
    DEBIAN_FRONTEND=noninteractive ${sudo_cmd:+$sudo_cmd }apt-get install -y "${packages[@]}"
}

ensure_self_dependencies() {
    $NO_BOOTSTRAP && { plain_warn "Bootstrap automático desativado por --no-bootstrap."; return 0; }

    local missing_packages=()
    command_exists tput    || missing_packages+=(ncurses-bin)
    command_exists jq      || missing_packages+=(jq)
    command_exists lsof    || missing_packages+=(lsof)
    command_exists flock   || missing_packages+=(util-linux)
    command_exists curl    || missing_packages+=(curl)
    command_exists git     || missing_packages+=(git)
    command_exists sha256sum || missing_packages+=(coreutils)
    command_exists awk     || missing_packages+=(gawk)
    command_exists ps      || missing_packages+=(procps)
    command_exists unzip   || missing_packages+=(unzip)
    command_exists tar     || missing_packages+=(tar)
    command_exists bzip2   || missing_packages+=(bzip2)
    command_exists setsid  || missing_packages+=(util-linux)
    [[ -f /etc/ssl/certs/ca-certificates.crt ]] || missing_packages+=(ca-certificates)

    if ((${#missing_packages[@]} == 0)); then
        plain_ok "Dependências internas do orquestrador estão disponíveis."
        return 0
    fi

    if ! is_debian_family; then
        plain_err "Sistema sem APT detectado. Instale manualmente: ${missing_packages[*]}"
        return 1
    fi

    local unique=() pkg seen
    for pkg in "${missing_packages[@]}"; do
        seen=false
        local existing
        for existing in "${unique[@]}"; do [[ "$existing" == "$pkg" ]] && seen=true; done
        $seen || unique+=("$pkg")
    done
    apt_install_packages "${unique[@]}"
}

# ──────────────────────────────────────────────────────────────────────────────
# Leitura segura dos manifestos
# ──────────────────────────────────────────────────────────────────────────────
json_value() {
    local file="$1" expression="$2"
    jq -r "$expression // empty" "$file" 2>/dev/null || true
}

json_has_script() {
    local file="$1" script="$2"
    jq -e --arg key "$script" '.scripts[$key] != null and (.scripts[$key] | type == "string") and (.scripts[$key] | length > 0)' "$file" >/dev/null 2>&1
}

json_script_value() {
    local file="$1" script="$2"
    jq -r --arg key "$script" '.scripts[$key] // empty' "$file" 2>/dev/null || true
}

add_stack() {
    local stack="$1"
    local existing
    for existing in "${STACKS[@]}"; do [[ "$existing" == "$stack" ]] && return 0; done
    STACKS+=("$stack")
}

add_manifest() {
    local manifest="$1"
    [[ -f "$manifest" ]] || return 0
    local existing
    for existing in "${MANIFESTS[@]}"; do [[ "$existing" == "$manifest" ]] && return 0; done
    MANIFESTS+=("$manifest")
}

add_dependency_command() {
    local command="$1" description="$2"
    local existing
    for existing in "${DEPENDENCY_COMMANDS[@]}"; do [[ "$existing" == "$command" ]] && return 0; done
    DEPENDENCY_COMMANDS+=("$command")
    DEPENDENCY_DESCRIPTIONS+=("$description")
}

require_runtime() {
    local command="$1" apt_package="$2"
    local i
    for i in "${!REQUIRED_RUNTIME_COMMANDS[@]}"; do
        [[ "${REQUIRED_RUNTIME_COMMANDS[$i]}|${REQUIRED_RUNTIME_PACKAGES[$i]}" == "$command|$apt_package" ]] && return 0
    done
    REQUIRED_RUNTIME_COMMANDS+=("$command")
    REQUIRED_RUNTIME_PACKAGES+=("$apt_package")
}

add_action() {
    local id="$1" label="$2" desc="$3" cmd="$4" kind="${5:-command}" confirm="${6:-false}"
    [[ -n "$cmd" || "$kind" =~ ^(health|logs|stop|exit|refresh|python_imports)$ ]] || return 0

    # Projetos full stack podem declarar ações semanticamente iguais em camadas
    # diferentes. Nenhuma ação real é descartada: o identificador recebe um
    # sufixo determinístico apenas quando já existe no catálogo atual.
    local base_id="$id" suffix=2 existing collision
    while true; do
        collision=false
        for existing in "${ACTION_IDS[@]}"; do
            if [[ "$existing" == "$id" ]]; then collision=true; break; fi
        done
        $collision || break
        id="${base_id}_${suffix}"
        ((suffix++))
    done

    ACTION_IDS+=("$id")
    ACTION_LABELS+=("$label")
    ACTION_DESCS+=("$desc")
    ACTION_CMDS+=("$cmd")
    ACTION_KINDS+=("$kind")
    ACTION_CONFIRMS+=("$confirm")
}

package_runner() {
    case "$NODE_PACKAGE_MANAGER" in
        pnpm) printf 'pnpm run' ;;
        yarn) printf 'yarn' ;;
        bun)  printf 'bun run' ;;
        npm|*) printf 'npm run' ;;
    esac
}

node_exec() {
    case "$NODE_PACKAGE_MANAGER" in
        pnpm) printf 'pnpm exec' ;;
        yarn) printf 'yarn' ;;
        bun)  printf 'bunx' ;;
        npm|*) printf 'npm exec --' ;;
    esac
}

node_dep_in_file() {
    local file="$1" dep="$2"
    jq -e --arg dep "$dep" '(.dependencies[$dep] // .devDependencies[$dep] // .peerDependencies[$dep] // .optionalDependencies[$dep]) != null' "$file" >/dev/null 2>&1
}

node_dep_in_project() {
    local dep="$1" file
    while IFS= read -r -d '' file; do
        node_dep_in_file "$file" "$dep" && return 0
    done < <(find "$PROJECT_DIR" -maxdepth 5 -type f -name package.json \
        -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path '*/dist/*' -not -path '*/build/*' -print0 2>/dev/null)
    return 1
}

add_stack_for_node_dep() {
    local dep="$1" label="$2"
    node_dep_in_project "$dep" && add_stack "$label"
}

add_node_script_action() {
    local script="$1" runner="$2"
    case "$script" in
        dev|develop) add_action "START_DEV" "🚀 Iniciar Desenvolvimento" "Executar script $script do package.json" "$runner $script" "server" ;;
        start|serve) add_action "START_PROD" "🌐 Iniciar Aplicação" "Executar script $script do package.json" "$runner $script" "server" ;;
        preview) add_action "PREVIEW" "👁 Visualizar Build" "Executar script preview do package.json" "$runner preview" "server" ;;
        build) add_action "BUILD" "🏗 Construir Projeto" "Executar script build do package.json" "$runner build" ;;
        test|test:unit|test:integration) add_action "TEST_${script//[:]/_}" "🧪 Executar ${script}" "Executar script $script do package.json" "$runner $script" ;;
        lint) add_action "LINT" "🔎 Executar Lint" "Executar script lint do package.json" "$runner lint" ;;
        format|format:write) add_action "FORMAT" "✨ Formatar Código" "Executar script $script do package.json" "$runner $script" ;;
        typecheck|type-check|check:types) add_action "TYPECHECK" "🧬 Verificar Tipos" "Executar script $script do package.json" "$runner $script" ;;
        check|validate) add_action "CHECK" "✅ Executar Verificações" "Executar script $script do package.json" "$runner $script" ;;
        e2e|test:e2e|qa|test:qa) add_action "E2E" "🌐 Testes E2E / QA" "Executar script $script do package.json" "$runner $script" ;;
        storybook) add_action "STORYBOOK" "📚 Iniciar Storybook" "Executar script storybook do package.json" "$runner storybook" "server" ;;
        build-storybook) add_action "BUILD_STORYBOOK" "📦 Construir Storybook" "Executar script build-storybook" "$runner build-storybook" ;;
        db:migrate|migrate|migration:run|prisma:migrate|typeorm:migration:run) add_action "MIGRATE" "🗄 Aplicar Migrações" "Executar script $script" "$runner $script" ;;
        db:push|prisma:push) add_action "DB_PUSH" "🗄 Sincronizar Banco" "Executar script $script" "$runner $script" ;;
        db:seed|seed|prisma:seed) add_action "SEED" "🌱 Popular Banco" "Executar script $script" "$runner $script" ;;
        db:reset|reset|prisma:reset) add_action "RESET_DB" "♻ Resetar Banco" "Executar script $script" "$runner $script" "command" true ;;
        docker:up|compose:up) add_action "DOCKER_UP_SCRIPT" "🐳 Subir Containers" "Executar script $script" "$runner $script" "server" ;;
        docker:down|compose:down) add_action "DOCKER_DOWN_SCRIPT" "🛑 Derrubar Containers" "Executar script $script" "$runner $script" ;;
        clean) add_action "CLEAN" "🧹 Limpar Artefatos" "Executar script clean" "$runner clean" "command" true ;;
        pre*|post*|prepare|prepublish|prepublishOnly|prepack|postpack) ;;
        *) add_action "SCRIPT_${script//[^A-Za-z0-9]/_}" "▶ ${script}" "Executar script $script do package.json" "$runner $script" ;;
    esac
}

detect_node_framework_labels() {
    add_stack_for_node_dep "react" "React"
    add_stack_for_node_dep "next" "Next.js"
    add_stack_for_node_dep "vue" "Vue"
    add_stack_for_node_dep "nuxt" "Nuxt"
    add_stack_for_node_dep "@angular/core" "Angular"
    add_stack_for_node_dep "svelte" "Svelte"
    add_stack_for_node_dep "@sveltejs/kit" "SvelteKit"
    add_stack_for_node_dep "astro" "Astro"
    add_stack_for_node_dep "@remix-run/react" "Remix"
    add_stack_for_node_dep "gatsby" "Gatsby"
    add_stack_for_node_dep "solid-js" "SolidJS"
    add_stack_for_node_dep "@builder.io/qwik" "Qwik"
    add_stack_for_node_dep "vite" "Vite"
    add_stack_for_node_dep "@nestjs/core" "NestJS"
    add_stack_for_node_dep "express" "Express"
    add_stack_for_node_dep "fastify" "Fastify"
    add_stack_for_node_dep "koa" "Koa"
    add_stack_for_node_dep "@adonisjs/core" "AdonisJS"
    add_stack_for_node_dep "@strapi/strapi" "Strapi"
    add_stack_for_node_dep "expo" "Expo"
    add_stack_for_node_dep "react-native" "React Native"
    add_stack_for_node_dep "@ionic/react" "Ionic"
    add_stack_for_node_dep "@ionic/angular" "Ionic"
    add_stack_for_node_dep "@capacitor/core" "Capacitor"
    add_stack_for_node_dep "@nativescript/core" "NativeScript"
    add_stack_for_node_dep "@playwright/test" "Playwright"
    add_stack_for_node_dep "cypress" "Cypress"
    add_stack_for_node_dep "vitest" "Vitest"
    add_stack_for_node_dep "jest" "Jest"
    add_stack_for_node_dep "storybook" "Storybook"
    add_stack_for_node_dep "@storybook/react" "Storybook"
    add_stack_for_node_dep "@tensorflow/tfjs" "TensorFlow.js"
    add_stack_for_node_dep "@tensorflow/tfjs-node" "TensorFlow.js"
    add_stack_for_node_dep "onnxruntime-node" "ONNX Runtime"
    add_stack_for_node_dep "@huggingface/transformers" "Transformers.js"
    add_stack_for_node_dep "@xenova/transformers" "Transformers.js"
    add_stack_for_node_dep "langchain" "LangChain.js"
    add_stack_for_node_dep "llamaindex" "LlamaIndex"
    add_stack_for_node_dep "openai" "OpenAI SDK"
    add_stack_for_node_dep "ai" "Vercel AI SDK"

    local exec_cmd
    exec_cmd="$(node_exec)"
    if node_dep_in_project "@playwright/test" && ! json_has_script "$PROJECT_DIR/package.json" "e2e" && ! json_has_script "$PROJECT_DIR/package.json" "test:e2e"; then
        [[ -f "$PROJECT_DIR/playwright.config.ts" || -f "$PROJECT_DIR/playwright.config.js" || -f "$PROJECT_DIR/playwright.config.mjs" ]] && \
            add_action "PLAYWRIGHT" "🌐 Executar Playwright" "Configuração Playwright detectada" "$exec_cmd playwright test"
    fi
    if node_dep_in_project "cypress" && ! json_has_script "$PROJECT_DIR/package.json" "e2e"; then
        [[ -f "$PROJECT_DIR/cypress.config.ts" || -f "$PROJECT_DIR/cypress.config.js" ]] && \
            add_action "CYPRESS" "🌐 Executar Cypress" "Configuração Cypress detectada" "$exec_cmd cypress run"
    fi
}

node_install_command() {
    case "$NODE_PACKAGE_MANAGER" in
        pnpm) [[ -f "$PROJECT_DIR/pnpm-lock.yaml" ]] && printf 'pnpm install --frozen-lockfile' || printf 'pnpm install' ;;
        yarn)
            if [[ -f "$PROJECT_DIR/yarn.lock" ]]; then
                printf 'yarn install --immutable || yarn install --frozen-lockfile'
            else
                printf 'yarn install'
            fi
            ;;
        bun) [[ -f "$PROJECT_DIR/bun.lockb" || -f "$PROJECT_DIR/bun.lock" ]] && printf 'bun install --frozen-lockfile' || printf 'bun install' ;;
        npm|*) [[ -f "$PROJECT_DIR/package-lock.json" || -f "$PROJECT_DIR/npm-shrinkwrap.json" ]] && printf 'npm ci' || printf 'npm install' ;;
    esac
}

detect_node_project() {
    local file="$PROJECT_DIR/package.json"
    [[ -f "$file" ]] || return 0
    add_stack "Node.js"
    add_manifest "$file"
    [[ -f "$PROJECT_DIR/package-lock.json" ]] && add_manifest "$PROJECT_DIR/package-lock.json"
    [[ -f "$PROJECT_DIR/npm-shrinkwrap.json" ]] && add_manifest "$PROJECT_DIR/npm-shrinkwrap.json"
    [[ -f "$PROJECT_DIR/pnpm-lock.yaml" ]] && add_manifest "$PROJECT_DIR/pnpm-lock.yaml"
    [[ -f "$PROJECT_DIR/yarn.lock" ]] && add_manifest "$PROJECT_DIR/yarn.lock"
    [[ -f "$PROJECT_DIR/bun.lock" ]] && add_manifest "$PROJECT_DIR/bun.lock"
    [[ -f "$PROJECT_DIR/bun.lockb" ]] && add_manifest "$PROJECT_DIR/bun.lockb"

    local declared_pm
    declared_pm="$(json_value "$file" '.packageManager')"
    NODE_DECLARED_PACKAGE_MANAGER="$declared_pm"
    if [[ "$declared_pm" == pnpm@* || -f "$PROJECT_DIR/pnpm-lock.yaml" ]]; then NODE_PACKAGE_MANAGER="pnpm"
    elif [[ "$declared_pm" == yarn@* || -f "$PROJECT_DIR/yarn.lock" ]]; then NODE_PACKAGE_MANAGER="yarn"
    elif [[ "$declared_pm" == bun@* || -f "$PROJECT_DIR/bun.lock" || -f "$PROJECT_DIR/bun.lockb" ]]; then NODE_PACKAGE_MANAGER="bun"
    else NODE_PACKAGE_MANAGER="npm"
    fi

    PROJECT_NAME="$(json_value "$file" '.name')"; [[ -n "$PROJECT_NAME" ]] || PROJECT_NAME="$(basename "$PROJECT_DIR")"
    PROJECT_VERSION="$(json_value "$file" '.version')"
    PROJECT_KIND="Aplicação Node.js"
    DEFAULT_PORT=3000
    require_runtime "node" "nodejs"
    require_runtime "npm" "npm"

    add_dependency_command "$(node_install_command)" "Dependências Node.js via ${NODE_PACKAGE_MANAGER}"

    local runner script
    runner="$(package_runner)"
    while IFS= read -r script; do
        [[ -n "$script" ]] || continue
        add_node_script_action "$script" "$runner"
    done < <(jq -r '.scripts // {} | keys[]' "$file" 2>/dev/null || true)

    detect_node_framework_labels


    if jq -e '.dependencies.next != null or .devDependencies.next != null' "$file" >/dev/null 2>&1; then
        add_stack "Next.js"
        PROJECT_KIND="Aplicação Next.js"
    elif jq -e '.dependencies.vite != null or .devDependencies.vite != null' "$file" >/dev/null 2>&1; then
        add_stack "Vite"
        PROJECT_KIND="Aplicação Vite"
    elif jq -e '.dependencies["@nestjs/core"] != null or .devDependencies["@nestjs/core"] != null' "$file" >/dev/null 2>&1; then
        add_stack "NestJS"
        PROJECT_KIND="API NestJS"
    fi
}

python_executable() {
    if [[ -x "$PROJECT_DIR/.venv/bin/python" ]]; then printf '%q' "$PROJECT_DIR/.venv/bin/python"
    elif [[ -x "$PROJECT_DIR/venv/bin/python" ]]; then printf '%q' "$PROJECT_DIR/venv/bin/python"
    else printf 'python3'
    fi
}

python_pip() {
    local py; py="$(python_executable)"
    printf '%s -m pip' "$py"
}

detect_fastapi_module() {
    local file
    while IFS= read -r -d '' file; do
        if grep -Eq '^[[:space:]]*(app|application)[[:space:]]*=[[:space:]]*FastAPI\(' "$file"; then
            local rel="${file#"$PROJECT_DIR"/}"
            rel="${rel%.py}"
            rel="${rel//\//.}"
            local var
            var="$(grep -E '^[[:space:]]*(app|application)[[:space:]]*=[[:space:]]*FastAPI\(' "$file" | head -1 | sed -E 's/^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*).*/\1/')"
            printf '%s:%s' "$rel" "$var"
            return 0
        fi
    done < <(find "$PROJECT_DIR" -maxdepth 4 -type f -name '*.py' \
        -not -path '*/.venv/*' -not -path '*/venv/*' -not -path '*/site-packages/*' -print0 2>/dev/null)
    return 1
}

detect_flask_module() {
    local file
    while IFS= read -r -d '' file; do
        if grep -Eq '^[[:space:]]*(app|application)[[:space:]]*=[[:space:]]*Flask\(' "$file"; then
            local rel="${file#"$PROJECT_DIR"/}"
            rel="${rel%.py}"; rel="${rel//\//.}"
            printf '%s' "$rel"
            return 0
        fi
    done < <(find "$PROJECT_DIR" -maxdepth 3 -type f -name '*.py' \
        -not -path '*/.venv/*' -not -path '*/venv/*' -print0 2>/dev/null)
    return 1
}

python_dependency_declared() {
    local pattern="$1"
    grep -RqiE "$pattern" \
        "$PROJECT_DIR/pyproject.toml" "$PROJECT_DIR/requirements.txt" "$PROJECT_DIR/requirements-dev.txt" \
        "$PROJECT_DIR/Pipfile" "$PROJECT_DIR/poetry.lock" "$PROJECT_DIR/uv.lock" "$PROJECT_DIR/setup.py" "$PROJECT_DIR/setup.cfg" \
        2>/dev/null
}

find_python_file_matching() {
    local pattern="$1" file
    while IFS= read -r -d '' file; do
        grep -Eq "$pattern" "$file" && { printf '%s' "$file"; return 0; }
    done < <(find "$PROJECT_DIR" -maxdepth 5 -type f -name '*.py' \
        -not -path '*/.venv/*' -not -path '*/venv/*' -not -path '*/site-packages/*' \
        -not -path '*/.git/*' -not -path '*/build/*' -not -path '*/dist/*' -print0 2>/dev/null)
    return 1
}

detect_python_ecosystem() {
    python_dependency_declared '(^|[^A-Za-z0-9_-])(torch|pytorch)([^A-Za-z0-9_-]|$)' && add_stack "PyTorch"
    python_dependency_declared '(^|[^A-Za-z0-9_-])tensorflow([^A-Za-z0-9_-]|$)' && add_stack "TensorFlow"
    python_dependency_declared '(^|[^A-Za-z0-9_-])jax([^A-Za-z0-9_-]|$)' && add_stack "JAX"
    python_dependency_declared '(^|[^A-Za-z0-9_-])transformers([^A-Za-z0-9_-]|$)' && add_stack "Hugging Face Transformers"
    python_dependency_declared '(^|[^A-Za-z0-9_-])diffusers([^A-Za-z0-9_-]|$)' && add_stack "Diffusers"
    python_dependency_declared '(^|[^A-Za-z0-9_-])langchain([^A-Za-z0-9_-]|$)' && add_stack "LangChain"
    python_dependency_declared '(^|[^A-Za-z0-9_-])(llama-index|llama_index)([^A-Za-z0-9_-]|$)' && add_stack "LlamaIndex"
    python_dependency_declared '(^|[^A-Za-z0-9_-])scikit-learn([^A-Za-z0-9_-]|$)' && add_stack "scikit-learn"
    python_dependency_declared '(^|[^A-Za-z0-9_-])xgboost([^A-Za-z0-9_-]|$)' && add_stack "XGBoost"
    python_dependency_declared '(^|[^A-Za-z0-9_-])lightgbm([^A-Za-z0-9_-]|$)' && add_stack "LightGBM"
    python_dependency_declared '(^|[^A-Za-z0-9_-])pandas([^A-Za-z0-9_-]|$)' && add_stack "pandas"
    python_dependency_declared '(^|[^A-Za-z0-9_-])polars([^A-Za-z0-9_-]|$)' && add_stack "Polars"
    python_dependency_declared '(^|[^A-Za-z0-9_-])numpy([^A-Za-z0-9_-]|$)' && add_stack "NumPy"
    python_dependency_declared '(^|[^A-Za-z0-9_-])pyspark([^A-Za-z0-9_-]|$)' && add_stack "PySpark"
    python_dependency_declared '(^|[^A-Za-z0-9_-])ray([^A-Za-z0-9_-]|$)' && add_stack "Ray"
    python_dependency_declared '(^|[^A-Za-z0-9_-])mlflow([^A-Za-z0-9_-]|$)' && add_stack "MLflow"
    python_dependency_declared '(^|[^A-Za-z0-9_-])airflow([^A-Za-z0-9_-]|$)' && add_stack "Apache Airflow"
    python_dependency_declared '(^|[^A-Za-z0-9_-])streamlit([^A-Za-z0-9_-]|$)' && add_stack "Streamlit"
    python_dependency_declared '(^|[^A-Za-z0-9_-])gradio([^A-Za-z0-9_-]|$)' && add_stack "Gradio"
    python_dependency_declared '(^|[^A-Za-z0-9_-])(jupyterlab|jupyter)([^A-Za-z0-9_-]|$)' && add_stack "Jupyter"
    python_dependency_declared '(^|[^A-Za-z0-9_-])fastai([^A-Za-z0-9_-]|$)' && add_stack "fastai"
    python_dependency_declared '(^|[^A-Za-z0-9_-])ultralytics([^A-Za-z0-9_-]|$)' && add_stack "Ultralytics"
    python_dependency_declared '(^|[^A-Za-z0-9_-])onnxruntime([^A-Za-z0-9_-]|$)' && add_stack "ONNX Runtime"

    local py streamlit_file gradio_file
    py="$(python_executable)"
    if python_dependency_declared '(^|[^A-Za-z0-9_-])streamlit([^A-Za-z0-9_-]|$)'; then
        streamlit_file="$(find_python_file_matching '(^|[[:space:]])(import[[:space:]]+streamlit|from[[:space:]]+streamlit)' || true)"
        if [[ -n "$streamlit_file" ]]; then
            add_action "STREAMLIT" "📊 Iniciar Streamlit" "Aplicação Streamlit detectada em $(project_relative "$streamlit_file")" \
                "$py -m streamlit run $(shell_quote "$(project_relative "$streamlit_file")") --server.address 0.0.0.0 --server.port \${PORT}" "server"
        fi
    fi
    if python_dependency_declared '(^|[^A-Za-z0-9_-])gradio([^A-Za-z0-9_-]|$)'; then
        gradio_file="$(find_python_file_matching '(^|[[:space:]])(import[[:space:]]+gradio|from[[:space:]]+gradio)' || true)"
        if [[ -n "$gradio_file" ]] && grep -qE '\.launch\(' "$gradio_file"; then
            add_action "GRADIO" "🧠 Iniciar Gradio" "Aplicação Gradio detectada em $(project_relative "$gradio_file")" \
                "$py $(shell_quote "$(project_relative "$gradio_file")")" "server"
        fi
    fi
    if python_dependency_declared '(^|[^A-Za-z0-9_-])(jupyterlab|jupyter)([^A-Za-z0-9_-]|$)' && \
       find "$PROJECT_DIR" -maxdepth 4 -type f -name '*.ipynb' -not -path '*/.venv/*' -print -quit | grep -q .; then
        add_action "JUPYTER" "📓 Iniciar Jupyter Lab" "Notebooks e dependência Jupyter detectados" \
            "$py -m jupyter lab --ip 0.0.0.0 --port \${PORT} --no-browser" "server"
    fi
    if python_dependency_declared '(^|[^A-Za-z0-9_-])mlflow([^A-Za-z0-9_-]|$)' && [[ -d "$PROJECT_DIR/mlruns" || -f "$PROJECT_DIR/mlflow.db" ]]; then
        add_action "MLFLOW" "📈 Iniciar MLflow" "Armazenamento MLflow detectado" "$py -m mlflow ui --host 0.0.0.0 --port \${PORT}" "server"
    fi
}

detect_python_project() {
    local found=false
    local file
    for file in pyproject.toml requirements.txt requirements-dev.txt Pipfile poetry.lock uv.lock setup.py setup.cfg; do
        if [[ -f "$PROJECT_DIR/$file" ]]; then add_manifest "$PROJECT_DIR/$file"; found=true; fi
    done
    [[ -f "$PROJECT_DIR/manage.py" ]] && { add_manifest "$PROJECT_DIR/manage.py"; found=true; }
    $found || return 0

    add_stack "Python"
    PROJECT_KIND="Aplicação Python"
    DEFAULT_PORT=8000
    require_runtime "python3" "python3"
    require_runtime "python3" "python3-venv"
    require_runtime "python3" "python3-pip"

    if [[ -f "$PROJECT_DIR/uv.lock" ]]; then
        PYTHON_PACKAGE_MANAGER="uv"
        require_runtime "curl" "curl"
        add_dependency_command "uv sync --frozen" "Dependências Python via uv"
    elif [[ -f "$PROJECT_DIR/poetry.lock" ]] || grep -q '\[tool.poetry\]' "$PROJECT_DIR/pyproject.toml" 2>/dev/null; then
        PYTHON_PACKAGE_MANAGER="poetry"
        add_dependency_command "poetry install --no-interaction" "Dependências Python via Poetry"
    elif [[ -f "$PROJECT_DIR/Pipfile" ]]; then
        PYTHON_PACKAGE_MANAGER="pipenv"
        add_dependency_command "pipenv sync --dev" "Dependências Python via Pipenv"
    elif [[ -f "$PROJECT_DIR/requirements.txt" ]]; then
        PYTHON_PACKAGE_MANAGER="pip"
        add_dependency_command "$(python_pip) install -r requirements.txt" "Dependências Python do requirements.txt"
        [[ -f "$PROJECT_DIR/requirements-dev.txt" ]] && add_dependency_command "$(python_pip) install -r requirements-dev.txt" "Dependências Python de desenvolvimento"
    elif [[ -f "$PROJECT_DIR/pyproject.toml" ]]; then
        PYTHON_PACKAGE_MANAGER="pip"
        add_dependency_command "$(python_pip) install -e ." "Projeto Python definido em pyproject.toml"
    fi

    local py
    py="$(python_executable)"
    if [[ -f "$PROJECT_DIR/manage.py" ]]; then
        add_stack "Django"
        PROJECT_KIND="Aplicação Django"
        add_action "START_DEV" "🚀 Iniciar Desenvolvimento" "Django runserver" "$py manage.py runserver 0.0.0.0:\${PORT}" "server"
        add_action "MIGRATE" "🗄 Aplicar Migrações" "Django migrate" "$py manage.py migrate --noinput"
        add_action "MAKE_MIGRATIONS" "🧱 Gerar Migrações" "Django makemigrations" "$py manage.py makemigrations --noinput"
        add_action "CHECK" "✅ Verificar Projeto" "Django system check" "$py manage.py check"
        add_action "TEST" "🧪 Executar Testes" "Django test" "$py manage.py test"
        add_action "COLLECT_STATIC" "📦 Coletar Estáticos" "Django collectstatic" "$py manage.py collectstatic --noinput"
        if [[ -f "$PROJECT_DIR/pytest.ini" || -f "$PROJECT_DIR/pyproject.toml" ]] && grep -q 'pytest' "$PROJECT_DIR/pyproject.toml" "$PROJECT_DIR/requirements"*.txt 2>/dev/null; then
            add_action "PYTEST" "🧪 Executar Pytest" "Testes Python com pytest" "$py -m pytest"
        fi
        local wsgi_file
        wsgi_file="$(find "$PROJECT_DIR" -maxdepth 3 -type f -name wsgi.py -not -path '*/.venv/*' -not -path '*/venv/*' | head -1)"
        if [[ -n "$wsgi_file" ]] && grep -RqiE '(^|[<=>~ ])gunicorn([<=>~ ]|$)' "$PROJECT_DIR/requirements"*.txt "$PROJECT_DIR/pyproject.toml" 2>/dev/null; then
            local module="${wsgi_file#"$PROJECT_DIR"/}"; module="${module%.py}"; module="${module//\//.}"
            add_action "START_PROD" "🌐 Iniciar Produção" "Gunicorn usando WSGI detectado" "$py -m gunicorn ${module}:application --bind 0.0.0.0:\${PORT}" "server"
        fi
    else
        local fastapi_module flask_module
        fastapi_module="$(detect_fastapi_module || true)"
        if [[ -n "$fastapi_module" ]]; then
            add_stack "FastAPI"
            PROJECT_KIND="API FastAPI"
            add_action "START_DEV" "🚀 Iniciar Desenvolvimento" "Uvicorn com reload" "$py -m uvicorn $fastapi_module --host 0.0.0.0 --port \${PORT} --reload" "server"
            add_action "START_PROD" "🌐 Iniciar Produção" "Uvicorn sem reload" "$py -m uvicorn $fastapi_module --host 0.0.0.0 --port \${PORT}" "server"
        else
            flask_module="$(detect_flask_module || true)"
            if [[ -n "$flask_module" ]]; then
                add_stack "Flask"
                PROJECT_KIND="Aplicação Flask"
                add_action "START_DEV" "🚀 Iniciar Desenvolvimento" "$flask_module detectado" "$py -m flask --app $flask_module run --host 0.0.0.0 --port \${PORT} --debug" "server"
                add_action "START_PROD" "🌐 Iniciar Produção" "$flask_module detectado" "$py -m flask --app $flask_module run --host 0.0.0.0 --port \${PORT}" "server"
            fi
        fi
        if grep -RqiE '(^|[<=>~ ])pytest([<=>~ ]|$)' "$PROJECT_DIR/requirements"*.txt "$PROJECT_DIR/pyproject.toml" 2>/dev/null || [[ -f "$PROJECT_DIR/pytest.ini" ]]; then
            add_action "TEST" "🧪 Executar Testes" "Testes Python com pytest" "$py -m pytest"
        fi
        if grep -qE '(^|[^A-Za-z])ruff([^A-Za-z]|$)' "$PROJECT_DIR/pyproject.toml" "$PROJECT_DIR/requirements"*.txt 2>/dev/null; then
            add_action "LINT" "🔎 Executar Lint" "Ruff check" "$py -m ruff check ."
            add_action "FORMAT" "✨ Formatar Código" "Ruff format" "$py -m ruff format ."
        fi
        if grep -qE '(^|[^A-Za-z])mypy([^A-Za-z]|$)' "$PROJECT_DIR/pyproject.toml" "$PROJECT_DIR/requirements"*.txt 2>/dev/null; then
            add_action "TYPECHECK" "🧬 Verificar Tipos" "Mypy" "$py -m mypy ."
        fi
    fi
    detect_python_ecosystem
}

detect_php_project() {
    [[ -f "$PROJECT_DIR/composer.json" ]] || return 0
    add_stack "PHP"
    add_manifest "$PROJECT_DIR/composer.json"
    [[ -f "$PROJECT_DIR/composer.lock" ]] && add_manifest "$PROJECT_DIR/composer.lock"
    PROJECT_KIND="Aplicação PHP"
    DEFAULT_PORT=8000
    require_runtime "php" "php-cli"
    require_runtime "composer" "composer"
    add_dependency_command "composer install --no-interaction --prefer-dist" "Dependências PHP via Composer"

    PROJECT_NAME="$(json_value "$PROJECT_DIR/composer.json" '.name')"; [[ -n "$PROJECT_NAME" ]] || PROJECT_NAME="$(basename "$PROJECT_DIR")"
    PROJECT_VERSION="$(json_value "$PROJECT_DIR/composer.json" '.version')"

    if [[ -f "$PROJECT_DIR/artisan" ]]; then
        add_stack "Laravel"
        PROJECT_KIND="Aplicação Laravel"
        add_action "START_DEV" "🚀 Iniciar Desenvolvimento" "Laravel artisan serve" "php artisan serve --host=0.0.0.0 --port=\${PORT}" "server"
        add_action "MIGRATE" "🗄 Aplicar Migrações" "Laravel migrate" "php artisan migrate --force"
        add_action "SEED" "🌱 Popular Banco" "Laravel db:seed" "php artisan db:seed --force"
        add_action "RESET_DB" "♻ Resetar Banco" "Laravel migrate:fresh" "php artisan migrate:fresh --force" "command" true
        add_action "TEST" "🧪 Executar Testes" "Laravel test" "php artisan test"
        add_action "CLEAR_CACHE" "🧹 Limpar Caches" "Laravel optimize:clear" "php artisan optimize:clear"
    fi

    local script
    for script in start dev build test lint analyse format; do
        if jq -e --arg key "$script" '.scripts[$key] != null' "$PROJECT_DIR/composer.json" >/dev/null 2>&1; then
            case "$script" in
                start) add_action "START_PROD" "🌐 Iniciar Produção" "Composer script start" "composer run-script start" "server" ;;
                dev) add_action "COMPOSER_DEV" "🧰 Ambiente de Desenvolvimento" "Composer script dev" "composer run-script dev" "server" ;;
                build) add_action "BUILD" "🏗 Construir Projeto" "Composer script build" "composer run-script build" ;;
                test) add_action "TEST" "🧪 Executar Testes" "Composer script test" "composer run-script test" ;;
                lint|analyse) add_action "LINT" "🔎 Analisar Código" "Composer script $script" "composer run-script $script" ;;
                format) add_action "FORMAT" "✨ Formatar Código" "Composer script format" "composer run-script format" ;;
            esac
        fi
    done
}

detect_ruby_project() {
    [[ -f "$PROJECT_DIR/Gemfile" ]] || return 0
    add_stack "Ruby"
    add_manifest "$PROJECT_DIR/Gemfile"
    [[ -f "$PROJECT_DIR/Gemfile.lock" ]] && add_manifest "$PROJECT_DIR/Gemfile.lock"
    PROJECT_KIND="Aplicação Ruby"
    DEFAULT_PORT=3000
    require_runtime "ruby" "ruby-full"
    require_runtime "bundle" "bundler"
    add_dependency_command "bundle install" "Dependências Ruby via Bundler"
    if [[ -f "$PROJECT_DIR/bin/rails" || -f "$PROJECT_DIR/config/application.rb" ]]; then
        add_stack "Rails"
        PROJECT_KIND="Aplicação Ruby on Rails"
        add_action "START_DEV" "🚀 Iniciar Desenvolvimento" "Rails server" "bundle exec rails server -b 0.0.0.0 -p \${PORT}" "server"
        add_action "MIGRATE" "🗄 Aplicar Migrações" "Rails db:migrate" "bundle exec rails db:migrate"
        add_action "SEED" "🌱 Popular Banco" "Rails db:seed" "bundle exec rails db:seed"
        add_action "RESET_DB" "♻ Resetar Banco" "Rails db:reset" "bundle exec rails db:reset" "command" true
        add_action "TEST" "🧪 Executar Testes" "Rails test" "bundle exec rails test"
    elif [[ -f "$PROJECT_DIR/Rakefile" ]]; then
        add_action "TEST" "🧪 Executar Testes" "Rake test" "bundle exec rake test"
    fi
}

detect_go_project() {
    [[ -f "$PROJECT_DIR/go.mod" ]] || return 0
    add_stack "Go"
    add_manifest "$PROJECT_DIR/go.mod"
    [[ -f "$PROJECT_DIR/go.sum" ]] && add_manifest "$PROJECT_DIR/go.sum"
    PROJECT_KIND="Projeto Go"
    DEFAULT_PORT=8080
    require_runtime "go" "golang-go"
    add_dependency_command "go mod download" "Módulos Go"

    local go_entry=""
    if grep -l '^package[[:space:]]\+main' "$PROJECT_DIR"/*.go 2>/dev/null | head -1 | grep -q .; then
        go_entry="."
    else
        local main_file
        main_file="$(find "$PROJECT_DIR/cmd" -maxdepth 3 -type f -name '*.go' -exec grep -l '^package[[:space:]]\+main' {} + 2>/dev/null | head -1)"
        [[ -n "$main_file" ]] && go_entry="./${main_file#"$PROJECT_DIR"/}" && go_entry="${go_entry%/*}"
    fi
    if [[ -n "$go_entry" ]]; then
        PROJECT_KIND="Aplicação Go"
        add_action "START_GO" "🚀 Iniciar Aplicação Go" "Entrypoint Go comprovado em $go_entry" "go run $(shell_quote "$go_entry")" "server"
    fi
    add_action "BUILD_GO" "🏗 Construir Projeto Go" "go build ./..." "go build ./..."
    add_action "TEST_GO" "🧪 Executar Testes Go" "go test ./..." "go test ./..."
    add_action "VET_GO" "🔎 Executar Go Vet" "go vet ./..." "go vet ./..."
    local module_name
    module_name="$(awk '$1=="module" {print $2; exit}' "$PROJECT_DIR/go.mod" 2>/dev/null)"
    [[ -n "$module_name" ]] && PROJECT_NAME="$module_name"
}

detect_rust_project() {
    [[ -f "$PROJECT_DIR/Cargo.toml" ]] || return 0
    add_stack "Rust"
    add_manifest "$PROJECT_DIR/Cargo.toml"
    [[ -f "$PROJECT_DIR/Cargo.lock" ]] && add_manifest "$PROJECT_DIR/Cargo.lock"
    PROJECT_KIND="Projeto Rust"
    DEFAULT_PORT=8080
    require_runtime "cargo" "__rustup__"
    require_runtime "rustc" "__rustup__"
    add_dependency_command "cargo fetch --locked || cargo fetch" "Crates Rust"
    if [[ -f "$PROJECT_DIR/src/main.rs" ]] || grep -q '^\[\[bin\]\]' "$PROJECT_DIR/Cargo.toml"; then
        PROJECT_KIND="Aplicação Rust"
        add_action "START_RUST" "🚀 Iniciar Aplicação Rust" "Binário Rust comprovado" "cargo run" "server"
    fi
    add_action "BUILD_RUST" "🏗 Construir Projeto Rust" "cargo build" "cargo build"
    add_action "BUILD_RUST_RELEASE" "📦 Build Rust Release" "cargo build --release" "cargo build --release"
    add_action "TEST_RUST" "🧪 Executar Testes Rust" "cargo test" "cargo test"
    add_action "CLIPPY_RUST" "🔎 Executar Clippy" "cargo clippy" "cargo clippy --all-targets --all-features -- -D warnings"
    add_action "FORMAT_RUST" "✨ Formatar Rust" "cargo fmt" "cargo fmt --all"
    local n v
    n="$(awk -F'=' '/^[[:space:]]*name[[:space:]]*=/{gsub(/[ "\047]/,"",$2); print $2; exit}' "$PROJECT_DIR/Cargo.toml")"
    v="$(awk -F'=' '/^[[:space:]]*version[[:space:]]*=/{gsub(/[ "\047]/,"",$2); print $2; exit}' "$PROJECT_DIR/Cargo.toml")"
    [[ -n "$n" ]] && PROJECT_NAME="$n"; PROJECT_VERSION="$v"
}

detect_dotnet_project() {
    local solution project_file run_project
    solution="$(find "$PROJECT_DIR" -maxdepth 2 -type f -name '*.sln' | head -1)"
    project_file="$(find "$PROJECT_DIR" -maxdepth 3 -type f \( -name '*.csproj' -o -name '*.fsproj' \) | head -1)"
    [[ -n "$solution" || -n "$project_file" ]] || return 0
    add_stack ".NET"
    [[ -n "$solution" ]] && add_manifest "$solution"
    while IFS= read -r pf; do add_manifest "$pf"; done < <(find "$PROJECT_DIR" -maxdepth 3 -type f \( -name '*.csproj' -o -name '*.fsproj' \))
    PROJECT_KIND="Projeto .NET"
    DEFAULT_PORT=5000
    require_runtime "dotnet" "__dotnet__"
    add_dependency_command "dotnet restore" "Pacotes NuGet"
    add_action "BUILD_DOTNET" "🏗 Construir .NET" "dotnet build" "dotnet build --no-restore"
    if find "$PROJECT_DIR" -maxdepth 4 -type f \( -name '*Tests.csproj' -o -name '*Test.csproj' -o -name '*Tests.fsproj' \) | grep -q .; then
        add_action "TEST_DOTNET" "🧪 Executar Testes .NET" "Projetos de teste detectados" "dotnet test --no-restore"
    fi
    if [[ -n "$project_file" ]]; then
        if grep -qE 'Microsoft\.NET\.Sdk\.Web|<OutputType>[[:space:]]*(Exe|WinExe)' "$project_file" || [[ -f "$(dirname "$project_file")/Properties/launchSettings.json" ]]; then
            run_project="$(project_relative "$project_file")"
            PROJECT_KIND="Aplicação .NET"
            add_action "START_DOTNET" "🚀 Iniciar Aplicação .NET" "Projeto executável: $run_project" "dotnet run --project $(shell_quote "$run_project") --no-restore --urls http://0.0.0.0:\${PORT}" "server"
        fi
        PROJECT_NAME="$(basename "$project_file")"; PROJECT_NAME="${PROJECT_NAME%.*}"
    elif [[ -n "$solution" ]]; then
        PROJECT_NAME="$(basename "$solution")"; PROJECT_NAME="${PROJECT_NAME%.*}"
    fi
    if find "$PROJECT_DIR" -maxdepth 4 -type f -name '*.csproj' -exec grep -l 'Microsoft.EntityFrameworkCore' {} + 2>/dev/null | grep -q .; then
        add_stack "Entity Framework Core"
        if find "$PROJECT_DIR" -maxdepth 5 -type d -name Migrations | grep -q .; then
            add_action "EF_MIGRATE" "🗄 Aplicar Migrações EF" "Migrations do Entity Framework detectadas" "dotnet ef database update"
        fi
    fi
    command_exists dotnet && dotnet format --help >/dev/null 2>&1 && add_action "FORMAT_DOTNET" "✨ Formatar .NET" "dotnet format disponível" "dotnet format"
}

detect_java_project() {
    if [[ -f "$PROJECT_DIR/gradlew" || -f "$PROJECT_DIR/build.gradle" || -f "$PROJECT_DIR/build.gradle.kts" ]]; then
        add_stack "Gradle"
        PROJECT_KIND="Aplicação Java/Kotlin Gradle"
        DEFAULT_PORT=8080
        [[ -f "$PROJECT_DIR/build.gradle" ]] && add_manifest "$PROJECT_DIR/build.gradle"
        [[ -f "$PROJECT_DIR/build.gradle.kts" ]] && add_manifest "$PROJECT_DIR/build.gradle.kts"
        [[ -f "$PROJECT_DIR/gradle/wrapper/gradle-wrapper.properties" ]] && add_manifest "$PROJECT_DIR/gradle/wrapper/gradle-wrapper.properties"
        require_runtime "java" "default-jdk"
        local gradle_cmd="gradle"
        if [[ -f "$PROJECT_DIR/gradlew" ]]; then chmod +x "$PROJECT_DIR/gradlew" 2>/dev/null || true; gradle_cmd="./gradlew"; else require_runtime "gradle" "gradle"; fi
        add_dependency_command "$gradle_cmd dependencies" "Dependências Gradle"
        if grep -Rqs 'org.springframework.boot\|spring-boot' "$PROJECT_DIR/build.gradle" "$PROJECT_DIR/build.gradle.kts" "$PROJECT_DIR/gradle" 2>/dev/null; then
            add_stack "Spring Boot"
            add_action "START_DEV" "🚀 Iniciar Aplicação" "Spring Boot via Gradle" "$gradle_cmd bootRun --args='--server.port=\${PORT}'" "server"
        fi
        add_action "BUILD" "🏗 Construir Projeto" "Gradle build" "$gradle_cmd build"
        add_action "TEST" "🧪 Executar Testes" "Gradle test" "$gradle_cmd test"
    elif [[ -f "$PROJECT_DIR/pom.xml" || -f "$PROJECT_DIR/mvnw" ]]; then
        add_stack "Maven"
        add_manifest "$PROJECT_DIR/pom.xml"
        PROJECT_KIND="Aplicação Java/Kotlin Maven"
        DEFAULT_PORT=8080
        require_runtime "java" "default-jdk"
        local mvn_cmd="mvn"
        if [[ -f "$PROJECT_DIR/mvnw" ]]; then chmod +x "$PROJECT_DIR/mvnw" 2>/dev/null || true; mvn_cmd="./mvnw"; else require_runtime "mvn" "maven"; fi
        add_dependency_command "$mvn_cmd -q -DskipTests dependency:go-offline" "Dependências Maven"
        if grep -qs 'spring-boot' "$PROJECT_DIR/pom.xml"; then
            add_stack "Spring Boot"
            add_action "START_DEV" "🚀 Iniciar Aplicação" "Spring Boot via Maven" "$mvn_cmd spring-boot:run -Dspring-boot.run.arguments=--server.port=\${PORT}" "server"
        fi
        add_action "BUILD" "🏗 Construir Projeto" "Maven package" "$mvn_cmd package"
        add_action "TEST" "🧪 Executar Testes" "Maven test" "$mvn_cmd test"
    fi
}

detect_flutter_dart_project() {
    [[ -f "$PROJECT_DIR/pubspec.yaml" ]] || return 0
    add_manifest "$PROJECT_DIR/pubspec.yaml"
    [[ -f "$PROJECT_DIR/pubspec.lock" ]] && add_manifest "$PROJECT_DIR/pubspec.lock"

    local is_flutter=false
    grep -qE '^[[:space:]]*flutter:[[:space:]]*$|sdk:[[:space:]]*flutter' "$PROJECT_DIR/pubspec.yaml" && is_flutter=true
    if $is_flutter; then
        add_stack "Dart"
        add_stack "Flutter"
        PROJECT_KIND="Aplicação Flutter"
        DEFAULT_PORT=8080
        require_runtime "flutter" "__flutter__"
        add_dependency_command "flutter pub get" "Dependências Flutter/Dart"
        add_action "FLUTTER_DOCTOR" "🩺 Flutter Doctor" "Validar SDK, dispositivos e toolchains" "flutter doctor -v"
        add_action "FLUTTER_ANALYZE" "🔎 Analisar Flutter" "Executar análise estática" "flutter analyze"
        [[ -d "$PROJECT_DIR/test" ]] && add_action "FLUTTER_TEST" "🧪 Testes Flutter" "Executar testes Flutter" "flutter test"
        if [[ -d "$PROJECT_DIR/web" && -f "$PROJECT_DIR/web/index.html" ]]; then
            add_action "FLUTTER_WEB" "🌐 Iniciar Flutter Web" "Executar no dispositivo web-server" "flutter run -d web-server --web-hostname 0.0.0.0 --web-port \${PORT}" "server"
            add_action "FLUTTER_BUILD_WEB" "📦 Build Flutter Web" "Gerar build web" "flutter build web"
        fi
        if [[ -d "$PROJECT_DIR/android" ]]; then
            add_stack "Android"
            add_action "FLUTTER_BUILD_APK" "📱 Build APK" "Gerar APK Flutter" "flutter build apk"
            add_action "FLUTTER_BUILD_AAB" "📦 Build Android App Bundle" "Gerar AAB Flutter" "flutter build appbundle"
        fi
        [[ -d "$PROJECT_DIR/ios" ]] && add_stack "iOS (build exige macOS)"
    else
        add_stack "Dart"
        PROJECT_KIND="Aplicação Dart"
        DEFAULT_PORT=8080
        require_runtime "dart" "__dart__"
        add_dependency_command "dart pub get" "Dependências Dart"
        add_action "DART_ANALYZE" "🔎 Analisar Dart" "Executar dart analyze" "dart analyze"
        [[ -d "$PROJECT_DIR/test" ]] && add_action "DART_TEST" "🧪 Testes Dart" "Executar dart test" "dart test"
        local dart_entry
        dart_entry="$(find "$PROJECT_DIR/bin" -maxdepth 1 -type f -name '*.dart' 2>/dev/null | head -1)"
        if [[ -n "$dart_entry" ]]; then
            add_action "DART_RUN" "▶ Executar Dart" "Executar $(project_relative "$dart_entry")" "dart run $(shell_quote "$(project_relative "$dart_entry")")"
        fi
    fi
}

detect_conda_project() {
    local env_file=""
    [[ -f "$PROJECT_DIR/environment.yml" ]] && env_file="environment.yml"
    [[ -z "$env_file" && -f "$PROJECT_DIR/environment.yaml" ]] && env_file="environment.yaml"
    [[ -z "$env_file" && -f "$PROJECT_DIR/conda-lock.yml" ]] && env_file="conda-lock.yml"
    [[ -n "$env_file" ]] || return 0
    add_stack "Conda/Mamba"
    add_manifest "$PROJECT_DIR/$env_file"
    require_runtime "micromamba" "__micromamba__"
    local env_dir=".orchestrator/conda-env"
    if [[ "$env_file" == "conda-lock.yml" ]]; then
        add_dependency_command "micromamba create -y -p $(shell_quote "$env_dir") -f $(shell_quote "$env_file") || micromamba update -y -p $(shell_quote "$env_dir") -f $(shell_quote "$env_file")" "Ambiente Conda bloqueado"
    else
        add_dependency_command "if [[ -x $(shell_quote "$env_dir/bin/python") ]]; then micromamba update -y -p $(shell_quote "$env_dir") -f $(shell_quote "$env_file"); else micromamba create -y -p $(shell_quote "$env_dir") -f $(shell_quote "$env_file"); fi" "Ambiente Conda/Mamba"
    fi
}

detect_r_project() {
    local found=false
    [[ -f "$PROJECT_DIR/renv.lock" ]] && { add_manifest "$PROJECT_DIR/renv.lock"; found=true; }
    [[ -f "$PROJECT_DIR/DESCRIPTION" ]] && { add_manifest "$PROJECT_DIR/DESCRIPTION"; found=true; }
    find "$PROJECT_DIR" -maxdepth 1 -type f -name '*.Rproj' -print -quit | grep -q . && found=true
    $found || return 0
    add_stack "R"
    PROJECT_KIND="Projeto R"
    DEFAULT_PORT=3838
    require_runtime "Rscript" "r-base"
    if [[ -f "$PROJECT_DIR/renv.lock" ]]; then
        add_dependency_command "Rscript -e \"if (!requireNamespace('renv', quietly=TRUE)) install.packages('renv', repos='https://cloud.r-project.org'); renv::restore(prompt=FALSE)\"" "Dependências R via renv"
    elif [[ -f "$PROJECT_DIR/DESCRIPTION" ]]; then
        add_dependency_command "Rscript -e \"if (!requireNamespace('remotes', quietly=TRUE)) install.packages('remotes', repos='https://cloud.r-project.org'); remotes::install_deps(dependencies=TRUE, upgrade='never')\"" "Dependências R do DESCRIPTION"
    fi
    [[ -d "$PROJECT_DIR/tests/testthat" ]] && add_action "R_TEST" "🧪 Testes R" "Executar testthat" "Rscript -e \"testthat::test_dir('tests/testthat')\""
    if [[ -f "$PROJECT_DIR/app.R" ]]; then
        add_stack "Shiny"
        add_action "SHINY" "📊 Iniciar Shiny" "app.R detectado" "Rscript -e \"shiny::runApp('.', host='0.0.0.0', port=as.integer(Sys.getenv('PORT')))\"" "server"
    elif [[ -f "$PROJECT_DIR/ui.R" && -f "$PROJECT_DIR/server.R" ]]; then
        add_stack "Shiny"
        add_action "SHINY" "📊 Iniciar Shiny" "ui.R e server.R detectados" "Rscript -e \"shiny::runApp('.', host='0.0.0.0', port=as.integer(Sys.getenv('PORT')))\"" "server"
    fi
}

detect_julia_project() {
    [[ -f "$PROJECT_DIR/Project.toml" ]] || return 0
    add_stack "Julia"
    add_manifest "$PROJECT_DIR/Project.toml"
    [[ -f "$PROJECT_DIR/Manifest.toml" ]] && add_manifest "$PROJECT_DIR/Manifest.toml"
    PROJECT_KIND="Projeto Julia"
    DEFAULT_PORT=8000
    require_runtime "julia" "julia"
    add_dependency_command "julia --project=. -e 'using Pkg; Pkg.instantiate()'" "Dependências Julia"
    [[ -f "$PROJECT_DIR/test/runtests.jl" ]] && add_action "JULIA_TEST" "🧪 Testes Julia" "Executar Pkg.test" "julia --project=. -e 'using Pkg; Pkg.test()'"
    if [[ -f "$PROJECT_DIR/src/main.jl" ]]; then
        add_action "JULIA_RUN" "▶ Executar Julia" "src/main.jl detectado" "julia --project=. src/main.jl"
    fi
}

detect_quality_configs() {
    if [[ -f "$PROJECT_DIR/pytest.ini" || -f "$PROJECT_DIR/tox.ini" ]]; then add_stack "Pytest"; fi
    [[ -f "$PROJECT_DIR/playwright.config.ts" || -f "$PROJECT_DIR/playwright.config.js" || -f "$PROJECT_DIR/playwright.config.mjs" ]] && add_stack "Playwright"
    [[ -f "$PROJECT_DIR/cypress.config.ts" || -f "$PROJECT_DIR/cypress.config.js" ]] && add_stack "Cypress"
    [[ -f "$PROJECT_DIR/.pre-commit-config.yaml" ]] && {
        add_stack "pre-commit"
        if command_exists pre-commit || python_dependency_declared '(^|[^A-Za-z0-9_-])pre-commit([^A-Za-z0-9_-]|$)'; then
            add_action "PRE_COMMIT" "✅ Executar pre-commit" "Configuração pre-commit detectada" "pre-commit run --all-files"
        fi
    }
}

detect_docker_project() {
    local compose_file="" candidate
    for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
        [[ -f "$PROJECT_DIR/$candidate" ]] && { compose_file="$candidate"; break; }
    done
    [[ -n "$compose_file" || -f "$PROJECT_DIR/Dockerfile" ]] || return 0
    add_stack "Docker"
    [[ -n "$compose_file" ]] && add_manifest "$PROJECT_DIR/$compose_file"
    [[ -f "$PROJECT_DIR/Dockerfile" ]] && add_manifest "$PROJECT_DIR/Dockerfile"
    require_runtime "docker" "docker.io"
    if [[ -n "$compose_file" ]]; then
        if command_exists docker && docker compose version >/dev/null 2>&1; then
            DOCKER_COMPOSE_CMD="docker compose"
        elif command_exists docker-compose; then
            DOCKER_COMPOSE_CMD="docker-compose"
        else
            DOCKER_COMPOSE_CMD="docker compose"
            require_runtime "docker-compose" "docker-compose-v2"
        fi
        add_action "DOCKER_UP" "🐳 Subir Containers" "$DOCKER_COMPOSE_CMD up" "$DOCKER_COMPOSE_CMD -f $(shell_quote "$compose_file") up" "server"
        add_action "DOCKER_UP_BUILD" "🧱 Construir e Subir" "$DOCKER_COMPOSE_CMD up --build" "$DOCKER_COMPOSE_CMD -f $(shell_quote "$compose_file") up --build" "server"
        add_action "DOCKER_BUILD" "📦 Construir Imagens" "$DOCKER_COMPOSE_CMD build" "$DOCKER_COMPOSE_CMD -f $(shell_quote "$compose_file") build"
        add_action "DOCKER_DOWN" "🛑 Derrubar Containers" "$DOCKER_COMPOSE_CMD down" "$DOCKER_COMPOSE_CMD -f $(shell_quote "$compose_file") down"
        add_action "DOCKER_TEST_CONFIG" "✅ Validar Compose" "$DOCKER_COMPOSE_CMD config" "$DOCKER_COMPOSE_CMD -f $(shell_quote "$compose_file") config --quiet"
    elif [[ -f "$PROJECT_DIR/Dockerfile" ]]; then
        local image_name
        image_name="$(basename "$PROJECT_DIR" | tr '[:upper:] _' '[:lower:]--' | tr -cd 'a-z0-9._-')"
        [[ -n "$image_name" ]] || image_name="project-image"
        add_action "DOCKER_BUILD" "📦 Construir Imagem" "Dockerfile detectado" "docker build -t $(shell_quote "$image_name") ."
    fi
}

detect_make_tasks() {
    [[ -f "$PROJECT_DIR/Makefile" ]] || return 0
    add_manifest "$PROJECT_DIR/Makefile"
    local targets
    targets="$(awk -F: '/^[A-Za-z0-9][A-Za-z0-9_.-]*:([^=]|$)/ && $0 !~ /:=/{print $1}' "$PROJECT_DIR/Makefile" | sort -u)"
    local target
    for target in dev start run serve build test lint format check migrate seed reset; do
        grep -qx "$target" <<< "$targets" || continue
        case "$target" in
            dev|start|run|serve) add_action "MAKE_${target^^}" "🛠 Make $target" "Target $target do Makefile" "make $target" "server" ;;
            build) add_action "BUILD" "🏗 Construir Projeto" "Target build do Makefile" "make build" ;;
            test) add_action "TEST" "🧪 Executar Testes" "Target test do Makefile" "make test" ;;
            lint) add_action "LINT" "🔎 Executar Lint" "Target lint do Makefile" "make lint" ;;
            format) add_action "FORMAT" "✨ Formatar Código" "Target format do Makefile" "make format" ;;
            check) add_action "CHECK" "✅ Executar Verificações" "Target check do Makefile" "make check" ;;
            migrate) add_action "MIGRATE" "🗄 Aplicar Migrações" "Target migrate do Makefile" "make migrate" ;;
            seed) add_action "SEED" "🌱 Popular Banco" "Target seed do Makefile" "make seed" ;;
            reset) add_action "RESET" "♻ Executar Reset" "Target reset do Makefile" "make reset" "command" true ;;
        esac
    done
}

detect_preferred_port() {
    $PORT_EXPLICIT && return 0
    local candidate="" file
    for file in .env.local .env.development .env.dev .env; do
        [[ -f "$PROJECT_DIR/$file" ]] || continue
        candidate="$(grep -E '^[[:space:]]*(PORT|SERVER_PORT|APP_PORT)[[:space:]]*=' "$PROJECT_DIR/$file" | tail -1 | cut -d= -f2- | tr -d '\r"\047 ' || true)"
        validate_port "$candidate" && { PORT="$candidate"; return 0; }
    done
    if [[ -f "$PROJECT_DIR/package.json" ]]; then
        candidate="$(jq -r '.scripts // {} | to_entries[] | .value' "$PROJECT_DIR/package.json" 2>/dev/null | grep -Eo -- '(^|[[:space:]])(--port|-p)[=[:space:]]+[0-9]{2,5}' | grep -Eo '[0-9]{2,5}' | head -1 || true)"
        validate_port "$candidate" && { PORT="$candidate"; return 0; }
    fi
    local launch
    launch="$(find "$PROJECT_DIR" -maxdepth 5 -type f -path '*/Properties/launchSettings.json' | head -1)"
    if [[ -n "$launch" ]]; then
        candidate="$(jq -r '.. | .applicationUrl? // empty' "$launch" 2>/dev/null | grep -Eo 'https?://[^:]+:[0-9]+' | grep -Eo '[0-9]+$' | head -1 || true)"
        validate_port "$candidate" && { PORT="$candidate"; return 0; }
    fi
    local compose
    for compose in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
        [[ -f "$PROJECT_DIR/$compose" ]] || continue
        candidate="$(grep -Eo '["\047]?[0-9]{2,5}:[0-9]{2,5}["\047]?' "$PROJECT_DIR/$compose" | head -1 | grep -Eo '^["\047]?[0-9]+' | tr -d '"\047' || true)"
        validate_port "$candidate" && { PORT="$candidate"; return 0; }
    done
    return 0
}

component_manifest_summary() {
    local dir="$1" names=() file
    for file in package.json pyproject.toml requirements.txt Pipfile manage.py composer.json Gemfile go.mod Cargo.toml pubspec.yaml pom.xml build.gradle build.gradle.kts environment.yml environment.yaml renv.lock Project.toml compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
        [[ -f "$dir/$file" ]] && names+=("$file")
    done
    while IFS= read -r file; do
        [[ -n "$file" ]] && names+=("$file")
    done < <(find "$dir" -maxdepth 1 -type f \( -name '*.csproj' -o -name '*.fsproj' -o -name '*.sln' \) -printf '%f\n' 2>/dev/null | sort)
    join_by ', ' "${names[@]}"
}

root_node_uses_workspaces() {
    [[ -f "$PROJECT_DIR/package.json" ]] || return 1
    jq -e '(.workspaces | type == "array" and length > 0) or (.workspaces.packages | type == "array" and length > 0)' "$PROJECT_DIR/package.json" >/dev/null 2>&1
}

detect_workspace_components() {
    [[ "$COMPONENT_MODE" == "1" ]] && return 0
    local max_components="${ORCH_MAX_COMPONENTS:-30}"
    [[ "$max_components" =~ ^[0-9]+$ ]] || max_components=30
    (( max_components < 1 )) && return 0

    local root_has_node_workspaces=false
    root_node_uses_workspaces && root_has_node_workspaces=true

    local manifest dir rel summary existing duplicate count=0
    while IFS= read -r -d '' manifest; do
        dir="$(dirname "$manifest")"
        [[ "$dir" == "$PROJECT_DIR" ]] && continue
        rel="${dir#"$PROJECT_DIR"/}"
        case "/$rel/" in
            */.git/*|*/node_modules/*|*/.venv/*|*/venv/*|*/vendor/*|*/dist/*|*/build/*|*/target/*|*/coverage/*|*/.orchestrator/*|*/__pycache__/*) continue ;;
        esac

        if $root_has_node_workspaces && [[ "$(basename "$manifest")" == "package.json" ]]; then
            local has_other=false other
            for other in pyproject.toml requirements.txt Pipfile manage.py composer.json Gemfile go.mod Cargo.toml pubspec.yaml pom.xml build.gradle build.gradle.kts environment.yml environment.yaml renv.lock Project.toml compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
                [[ -f "$dir/$other" ]] && has_other=true
            done
            $has_other || continue
        fi

        duplicate=false
        for existing in "${COMPONENT_DIRS[@]}"; do
            [[ "$existing" == "$dir" ]] && { duplicate=true; break; }
        done
        $duplicate && continue

        summary="$(component_manifest_summary "$dir")"
        [[ -n "$summary" ]] || continue
        COMPONENT_DIRS+=("$dir")
        COMPONENT_DESCRIPTIONS+=("$summary")
        add_action "COMPONENT_$((count+1))" "🧩 Gerenciar $(basename "$dir")" "$rel — $summary" "$dir" "subproject"
        ((count++))
        ((count >= max_components)) && break
    done < <(find "$PROJECT_DIR" -mindepth 2 -maxdepth 6 -type f \
        \( -name package.json -o -name pyproject.toml -o -name requirements.txt -o -name Pipfile -o -name manage.py \
           -o -name composer.json -o -name Gemfile -o -name go.mod -o -name Cargo.toml -o -name pubspec.yaml \
           -o -name pom.xml -o -name build.gradle -o -name build.gradle.kts -o -name environment.yml -o -name environment.yaml \
           -o -name renv.lock -o -name Project.toml -o -name compose.yaml -o -name compose.yml \
           -o -name docker-compose.yaml -o -name docker-compose.yml -o -name '*.csproj' -o -name '*.fsproj' -o -name '*.sln' \) \
        -not -path '*/.git/*' -not -path '*/node_modules/*' -not -path '*/.venv/*' -not -path '*/venv/*' \
        -not -path '*/vendor/*' -not -path '*/dist/*' -not -path '*/build/*' -not -path '*/target/*' \
        -not -path '*/coverage/*' -not -path '*/.orchestrator/*' -print0 2>/dev/null)

    ((${#COMPONENT_DIRS[@]} > 0)) && add_stack "Workspace (${#COMPONENT_DIRS[@]} componentes)"
}

bootstrap_workspace_components() {
    [[ "$COMPONENT_MODE" == "1" || "$NO_BOOTSTRAP" == true ]] && return 0
    ((${#COMPONENT_DIRS[@]} > 0)) || return 0

    local dir rel args=(--bootstrap-only)
    $DRY_RUN && args+=(--dry-run)
    for dir in "${COMPONENT_DIRS[@]}"; do
        rel="${dir#"$PROJECT_DIR"/}"
        plain_info "Preparando componente: $rel"
        ORCH_PROJECT_DIR="$dir" ORCH_COMPONENT_MODE=1 bash "$SCRIPT_FILE" "${args[@]}" || {
            plain_err "O bootstrap do componente $rel falhou."
            return 1
        }
    done
}

open_subproject_tui() {
    local dir="$1" rel="${1#"$PROJECT_DIR"/}"
    [[ -d "$dir" ]] || { LAST_STATUS="err"; LAST_MSG="Componente não existe mais: $rel"; return 1; }

    if $NON_INTERACTIVE; then
        ORCH_PROJECT_DIR="$dir" ORCH_COMPONENT_MODE=1 bash "$SCRIPT_FILE" --no-bootstrap --list-actions
        return $?
    fi

    if $IN_ALT_SCREEN; then printf '\033[?1049l'; cursor_show; IN_ALT_SCREEN=false; fi
    ORCH_PROJECT_DIR="$dir" ORCH_COMPONENT_MODE=1 bash "$SCRIPT_FILE"
    local code=$?
    printf '\033[?1049h'; cursor_hide; IN_ALT_SCREEN=true; NEED_REPAINT=true
    if (( code == 0 )); then LAST_STATUS="ok"; else LAST_STATUS="err"; fi
    LAST_MSG="Componente $rel encerrado com código $code."
    return "$code"
}

detect_project() {
    $PORT_EXPLICIT || PORT=""
    STACKS=(); MANIFESTS=(); DEPENDENCY_COMMANDS=(); DEPENDENCY_DESCRIPTIONS=()
    REQUIRED_RUNTIME_COMMANDS=(); REQUIRED_RUNTIME_PACKAGES=()
    ACTION_IDS=(); ACTION_LABELS=(); ACTION_DESCS=(); ACTION_CMDS=(); ACTION_KINDS=(); ACTION_CONFIRMS=()
    COMPONENT_DIRS=(); COMPONENT_DESCRIPTIONS=()
    PACKAGE_MANAGER=""; NODE_PACKAGE_MANAGER=""; PYTHON_PACKAGE_MANAGER=""; NODE_DECLARED_PACKAGE_MANAGER=""; PROJECT_VERSION=""; PROJECT_NAME="$(basename "$PROJECT_DIR")"; PROJECT_KIND="Projeto"; DEFAULT_PORT=8000

    detect_node_project
    detect_python_project
    detect_php_project
    detect_ruby_project
    detect_go_project
    detect_rust_project
    detect_dotnet_project
    detect_java_project
    detect_flutter_dart_project
    detect_conda_project
    detect_r_project
    detect_julia_project
    detect_docker_project
    detect_make_tasks
    detect_quality_configs
    detect_workspace_components

    detect_preferred_port
    [[ -n "$PORT" ]] || PORT="$DEFAULT_PORT"

    RUNTIME_SUMMARY="$(join_by ', ' "${STACKS[@]}")"
    [[ -n "$RUNTIME_SUMMARY" ]] || RUNTIME_SUMMARY="Nenhuma stack reconhecida"

    local i
    for i in "${!DEPENDENCY_COMMANDS[@]}"; do
        add_action "INSTALL_DEPS_$i" "📦 Instalar Dependências" "${DEPENDENCY_DESCRIPTIONS[$i]}" "${DEPENDENCY_COMMANDS[$i]}"
    done
    if [[ -n "$NODE_PACKAGE_MANAGER" ]]; then
        case "$NODE_PACKAGE_MANAGER" in
            pnpm) add_action "CHECK_NODE_DEPS" "🧩 Validar Dependências Node" "Verificar árvore instalada" "pnpm list --depth 0" ;;
            yarn) add_action "CHECK_NODE_DEPS" "🧩 Validar Dependências Node" "Verificar árvore instalada" "yarn list --depth=0" ;;
            bun)  add_action "CHECK_NODE_DEPS" "🧩 Validar Dependências Node" "Verificar árvore instalada" "bun pm ls" ;;
            npm|*) add_action "CHECK_NODE_DEPS" "🧩 Validar Dependências Node" "Verificar árvore instalada" "npm ls --depth=0" ;;
        esac
    fi
    if [[ -n "$PYTHON_PACKAGE_MANAGER" ]]; then
        add_action "CHECK_PY_IMPORTS" "🧩 Validar Imports Python" "Analisar imports reais sem adivinhar pacotes" "" "python_imports"
        local py_check
        py_check="$(python_executable)"
        add_action "CHECK_PY_DEPS" "🔗 Validar Dependências Python" "Executar pip check no ambiente ativo" "$py_check -m pip check"
    fi

    refresh_server_state
    if $APP_ACTIVE; then
        add_action "STOP" "🛑 Encerrar Servidor" "Encerrar somente o processo iniciado por este orquestrador" "" "stop"
    fi
    add_action "HEALTH" "🏥 Saúde do Projeto" "Validar ferramentas, manifestos, dependências e servidor" "" "health"
    add_action "LOGS" "📜 Visualizar Logs" "Abrir histórico do orquestrador" "" "logs"
    add_action "REFRESH" "🔄 Redetectar Projeto" "Reanalisar arquivos e atualizar o menu" "" "refresh"
    add_action "EXIT" "🚪 Sair" "Encerrar o orquestrador" "" "exit"

    {
        printf 'PROJECT_NAME=%q\n' "$PROJECT_NAME"
        printf 'PROJECT_VERSION=%q\n' "$PROJECT_VERSION"
        printf 'PROJECT_KIND=%q\n' "$PROJECT_KIND"
        printf 'STACKS=%q\n' "$RUNTIME_SUMMARY"
        PACKAGE_MANAGER="$(join_by ', ' "${NODE_PACKAGE_MANAGER:+Node:$NODE_PACKAGE_MANAGER}" "${PYTHON_PACKAGE_MANAGER:+Python:$PYTHON_PACKAGE_MANAGER}")"
        printf 'PACKAGE_MANAGER=%q\n' "$PACKAGE_MANAGER"
        printf 'PORT=%q\n' "$PORT"
        printf 'DETECTED_AT=%q\n' "$(now_ts)"
    } > "$DETECTION_FILE"
}

# ──────────────────────────────────────────────────────────────────────────────
# Instalação dos runtimes e dependências do projeto
# ──────────────────────────────────────────────────────────────────────────────
detect_dotnet_channel() {
    local tfm
    tfm="$(grep -RhoE '<TargetFrameworks?>[^<]+' "$PROJECT_DIR"/*.csproj "$PROJECT_DIR"/*/*.csproj 2>/dev/null | head -1 | sed -E 's/.*>//; s/;.*//')"
    if [[ "$tfm" =~ ^net([0-9]+) ]]; then
        printf '%s.0' "${BASH_REMATCH[1]}"
    else
        printf 'LTS'
    fi
}

install_special_runtime() {
    local package="$1"
    case "$package" in
        __dotnet__)
            local channel install_dir="$HOME/.dotnet"
            channel="$(detect_dotnet_channel)"
            if $DRY_RUN; then
                plain_info "[dry-run] instalar .NET SDK canal $channel em $install_dir pelo dotnet-install.sh oficial"
            else
                mkdir -p "$install_dir"
                local script
                script="$(mktemp)"
                curl -fsSL https://dot.net/v1/dotnet-install.sh -o "$script"
                bash "$script" --channel "$channel" --install-dir "$install_dir" --no-path
                rm -f "$script"
                export DOTNET_ROOT="$install_dir"
                export PATH="$install_dir:$PATH"
            fi
            ;;
        __rustup__)
            if $DRY_RUN; then
                plain_info "[dry-run] curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal"
            else
                curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
                export PATH="$HOME/.cargo/bin:$PATH"
            fi
            ;;
        __flutter__)
            local flutter_dir="$HOME/.local/share/flutter"
            if $DRY_RUN; then
                plain_info "[dry-run] git clone --depth 1 --branch stable https://github.com/flutter/flutter.git $flutter_dir"
            else
                mkdir -p "$(dirname "$flutter_dir")"
                if [[ -d "$flutter_dir/.git" ]]; then
                    git -C "$flutter_dir" fetch --depth 1 origin stable
                    git -C "$flutter_dir" checkout -f stable
                    git -C "$flutter_dir" reset --hard origin/stable
                else
                    rm -rf "$flutter_dir"
                    git clone --depth 1 --branch stable https://github.com/flutter/flutter.git "$flutter_dir"
                fi
                export PATH="$flutter_dir/bin:$PATH"
                flutter config --no-analytics >/dev/null 2>&1 || true
            fi
            ;;
        __dart__)
            local dart_root="$HOME/.local/share/dart-sdk"
            if $DRY_RUN; then
                plain_info "[dry-run] baixar Dart SDK estável oficial para $dart_root"
            else
                local version_json version zip tmp
                version_json="$(curl -fsSL https://storage.googleapis.com/dart-archive/channels/stable/release/latest/VERSION)"
                version="$(jq -r '.version' <<< "$version_json")"
                [[ -n "$version" && "$version" != "null" ]] || { plain_err "Não foi possível determinar a versão estável do Dart."; return 1; }
                tmp="$(mktemp -d)"; zip="$tmp/dart.zip"
                curl -fL "https://storage.googleapis.com/dart-archive/channels/stable/release/$version/sdk/dartsdk-linux-x64-release.zip" -o "$zip"
                rm -rf "$dart_root"
                unzip -q "$zip" -d "$(dirname "$dart_root")"
                rm -rf "$tmp"
                export PATH="$dart_root/bin:$PATH"
            fi
            ;;
        __micromamba__)
            if $DRY_RUN; then
                plain_info "[dry-run] instalar micromamba oficial em $HOME/.local/bin/micromamba"
            else
                mkdir -p "$HOME/.local/bin"
                local tmp
                tmp="$(mktemp -d)"
                curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj -C "$tmp" bin/micromamba
                install -m 0755 "$tmp/bin/micromamba" "$HOME/.local/bin/micromamba"
                rm -rf "$tmp"
                export PATH="$HOME/.local/bin:$PATH"
            fi
            ;;
        *) plain_err "Instalador especial desconhecido: $package"; return 1 ;;
    esac
}

ensure_runtime_dependencies() {
    $NO_BOOTSTRAP && return 0
    local missing_packages=() special_packages=() i cmd pkg
    for i in "${!REQUIRED_RUNTIME_COMMANDS[@]}"; do
        cmd="${REQUIRED_RUNTIME_COMMANDS[$i]}"; pkg="${REQUIRED_RUNTIME_PACKAGES[$i]}"
        command_exists "$cmd" && continue
        if [[ "$pkg" == __*__ ]]; then special_packages+=("$pkg")
        else missing_packages+=("$pkg")
        fi
    done

    # Python pode existir sem os módulos venv e pip exigidos pelo projeto.
    if [[ -n "$PYTHON_PACKAGE_MANAGER" ]] && command_exists python3; then
        python3 -m venv --help >/dev/null 2>&1 || missing_packages+=(python3-venv)
        python3 -m pip --version >/dev/null 2>&1 || missing_packages+=(python3-pip)
    fi

    if ((${#missing_packages[@]} > 0)); then
        local unique=() item exists u
        for item in "${missing_packages[@]}"; do
            exists=false
            for u in "${unique[@]}"; do [[ "$u" == "$item" ]] && exists=true; done
            $exists || unique+=("$item")
        done
        if is_debian_family; then
            apt_install_packages "${unique[@]}" || return 1
            hash -r
        else
            plain_err "Runtimes ausentes e sem instalador APT: ${unique[*]}"
            return 1
        fi
    fi

    if ((${#special_packages[@]} > 0)); then
        local unique_special=() item seen s_item
        for item in "${special_packages[@]}"; do
            seen=false
            for s_item in "${unique_special[@]}"; do [[ "$s_item" == "$item" ]] && seen=true; done
            $seen || unique_special+=("$item")
        done
        for item in "${unique_special[@]}"; do install_special_runtime "$item" || return 1; done
        hash -r
    fi

    # Respeita a versão declarada pelo projeto quando Corepack está disponível.
    if [[ -n "$NODE_DECLARED_PACKAGE_MANAGER" && "$NODE_DECLARED_PACKAGE_MANAGER" != npm@* ]] && command_exists corepack; then
        if $DRY_RUN; then
            plain_info "[dry-run] corepack enable && corepack prepare $NODE_DECLARED_PACKAGE_MANAGER --activate"
        else
            corepack enable
            corepack prepare "$NODE_DECLARED_PACKAGE_MANAGER" --activate
        fi
        hash -r
    fi

    if [[ "$NODE_PACKAGE_MANAGER" == "pnpm" ]] && ! command_exists pnpm; then
        command_exists npm || { plain_err "npm é necessário para instalar pnpm."; return 1; }
        $DRY_RUN && plain_info "[dry-run] npm install --global pnpm" || npm install --global pnpm
    fi
    if [[ "$NODE_PACKAGE_MANAGER" == "yarn" ]] && ! command_exists yarn; then
        command_exists npm || { plain_err "npm é necessário para instalar Yarn."; return 1; }
        $DRY_RUN && plain_info "[dry-run] npm install --global yarn" || npm install --global yarn
    fi
    if [[ "$NODE_PACKAGE_MANAGER" == "bun" ]] && ! command_exists bun; then
        if $DRY_RUN; then
            plain_info "[dry-run] curl -fsSL https://bun.sh/install | bash"
        else
            curl -fsSL https://bun.sh/install | bash
            export PATH="$HOME/.bun/bin:$PATH"
        fi
    fi

    if [[ "$PYTHON_PACKAGE_MANAGER" == "poetry" ]] && ! command_exists poetry; then
        command_exists pipx || apt_install_packages pipx || return 1
        $DRY_RUN && plain_info "[dry-run] pipx install poetry" || pipx install poetry
        export PATH="$HOME/.local/bin:$PATH"
    fi
    if [[ "$PYTHON_PACKAGE_MANAGER" == "pipenv" ]] && ! command_exists pipenv; then
        command_exists pipx || apt_install_packages pipx || return 1
        $DRY_RUN && plain_info "[dry-run] pipx install pipenv" || pipx install pipenv
        export PATH="$HOME/.local/bin:$PATH"
    fi
    if [[ "$PYTHON_PACKAGE_MANAGER" == "uv" ]] && ! command_exists uv; then
        if $DRY_RUN; then
            plain_info "[dry-run] curl -LsSf https://astral.sh/uv/install.sh | sh"
        else
            curl -LsSf https://astral.sh/uv/install.sh | sh
            export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
        fi
    fi

    if [[ "$PYTHON_PACKAGE_MANAGER" == "pip" && ! -x "$PROJECT_DIR/.venv/bin/python" ]]; then
        if $DRY_RUN; then plain_info "[dry-run] python3 -m venv .venv"
        else python3 -m venv "$PROJECT_DIR/.venv"; fi
    fi
}

manifest_fingerprint() {
    if ((${#MANIFESTS[@]} == 0)); then printf 'no-manifest'; return 0; fi
    local file
    {
        for file in "${MANIFESTS[@]}"; do
            [[ -f "$file" ]] || continue
            printf '%s\0' "$(project_relative "$file")"
            sha256sum "$file"
        done
        printf 'runtime:%s\n' "$RUNTIME_SUMMARY"
        printf 'node-manager:%s\n' "$NODE_PACKAGE_MANAGER"
        printf 'python-manager:%s\n' "$PYTHON_PACKAGE_MANAGER"
    } | sha256sum | awk '{print $1}'
}

dependencies_present() {
    if [[ -f "$PROJECT_DIR/package.json" && ! -d "$PROJECT_DIR/node_modules" ]]; then return 1; fi
    if [[ "$PYTHON_PACKAGE_MANAGER" == "pip" && ! -x "$PROJECT_DIR/.venv/bin/python" ]]; then return 1; fi
    if [[ -f "$PROJECT_DIR/composer.json" && ! -d "$PROJECT_DIR/vendor" ]]; then return 1; fi
    if [[ -f "$PROJECT_DIR/Gemfile" && ! -f "$PROJECT_DIR/Gemfile.lock" && ! -d "$PROJECT_DIR/vendor/bundle" ]]; then return 1; fi
    return 0
}

execute_plain_command() {
    local command="$1" description="$2"
    if $DRY_RUN; then
        plain_info "[dry-run] $description: $command"
        return 0
    fi
    plain_info "$description"
    (
        cd "$PROJECT_DIR"
        bash -lc "$command"
    ) 2>&1 | tee -a "$LOG_FILE"
    local code=${PIPESTATUS[0]}
    if (( code == 0 )); then plain_ok "$description concluído."
    else plain_err "$description falhou com código $code."; fi
    return "$code"
}

install_project_dependencies_if_needed() {
    $NO_BOOTSTRAP && return 0
    ((${#DEPENDENCY_COMMANDS[@]} > 0)) || { plain_ok "O projeto não declarou uma etapa de instalação de dependências reconhecida."; return 0; }

    local current previous=""
    current="$(manifest_fingerprint)"
    [[ -f "$DEPS_STAMP_FILE" ]] && previous="$(safe_read_first_line "$DEPS_STAMP_FILE")"
    if [[ "$current" == "$previous" ]] && dependencies_present; then
        plain_ok "Dependências do projeto já correspondem aos manifestos atuais."
        return 0
    fi

    local i
    for i in "${!DEPENDENCY_COMMANDS[@]}"; do
        execute_plain_command "${DEPENDENCY_COMMANDS[$i]}" "${DEPENDENCY_DESCRIPTIONS[$i]}" || return 1
    done
    $DRY_RUN || printf '%s\n' "$current" > "$DEPS_STAMP_FILE"
}

bootstrap_all() {
    printf '\n  ORQUESTRADOR UNIVERSAL v%s\n' "$ORCH_VERSION"
    printf '  Projeto: %s\n\n' "$PROJECT_DIR"
    ensure_self_dependencies || return 1
    detect_project
    ensure_runtime_dependencies || return 1
    # Redetecta porque runtimes/venv podem ter sido criados.
    detect_project
    install_project_dependencies_if_needed || return 1
    detect_project
    bootstrap_workspace_components || return 1
    detect_project
    plain_ok "Bootstrap concluído. Stack: $RUNTIME_SUMMARY"
}

# ──────────────────────────────────────────────────────────────────────────────
# Gerenciamento seguro de processo
# ──────────────────────────────────────────────────────────────────────────────
process_cwd() {
    local pid="$1"
    readlink -f "/proc/$pid/cwd" 2>/dev/null || true
}

process_start_ticks() {
    local pid="$1"
    awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || true
}

load_server_metadata() {
    SERVER_PID=""; SERVER_PGID=""
    [[ -f "$PID_FILE" && -f "$META_FILE" ]] || return 1
    SERVER_PID="$(tr -dc '0-9' < "$PID_FILE" 2>/dev/null)"
    SERVER_PGID="$(grep '^PGID=' "$META_FILE" 2>/dev/null | cut -d= -f2- | tr -dc '0-9')"
    [[ -n "$SERVER_PID" ]] || return 1
}

project_identity_hash() {
    printf '%s' "$PROJECT_DIR" | sha256sum | awk '{print $1}'
}

server_owned_by_project() {
    local pid="$1"
    [[ -d "/proc/$pid" ]] || return 1
    local cwd expected_ticks saved_ticks saved_project_hash
    expected_ticks="$(process_start_ticks "$pid")"
    saved_ticks="$(grep '^START_TICKS=' "$META_FILE" 2>/dev/null | cut -d= -f2- || true)"
    saved_project_hash="$(grep '^PROJECT_DIR_SHA256=' "$META_FILE" 2>/dev/null | cut -d= -f2- || true)"
    [[ -n "$saved_ticks" && "$expected_ticks" == "$saved_ticks" ]] || return 1
    [[ -n "$saved_project_hash" && "$saved_project_hash" == "$(project_identity_hash)" ]] || return 1

    # /proc/<pid>/cwd pode estar oculto por hidepid/container. Quando for legível,
    # ele vira uma validação adicional; quando não for, PID + start ticks + hash
    # do projeto continuam impedindo que um PID reciclado seja aceito.
    cwd="$(process_cwd "$pid")"
    [[ -z "$cwd" || "$cwd" == "$PROJECT_DIR" ]] || return 1
    return 0
}

refresh_server_state() {
    APP_ACTIVE=false
    if load_server_metadata && kill -0 "$SERVER_PID" 2>/dev/null && server_owned_by_project "$SERVER_PID"; then
        APP_ACTIVE=true
    else
        SERVER_PID=""; SERVER_PGID=""
        rm -f "$PID_FILE" "$META_FILE" 2>/dev/null || true
    fi
}

port_listener_pids() {
    local port="$1"
    command_exists lsof || return 0
    lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true
}

tcp_port_open() {
    local port="$1"
    if command_exists timeout; then
        timeout 1 bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" >/dev/null 2>&1
    else
        bash -c "exec 3<>/dev/tcp/127.0.0.1/$port" >/dev/null 2>&1
    fi
}

process_group_has_listener() {
    local pgid="$1" pid candidate_pgid
    [[ "$pgid" =~ ^[0-9]+$ ]] || return 1
    while read -r pid candidate_pgid; do
        [[ "$candidate_pgid" == "$pgid" ]] || continue
        lsof -nP -a -p "$pid" -iTCP -sTCP:LISTEN >/dev/null 2>&1 && return 0
    done < <(ps -eo pid=,pgid= 2>/dev/null)
    return 1
}

terminate_validated_server_group() {
    local pid="$1" pgid="$2" own_pgid waited=0
    own_pgid="$(ps -o pgid= -p $$ 2>/dev/null | tr -d ' ' || true)"
    if [[ "$pgid" =~ ^[0-9]+$ && "$pgid" != "$own_pgid" ]]; then
        kill -TERM -- "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    else
        kill -TERM "$pid" 2>/dev/null || true
    fi
    while kill -0 "$pid" 2>/dev/null && (( waited < 50 )); do sleep 0.1; ((waited++)); done
    if kill -0 "$pid" 2>/dev/null; then
        if [[ "$pgid" =~ ^[0-9]+$ && "$pgid" != "$own_pgid" ]]; then
            kill -KILL -- "-$pgid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
        else
            kill -KILL "$pid" 2>/dev/null || true
        fi
    fi
    wait "$pid" 2>/dev/null || true
}

start_background_server() {
    local command="$1"
    refresh_server_state
    if $APP_ACTIVE; then
        LAST_STATUS="warn"; LAST_MSG="Já existe um servidor iniciado pelo orquestrador (PID $SERVER_PID)."
        return 1
    fi

    if $DRY_RUN; then
        append_live "[dry-run] $command"
        LAST_STATUS="ok"; LAST_MSG="Comando de servidor validado em dry-run."
        return 0
    fi

    local occupied
    occupied="$(port_listener_pids "$PORT")"
    if tcp_port_open "$PORT"; then
        LAST_STATUS="err"
        LAST_MSG="A porta $PORT já está ocupada; nenhum processo externo foi encerrado."
        if [[ -n "$occupied" ]]; then
            log_err "Porta $PORT ocupada pelos PIDs: $(tr '\n' ' ' <<< "$occupied")"
        else
            log_err "Porta $PORT ocupada por um processo não identificado sem lsof."
        fi
        return 1
    fi

    : > "$LOG_FILE"
    chmod 600 "$LOG_FILE" 2>/dev/null || true
    (
        cd "$PROJECT_DIR" || exit 1
        export PORT
        exec setsid --wait bash -lc "$command"
    ) >> "$LOG_FILE" 2>&1 &
    SERVER_PID=$!
    sleep 0.05
    SERVER_PGID="$(ps -o pgid= -p "$SERVER_PID" 2>/dev/null | tr -d ' ' || true)"
    [[ "$SERVER_PGID" =~ ^[0-9]+$ ]] || SERVER_PGID="$SERVER_PID"
    printf '%s\n' "$SERVER_PID" > "$PID_FILE"
    local ticks
    ticks="$(process_start_ticks "$SERVER_PID")"
    {
        printf 'PID=%s\n' "$SERVER_PID"
        printf 'PGID=%s\n' "$SERVER_PGID"
        printf 'START_TICKS=%s\n' "$ticks"
        printf 'PROJECT_DIR_SHA256=%s\n' "$(project_identity_hash)"
        printf 'PORT=%s\n' "$PORT"
        printf 'COMMAND_SHA256=%s\n' "$(printf '%s' "$command" | sha256sum | awk '{print $1}')"
        printf 'STARTED_AT=%q\n' "$(now_ts)"
    } > "$META_FILE"
    chmod 600 "$PID_FILE" "$META_FILE" 2>/dev/null || true

    local retries=0 max_retries=300 ready=false
    while (( retries < max_retries )); do
        if ! kill -0 "$SERVER_PID" 2>/dev/null; then
            wait "$SERVER_PID" 2>/dev/null || true
            LAST_STATUS="err"; LAST_MSG="O servidor encerrou durante a inicialização. Consulte os logs."
            refresh_live_from_log
            rm -f "$PID_FILE" "$META_FILE" 2>/dev/null || true
            SERVER_PID=""; SERVER_PGID=""; APP_ACTIVE=false
            return 1
        fi
        if command_exists lsof && process_group_has_listener "$SERVER_PGID"; then ready=true; break; fi
        if tcp_port_open "$PORT"; then ready=true; break; fi
        sleep 0.2
        ((retries++))
        PROGRESS=$(( 20 + retries * 70 / max_retries ))
        refresh_live_from_log
        draw_ui
    done

    if ! $ready; then
        refresh_live_from_log
        LAST_STATUS="err"
        LAST_MSG="O processo permaneceu ativo, mas não abriu uma porta TCP em 60 segundos."
        log_err "$LAST_MSG"
        terminate_validated_server_group "$SERVER_PID" "$SERVER_PGID"
        rm -f "$PID_FILE" "$META_FILE" 2>/dev/null || true
        SERVER_PID=""; SERVER_PGID=""; APP_ACTIVE=false
        return 1
    fi

    APP_ACTIVE=true
    PROGRESS=100
    LAST_STATUS="ok"; LAST_MSG="Servidor ativo (PID $SERVER_PID, porta preferencial $PORT)."
    return 0
}

stop_server() {
    refresh_server_state
    if ! $APP_ACTIVE; then
        LAST_STATUS="warn"; LAST_MSG="Nenhum servidor pertencente a este projeto está ativo."
        return 0
    fi
    local pid="$SERVER_PID" pgid="$SERVER_PGID"
    CURRENT_TASK="Encerrando servidor PID $pid..."; PROGRESS=20; draw_ui
    terminate_validated_server_group "$pid" "$pgid"
    rm -f "$PID_FILE" "$META_FILE" 2>/dev/null || true
    SERVER_PID=""; SERVER_PGID=""; APP_ACTIVE=false; PROGRESS=100
    LAST_STATUS="ok"; LAST_MSG="Servidor encerrado com segurança."
}

# ──────────────────────────────────────────────────────────────────────────────
# TUI e captura ao vivo
# ──────────────────────────────────────────────────────────────────────────────
cursor_hide() { printf '\033[?25l'; }
cursor_show() { printf '\033[?25h'; }
reset_cursor() { printf '\033[H'; }

update_dimensions() {
    TERM_LINES=$(tput lines 2>/dev/null || printf '24')
    TERM_COLS=$(tput cols 2>/dev/null || printf '80')
    NR_LINES=5
    MENU_VISIBLE=$(( TERM_LINES - NR_LINES - 15 ))
    (( MENU_VISIBLE < 4 )) && MENU_VISIBLE=4
    (( MENU_VISIBLE > 12 )) && MENU_VISIBLE=12
    NEED_REPAINT=true
}

update_menu_window() {
    local total=${#ACTION_IDS[@]}
    (( total == 0 )) && { SELECTED=0; MENU_TOP=0; return; }
    (( SELECTED < 0 )) && SELECTED=0
    (( SELECTED >= total )) && SELECTED=$((total-1))
    (( SELECTED < MENU_TOP )) && MENU_TOP=$SELECTED
    (( SELECTED >= MENU_TOP + MENU_VISIBLE )) && MENU_TOP=$((SELECTED-MENU_VISIBLE+1))
    local max_top=$((total-MENU_VISIBLE)); ((max_top < 0)) && max_top=0
    (( MENU_TOP > max_top )) && MENU_TOP=$max_top
    (( MENU_TOP < 0 )) && MENU_TOP=0
}

append_live() {
    local line="$1"
    [[ -n "$line" ]] || return 0
    $NON_INTERACTIVE && printf '  %s\n' "$line"
    LIVE_LINES+=("$line")
    ((${#LIVE_LINES[@]} > LOG_MAX)) && LIVE_LINES=("${LIVE_LINES[@]:1}")
    (( SCROLL_POS < 5 )) && SCROLL_POS=0
    log_info "live: $line"
}

refresh_live_from_log() {
    [[ -f "$LOG_FILE" ]] || return 0
    mapfile -t LIVE_LINES < <(tail -n "$LOG_MAX" "$LOG_FILE" 2>/dev/null)
}

truncate_text() {
    local text="$1" max="$2"
    (( max < 1 )) && { printf ''; return; }
    if ((${#text} <= max)); then printf '%s' "$text"
    elif ((max > 1)); then printf '%s…' "${text:0:max-1}"
    else printf '%s' "${text:0:1}"
    fi
}

menu_count() { printf '%s' "${#ACTION_IDS[@]}"; }

draw_ui() {
    $NON_INTERACTIVE && return 0
    local buffer="" elapsed timer title version_text
    elapsed=$(( $(date +%s) - START_TIME ))
    timer=$(printf '%02d:%02d:%02d' $((elapsed/3600)) $(((elapsed%3600)/60)) $((elapsed%60)))
    title="$(truncate_text "$PROJECT_NAME" 32)"
    version_text="${PROJECT_VERSION:+ v$PROJECT_VERSION}"

    if $NEED_REPAINT; then printf '\033[2J'; NEED_REPAINT=false; fi
    reset_cursor

    buffer+="${EL}\n${EL}  ${FG_DIM}${DIM}${I_DOT} ${title}${version_text} ${BOLD}• ORCH v${ORCH_VERSION}${RST} ${FG_DIM}— ${timer}  │  Porta: ${PORT}${RST}\n"
    buffer+="${EL}  ${ACCENT_CYAN}${BOLD}$(truncate_text "$CURRENT_TASK" $((TERM_COLS-10)))${RST}\n"

    local bar_w=$(( TERM_COLS - 13 )); ((bar_w < 10)) && bar_w=10
    local filled=$(( PROGRESS * bar_w / 100 )); local empty=$((bar_w-filled))
    buffer+="${EL}  "
    ((filled > 0)) && buffer+="${ACCENT_MINT}$(printf '%.0s━' $(seq 1 "$filled"))"
    ((empty > 0)) && buffer+="${FG_DIM}$(printf '%.0s─' $(seq 1 "$empty"))"
    buffer+=" ${ACCENT_CYAN}${BOLD}${PROGRESS}%${RST}\n"
    buffer+="${EL}  ${FG_SEC}${DIM}$(printf '%.0s─' $(seq 1 $((TERM_COLS-6))))${RST}\n\n"

    update_menu_window
    local i padded_label max_desc menu_end total_actions
    total_actions=${#ACTION_IDS[@]}
    menu_end=$((MENU_TOP+MENU_VISIBLE)); ((menu_end > total_actions)) && menu_end=$total_actions
    if ((total_actions > MENU_VISIBLE)); then
        buffer+="${EL}  ${FG_DIM}${DIM}Menu $((MENU_TOP+1))-${menu_end} de ${total_actions}${RST}\n"
    fi
    for ((i=MENU_TOP; i<menu_end; i++)); do
        padded_label=$(printf '%-28s' "${ACTION_LABELS[$i]}")
        max_desc=$((TERM_COLS - 41)); ((max_desc < 0)) && max_desc=0
        if (( i == SELECTED )); then
            buffer+="${EL}  ${BG_HOVER}${ACCENT_CYAN}${BOLD}${I_ARR}  ${padded_label}${RST} ${FG_SEC}$(truncate_text "${ACTION_DESCS[$i]}" "$max_desc")${RST}\n"
        else
            buffer+="${EL}     ${FG_SEC}${padded_label}${RST} ${FG_DIM}$(truncate_text "${ACTION_DESCS[$i]}" "$max_desc")${RST}\n"
        fi
    done

    buffer+="${EL}\n"
    local total_live=${#LIVE_LINES[@]}
    if (( total_live > 0 )); then
        buffer+="${EL}  ${FG_DIM}${I_TERM} LIVE OUTPUT:${RST}"
        ((SCROLL_POS > 0)) && buffer+=" ${STATE_WARN}[SCROLL: -${SCROLL_POS}]${RST}"
        buffer+="\n"
        local start=$(( total_live - NR_LINES - SCROLL_POS )); ((start < 0)) && start=0
        local end=$((start + NR_LINES)); ((end > total_live)) && end=$total_live
        local sb_size=$NR_LINES sb_indicator_pos=0 max_sc
        if ((total_live > NR_LINES)); then
            max_sc=$((total_live-NR_LINES))
            sb_indicator_pos=$((SCROLL_POS*(sb_size-1)/max_sc))
        fi
        local j idx line_content sb_char
        for ((j=0; j<NR_LINES; j++)); do
            idx=$((start+j)); line_content=""
            ((idx < end)) && line_content="${LIVE_LINES[$idx]}"
            sb_char="${FG_DIM}┃${RST}"
            if (( total_live > NR_LINES && (sb_size-1-j) == sb_indicator_pos )); then sb_char="${ACCENT_CYAN}█${RST}"; fi
            buffer+="${EL}  ${sb_char} ${ACCENT_AMBER}$(truncate_text "$line_content" $((TERM_COLS-10)))${RST}\n"
        done
    else
        local j
        for ((j=0; j<NR_LINES+1; j++)); do buffer+="${EL}\n"; done
    fi

    buffer+="${EL}\n"
    if [[ -n "$LAST_MSG" ]]; then
        buffer+="${EL}  ${FG_DIM}${DIM}STATUS:${RST} "
        case "$LAST_STATUS" in
            ok) buffer+="${STATE_OK}${I_CHECK} ${LAST_MSG}${RST}\n" ;;
            warn) buffer+="${STATE_WARN}${I_WARN} ${LAST_MSG}${RST}\n" ;;
            err) buffer+="${STATE_ERR}${I_CROSS} ${LAST_MSG}${RST}\n" ;;
            *) buffer+="${FG_SEC}${LAST_MSG}${RST}\n" ;;
        esac
    else buffer+="${EL}\n"; fi
    buffer+="${EL}\n${EL}  ${FG_DIM}${DIM}[↑↓/jk] Mover  [Enter] Executar  [a/z] Scroll  [L] Logs  [Q] Sair${RST}"
    printf '%b\033[J' "$buffer"
}

run_streaming_command() {
    local command="$1" label="$2"
    LIVE_LINES=(); SCROLL_POS=0; PROGRESS=5; CURRENT_TASK="$label"; LAST_MSG=""; draw_ui
    if $DRY_RUN; then
        append_live "[dry-run] $command"
        PROGRESS=100; LAST_STATUS="ok"; LAST_MSG="Comando exibido sem execução."; draw_ui
        return 0
    fi

    local fifo status_file
    fifo="$(mktemp "${ORCH_DIR}/stream.XXXXXX")"
    rm -f "$fifo"
    status_file="$(mktemp "${ORCH_DIR}/status.XXXXXX")"
    mkfifo -m 600 "$fifo"
    (
        cd "$PROJECT_DIR" || exit 1
        export PORT
        set +e
        bash -lc "$command"
        code=$?
        printf '%s\n' "$code" > "$status_file"
        exit "$code"
    ) > "$fifo" 2>&1 &
    ACTIVE_COMMAND_PID=$!

    exec 3< "$fifo"
    local line spinner=0
    while true; do
        if IFS= read -r -t 0.08 line <&3; then
            append_live "$line"
        elif ! kill -0 "$ACTIVE_COMMAND_PID" 2>/dev/null; then
            while IFS= read -r line <&3; do append_live "$line"; done
            break
        fi
        spinner=$(( (spinner + 1) % 70 ))
        PROGRESS=$(( 10 + spinner ))
        draw_ui
    done
    exec 3<&-
    wait "$ACTIVE_COMMAND_PID" 2>/dev/null
    local wait_code=$?
    ACTIVE_COMMAND_PID=""
    local code="$wait_code"
    [[ -s "$status_file" ]] && code="$(tr -dc '0-9' < "$status_file")"
    rm -f "$fifo" "$status_file"
    PROGRESS=100
    if (( code == 0 )); then
        LAST_STATUS="ok"; LAST_MSG="$label concluído com sucesso."
        $NON_INTERACTIVE && plain_ok "$LAST_MSG"
    else
        LAST_STATUS="err"; LAST_MSG="$label falhou com código $code."
        $NON_INTERACTIVE && plain_err "$LAST_MSG"
    fi
    draw_ui
    return "$code"
}

show_logs() {
    $NON_INTERACTIVE && { tail -n "$LOG_MAX" "$LOG_FILE"; return 0; }
    printf '\033[2J\033[H'
    printf '\n  %b%s LOG VIEWER%b (%s linhas persistidas)\n\n' "$ACCENT_CYAN$BOLD" "$I_TERM" "$RST" "$(wc -l < "$LOG_FILE" 2>/dev/null || printf 0)"
    local vis=$((TERM_LINES-8)); ((vis < 5)) && vis=5
    tail -n "$vis" "$LOG_FILE" 2>/dev/null | while IFS= read -r line; do printf '    %b%s%b\n' "$FG_SEC" "$line" "$RST"; done
    printf '\n  %bPressione qualquer tecla para voltar%b' "$FG_DIM" "$RST"
    read -rsn1
    NEED_REPAINT=true
}

validate_python_imports() {
    LIVE_LINES=(); SCROLL_POS=0; CURRENT_TASK="Validando imports Python..."; PROGRESS=10; draw_ui
    local py
    py="$(python_executable)"
    if ! command_exists "${py%% *}" && [[ ! -x "${py//\\/}" ]]; then
        LAST_STATUS="err"; LAST_MSG="Interpretador Python não encontrado."; PROGRESS=100; draw_ui; return 1
    fi
    local output code
    set +e
    output="$($py - "$PROJECT_DIR" <<'PYIMPORT'
import ast
import importlib.util
import os
import pathlib
import sys

root = pathlib.Path(sys.argv[1]).resolve()
skip_parts = {'.venv', 'venv', 'node_modules', '.git', 'build', 'dist', '__pycache__', '.tox', '.mypy_cache'}
local_names = {p.stem for p in root.glob('*.py')}
local_names.update(p.name for p in root.iterdir() if p.is_dir() and (p / '__init__.py').exists())
stdlib = set(getattr(sys, 'stdlib_module_names', ()))
imports = set()
parse_errors = []
for path in root.rglob('*.py'):
    if any(part in skip_parts for part in path.parts):
        continue
    try:
        tree = ast.parse(path.read_text(encoding='utf-8', errors='replace'), filename=str(path))
    except SyntaxError as exc:
        parse_errors.append(f"{path.relative_to(root)}:{exc.lineno}: {exc.msg}")
        continue
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.update(alias.name.split('.')[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            imports.add(node.module.split('.')[0])
missing = []
for name in sorted(imports):
    if name in stdlib or name in local_names:
        continue
    try:
        found = importlib.util.find_spec(name) is not None
    except Exception:
        found = False
    if not found:
        missing.append(name)
print(f"Arquivos Python analisados; imports externos encontrados: {len(imports)}")
for item in parse_errors:
    print(f"AVISO sintaxe: {item}")
if missing:
    print("Imports não resolvidos após instalar os manifestos:")
    for name in missing:
        print(f"  - {name}")
    print("Não houve instalação por adivinhação: o nome do import pode diferir do pacote de distribuição. Corrija requirements/pyproject e execute novamente.")
    raise SystemExit(1)
print("Todos os imports externos analisáveis foram resolvidos.")
PYIMPORT
)"
    code=$?
    while IFS= read -r line; do append_live "$line"; done <<< "$output"
    PROGRESS=100
    if ((code == 0)); then LAST_STATUS="ok"; LAST_MSG="Imports Python resolvidos."
    else LAST_STATUS="err"; LAST_MSG="Há imports Python não declarados ou indisponíveis."; fi
    draw_ui
    return "$code"
}

health_check() {
    LIVE_LINES=(); SCROLL_POS=0; CURRENT_TASK="Verificando Saúde do Projeto..."; PROGRESS=5; draw_ui
    local issues=0 i cmd
    append_live "Projeto: $PROJECT_DIR"
    append_live "Stack: $RUNTIME_SUMMARY"
    append_live "Porta preferencial: $PORT"
    for i in "${!REQUIRED_RUNTIME_COMMANDS[@]}"; do
        cmd="${REQUIRED_RUNTIME_COMMANDS[$i]}"
        if command_exists "$cmd"; then append_live "✔ Runtime $cmd: $(command -v "$cmd")"
        else append_live "✖ Runtime ausente: $cmd"; ((issues++)); fi
    done
    local manifest
    for manifest in "${MANIFESTS[@]}"; do
        if [[ -r "$manifest" ]]; then append_live "✔ Manifesto: $(project_relative "$manifest")"
        else append_live "✖ Manifesto ilegível: $(project_relative "$manifest")"; ((issues++)); fi
    done
    if dependencies_present; then append_live "✔ Estruturas de dependências presentes"
    else append_live "⚠ Dependências precisam ser instaladas"; ((issues++)); fi
    refresh_server_state
    if $APP_ACTIVE; then append_live "✔ Servidor ativo e pertencente ao projeto: PID $SERVER_PID"
    else append_live "• Nenhum servidor do orquestrador ativo"; fi
    PROGRESS=100
    if ((issues == 0)); then LAST_STATUS="ok"; LAST_MSG="Saúde 100% OK."
    else LAST_STATUS="warn"; LAST_MSG="$issues problema(s) ou pendência(s) detectado(s)."; fi
    draw_ui
    return $((issues > 0))
}

boot_sequence() {
    $NON_INTERACTIVE && return 0
    printf '\033[?1049h'; IN_ALT_SCREEN=true; cursor_hide; printf '\033[2J'
    local frames=("⠋" "⠙" "⠹" "⠸" "⠼" "⠴" "⠦" "⠧" "⠇" "⠏") i row col label
    label="$(truncate_text "$PROJECT_NAME" 26)"
    for i in {1..30}; do
        reset_cursor
        row=$((TERM_LINES/2)); col=$(((TERM_COLS-36)/2)); ((col < 0)) && col=0
        tput cup "$row" "$col" 2>/dev/null || true
        printf '%b%s%b %b%b🐾 %s%b %bv%s%b%s' "$ACCENT_CYAN" "${frames[i%10]}" "$RST" "$FG_MAIN" "$BOLD" "$label" "$RST" "$FG_DIM" "$ORCH_VERSION" "$RST" "$EL"
        sleep 0.05
    done
}

confirm_action() {
    local prompt="$1"
    if [[ "${ORCH_AUTO_CONFIRM:-0}" == "1" ]]; then return 0; fi
    if $NON_INTERACTIVE; then
        plain_err "A ação exige confirmação. Use ORCH_AUTO_CONFIRM=1 para confirmar conscientemente."
        return 1
    fi
    printf '\033[2J\033[H\n  %b%s%b\n\n  Digite %bCONFIRMAR%b para prosseguir: ' "$STATE_WARN$BOLD" "$prompt" "$RST" "$ACCENT_ROSE$BOLD" "$RST"
    local answer
    read -r answer
    [[ "$answer" == "CONFIRMAR" ]]
}

execute_action_index() {
    local index="$1" id="${ACTION_IDS[$index]}" label="${ACTION_LABELS[$index]}" cmd="${ACTION_CMDS[$index]}" kind="${ACTION_KINDS[$index]}" confirm="${ACTION_CONFIRMS[$index]}"
    if [[ "$confirm" == "true" ]]; then
        confirm_action "${ACTION_DESCS[$index]}" || { LAST_STATUS="warn"; LAST_MSG="Operação cancelada."; NEED_REPAINT=true; return 1; }
    fi
    case "$kind" in
        server)
            LIVE_LINES=(); CURRENT_TASK="${label#?? }"; PROGRESS=10; draw_ui
            local server_code=0
            start_background_server "$cmd" || server_code=$?
            refresh_live_from_log
            if $NON_INTERACTIVE; then
                if (( server_code == 0 )); then plain_ok "$LAST_MSG"; else plain_err "$LAST_MSG"; fi
            fi
            return "$server_code"
            ;;
        command) run_streaming_command "$cmd" "${label#?? }"; return $? ;;
        stop)
            stop_server
            local stop_code=$?
            $NON_INTERACTIVE && { if ((stop_code==0)); then plain_ok "$LAST_MSG"; else plain_err "$LAST_MSG"; fi; }
            return "$stop_code"
            ;;
        health) health_check; return $? ;;
        python_imports) validate_python_imports; return $? ;;
        logs) show_logs ;;
        refresh)
            CURRENT_TASK="Redetectando projeto..."; PROGRESS=30; draw_ui
            detect_project; SELECTED=0; MENU_TOP=0; PROGRESS=100; LAST_STATUS="ok"; LAST_MSG="Projeto redetectado; menu atualizado."; NEED_REPAINT=true
            ;;
        subproject) open_subproject_tui "$cmd" ;;
        exit) cleanup 0 ;;
        *) LAST_STATUS="err"; LAST_MSG="Tipo de ação desconhecido: $kind"; return 1 ;;
    esac
}

# ──────────────────────────────────────────────────────────────────────────────
# Cleanup, lock e main
# ──────────────────────────────────────────────────────────────────────────────
cleanup() {
    local exit_code="${1:-$?}"
    $CLEANUP_DONE && return "$exit_code"
    CLEANUP_DONE=true
    if [[ -n "$ACTIVE_COMMAND_PID" ]] && kill -0 "$ACTIVE_COMMAND_PID" 2>/dev/null; then
        pkill -TERM -P "$ACTIVE_COMMAND_PID" 2>/dev/null || true
        kill -TERM "$ACTIVE_COMMAND_PID" 2>/dev/null || true
    fi
    rm -f "$LOCK_FILE" 2>/dev/null || true
    if $IN_ALT_SCREEN; then printf '\033[?1049l'; cursor_show; IN_ALT_SCREEN=false; fi
    if ! $NON_INTERACTIVE; then printf '\n  %b■ Orquestrador encerrado. Até logo.%b\n\n' "$ACCENT_ROSE" "$RST"; fi
    return "$exit_code"
}

on_signal() { cleanup 130; exit 130; }
trap on_signal INT TERM HUP
trap 'update_dimensions' WINCH
trap 'code=$?; cleanup "$code"' EXIT

acquire_lock() {
    exec 9> "$LOCK_FILE"
    if ! flock -n 9; then
        plain_err "Outra instância do orquestrador está ativa para este projeto."
        return 1
    fi
    printf '%s\n' "$$" 1>&9
}

list_actions_output() {
    local i
    printf 'PROJETO\t%s\n' "$PROJECT_NAME"
    printf 'STACK\t%s\n' "$RUNTIME_SUMMARY"
    printf 'PORTA\t%s\n' "$PORT"
    for i in "${!ACTION_IDS[@]}"; do
        printf '%s\t%s\t%s\n' "${ACTION_IDS[$i]}" "${ACTION_LABELS[$i]}" "${ACTION_DESCS[$i]}"
    done
}

find_action_index() {
    local id="$1" i
    for i in "${!ACTION_IDS[@]}"; do [[ "${ACTION_IDS[$i]}" == "$id" ]] && { printf '%s' "$i"; return 0; }; done
    return 1
}

interactive_loop() {
    update_dimensions
    boot_sequence
    while true; do
        refresh_server_state
        if $APP_ACTIVE; then refresh_live_from_log; fi
        draw_ui
        local key="" seq="" count max_sc
        if read -rsn1 -t 0.5 key; then
            case "$key" in
                $'\x1b')
                    read -rsn2 -t 0.05 seq || true
                    case "$seq" in
                        "[A") SELECTED=$(( (SELECTED-1+${#ACTION_IDS[@]}) % ${#ACTION_IDS[@]} )) ;;
                        "[B") SELECTED=$(( (SELECTED+1) % ${#ACTION_IDS[@]} )) ;;
                        "[5~") max_sc=$(( ${#LIVE_LINES[@]}-NR_LINES )); SCROLL_POS=$((SCROLL_POS+NR_LINES)); ((SCROLL_POS>max_sc)) && SCROLL_POS=$max_sc; ((SCROLL_POS<0)) && SCROLL_POS=0 ;;
                        "[6~") SCROLL_POS=$((SCROLL_POS-NR_LINES)); ((SCROLL_POS<0)) && SCROLL_POS=0 ;;
                    esac
                    ;;
                k) SELECTED=$(( (SELECTED-1+${#ACTION_IDS[@]}) % ${#ACTION_IDS[@]} )) ;;
                j) SELECTED=$(( (SELECTED+1) % ${#ACTION_IDS[@]} )) ;;
                a|A) max_sc=$(( ${#LIVE_LINES[@]}-NR_LINES )); SCROLL_POS=$((SCROLL_POS+1)); ((SCROLL_POS>max_sc)) && SCROLL_POS=$max_sc; ((SCROLL_POS<0)) && SCROLL_POS=0 ;;
                z|Z) SCROLL_POS=$((SCROLL_POS-1)); ((SCROLL_POS<0)) && SCROLL_POS=0 ;;
                l|L) show_logs ;;
                r|R) detect_project; SELECTED=0; MENU_TOP=0; LAST_STATUS="ok"; LAST_MSG="Projeto redetectado."; NEED_REPAINT=true ;;
                q|Q) cleanup 0; exit 0 ;;
                "")
                    SCROLL_POS=0
                    execute_action_index "$SELECTED" || true
                    detect_project
                    ((SELECTED >= ${#ACTION_IDS[@]})) && SELECTED=$((${#ACTION_IDS[@]}-1))
                    ;;
            esac
        fi
    done
}

main() {
    cd "$PROJECT_DIR" || exit 1
    acquire_lock || exit 1
    bootstrap_all || exit 1
    $BOOTSTRAP_ONLY && exit 0

    if $LIST_ACTIONS; then list_actions_output; exit 0; fi
    if [[ -n "$REQUESTED_ACTION" ]]; then
        local index
        index="$(find_action_index "$REQUESTED_ACTION")" || {
            plain_err "Ação não disponível: $REQUESTED_ACTION"
            list_actions_output
            exit 3
        }
        execute_action_index "$index"
        exit $?
    fi

    if [[ ! -t 0 || ! -t 1 ]]; then
        plain_err "O modo TUI exige um terminal interativo. Use --list-actions ou --action ID."
        exit 2
    fi
    interactive_loop
}

main

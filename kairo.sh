#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════════════════════════════╗
# ║ KAIRO ORCHESTRATOR WEB — CENTRAL OPERACIONAL PREMIUM v1.0.0                ║
# ║ Node.js + Express + frontend estático + SQLite • painel local responsivo   ║
# ║ Streaming real • ações auditáveis • backups • QA • segurança • GitHub      ║
# ╚══════════════════════════════════════════════════════════════════════════════╝
#
# Uso recomendado, a partir da raiz do projeto Kairo:
#   chmod +x kairo-orquestrador-web-premium-v1.0.0.sh
#   ./kairo-orquestrador-web-premium-v1.0.0.sh
#
# Modos adicionais:
#   ./kairo-orquestrador-web-premium-v1.0.0.sh --cli
#   ./kairo-orquestrador-web-premium-v1.0.0.sh --self-test
#   ./kairo-orquestrador-web-premium-v1.0.0.sh --menu-preview
#   ./kairo-orquestrador-web-premium-v1.0.0.sh --project-root /caminho/do/kairo
#
# Garantias:
#   • servidor do painel restrito a 127.0.0.1 e protegido por token de sessão;
#   • backend, frontend e SQLite são tratados conforme a arquitetura real;
#   • ações destrutivas exigem confirmação literal e backup quando aplicável;
#   • stdout/stderr são transmitidos em tempo real para o console Web;
#   • o mesmo catálogo de ações alimenta Web, CLI e automação;
#   • sem CDN, sem dados fictícios e sem dependências visuais externas.

set -Eeuo pipefail
IFS=$'\n\t'

SCRIPT_NAME="Kairo Orchestrator Web"
SCRIPT_VERSION="1.0.0"
DEFAULT_WEB_PORT="8799"
MIN_BASH_MAJOR=4
MIN_BASH_MINOR=4
SCRIPT_PATH="$(readlink -f "${BASH_SOURCE[0]}" 2>/dev/null || printf '%s' "${BASH_SOURCE[0]}")"
SCRIPT_DIR="$(cd "$(dirname "$SCRIPT_PATH")" && pwd -P)"
PROJECT_ROOT_OVERRIDE="${KAIRO_PROJECT_ROOT:-}"
NO_BROWSER=false
WEB_PORT="${KAIRO_ORCHESTRATOR_PORT:-$DEFAULT_WEB_PORT}"

RST='\033[0m'; BOLD='\033[1m'; DIM='\033[2m'
C_PRIMARY='\033[38;2;124;111;255m'; C_SECONDARY='\033[38;2;255;139;90m'
C_ACCENT='\033[38;2;68;225;196m'; C_SUCCESS='\033[38;2;76;201;145m'
C_WARN='\033[38;2;247;190;73m'; C_ERROR='\033[38;2;255;95;112m'
C_MUTED='\033[38;2;151;158;183m'; C_TEXT='\033[38;2;244;246;255m'

ICON_APP='◐'; ICON_OK='✅'; ICON_WARN='⚠️'; ICON_FAIL='❌'; ICON_RUN='▶'; ICON_DB='🗄️'
ICON_TEST='🧪'; ICON_LOCK='🔐'; ICON_GIT='🐙'; ICON_TOOL='🛠️'; ICON_REPORT='📄'
ICON_SERVER='🚀'; ICON_ENV='⚙️'; ICON_PACKAGE='📦'; ICON_HEALTH='🩺'; ICON_BROWSER='🧭'

ui_plain(){ [[ "${NO_COLOR:-}" == "1" || "${TERM:-}" == "dumb" || ! -t 1 ]]; }
c(){ if ui_plain; then printf ''; else printf '%b' "$1"; fi; }
ce(){ if ui_plain; then printf ''; else printf '%b' "$RST"; fi; }
say(){
  local kind="$1" msg="$2" color icon
  case "$kind" in
    ok) color="$C_SUCCESS"; icon="$ICON_OK" ;;
    warn) color="$C_WARN"; icon="$ICON_WARN" ;;
    fail) color="$C_ERROR"; icon="$ICON_FAIL" ;;
    cmd) color="$C_ACCENT"; icon='➜' ;;
    header) color="$C_PRIMARY"; icon="$ICON_APP" ;;
    *) color="$C_SECONDARY"; icon='•' ;;
  esac
  printf '  %b%s %s%b\n' "$(c "$color")" "$icon" "$msg" "$(ce)"
}
line(){ printf '%b%s%b\n' "$(c "$C_MUTED")" '──────────────────────────────────────────────────────────────────────────────' "$(ce)"; }
command_exists(){ command -v "$1" >/dev/null 2>&1; }
json_escape(){ local s="${1:-}"; s="${s//\\/\\\\}"; s="${s//\"/\\\"}"; s="${s//$'\n'/\\n}"; s="${s//$'\r'/}"; printf '%s' "$s"; }
format_bytes(){
  local bytes="${1:-0}"
  awk -v b="$bytes" 'BEGIN{split("B KB MB GB TB",u," ");i=1;while(b>=1024&&i<5){b/=1024;i++}if(i==1)printf "%d %s",b,u[i];else printf "%.1f %s",b,u[i]}'
}
sha256_file(){ sha256sum "$1" 2>/dev/null | awk '{print $1}'; }
require_bash_version(){
  local major="${BASH_VERSINFO[0]}" minor="${BASH_VERSINFO[1]}"
  if (( major < MIN_BASH_MAJOR || (major == MIN_BASH_MAJOR && minor < MIN_BASH_MINOR) )); then
    say fail "Bash ${MIN_BASH_MAJOR}.${MIN_BASH_MINOR}+ é obrigatório. Atual: ${major}.${minor}."
    exit 1
  fi
}
valid_port(){ [[ "${1:-}" =~ ^[0-9]+$ ]] && (( $1 >= 1 && $1 <= 65535 )); }

find_project_root_from(){
  local cursor="$1" i
  [[ -d "$cursor" ]] || return 1
  cursor="$(cd "$cursor" && pwd -P)"
  for ((i=0; i<8; i++)); do
    if [[ -f "$cursor/package.json" && -f "$cursor/src/server/index.js" && -d "$cursor/public" ]]; then
      if command_exists node; then
        local name
        name="$(node -e "try{const p=require(process.argv[1]);process.stdout.write(String(p.name||''))}catch{}" "$cursor/package.json" 2>/dev/null || true)"
        [[ "$name" == "kairo" ]] && { printf '%s' "$cursor"; return 0; }
      else
        grep -q '"name"[[:space:]]*:[[:space:]]*"kairo"' "$cursor/package.json" 2>/dev/null && { printf '%s' "$cursor"; return 0; }
      fi
    fi
    [[ "$cursor" == "/" ]] && break
    cursor="$(dirname "$cursor")"
  done
  return 1
}

resolve_project_root(){
  local candidate=""
  if [[ -n "$PROJECT_ROOT_OVERRIDE" ]]; then
    candidate="$(find_project_root_from "$PROJECT_ROOT_OVERRIDE" 2>/dev/null || true)"
  fi
  [[ -n "$candidate" ]] || candidate="$(find_project_root_from "$PWD" 2>/dev/null || true)"
  [[ -n "$candidate" ]] || candidate="$(find_project_root_from "$SCRIPT_DIR" 2>/dev/null || true)"
  [[ -n "$candidate" ]] || candidate="$(find_project_root_from "$SCRIPT_DIR/../.." 2>/dev/null || true)"
  if [[ -z "$candidate" ]]; then
    say fail "Não localizei a raiz do Kairo. Execute o arquivo na raiz do projeto ou use --project-root."
    return 1
  fi
  PROJECT_ROOT="$candidate"
  STATE_DIR="$PROJECT_ROOT/.orchestrator/kairo-web"
  PID_FILE="$STATE_DIR/server.pid"
  META_FILE="$STATE_DIR/server.meta"
  SERVER_LOG="$STATE_DIR/server.log"
  LOCK_FILE="$STATE_DIR/orchestrator.lock"
  cd "$PROJECT_ROOT"
}

ensure_state_dir(){ mkdir -p "$STATE_DIR"; chmod 700 "$PROJECT_ROOT/.orchestrator" "$STATE_DIR" 2>/dev/null || true; }
package_value(){
  local expression="$1"
  command_exists node || return 1
  node -e "const p=require(process.argv[1]);const v=($expression);if(v!==undefined&&v!==null)process.stdout.write(String(v))" "$PROJECT_ROOT/package.json"
}
package_has_script(){
  local script="$1"
  command_exists node || return 1
  node -e "const p=require(process.argv[1]);process.exit(p.scripts&&p.scripts[process.argv[2]]?0:1)" "$PROJECT_ROOT/package.json" "$script"
}

read_env_value(){
  local key="$1" file="$PROJECT_ROOT/.env" value=""
  [[ -f "$file" ]] || return 1
  value="$(awk -v k="$key" '
    /^[[:space:]]*#/ {next}
    {line=$0; sub(/^[[:space:]]*/,"",line); if(index(line,k"=")==1){sub(/^[^=]*=/,"",line); print line; exit}}
  ' "$file" 2>/dev/null || true)"
  value="${value%$'\r'}"
  if [[ "$value" == \"*\" && "$value" == *\" ]]; then value="${value:1:${#value}-2}"; fi
  if [[ "$value" == \'*\' && "$value" == *\' ]]; then value="${value:1:${#value}-2}"; fi
  printf '%s' "$value"
}
project_port(){ local p; p="$(read_env_value PORT 2>/dev/null || true)"; valid_port "$p" || p="${PORT:-3000}"; valid_port "$p" || p=3000; printf '%s' "$p"; }
project_host(){ local h; h="$(read_env_value HOST 2>/dev/null || true)"; [[ -n "$h" ]] || h="127.0.0.1"; printf '%s' "$h"; }
database_path(){
  local configured
  configured="$(read_env_value KAIRO_DB_PATH 2>/dev/null || true)"
  if [[ -z "$configured" ]]; then printf '%s/storage/database/kairo.sqlite' "$PROJECT_ROOT"
  elif [[ "$configured" == /* ]]; then printf '%s' "$configured"
  else printf '%s/%s' "$PROJECT_ROOT" "$configured"
  fi
}

process_start_ticks(){ local pid="$1"; awk '{print $22}' "/proc/$pid/stat" 2>/dev/null || true; }
process_group_id(){ local pid="$1"; ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true; }
load_server_meta(){
  SERVER_PID=""; SERVER_TICKS=""; SERVER_PGID=""; SERVER_MODE=""; SERVER_PORT=""
  [[ -f "$META_FILE" ]] || return 1
  # shellcheck disable=SC1090
  source "$META_FILE" 2>/dev/null || return 1
}
server_owned(){
  load_server_meta || return 1
  [[ "$SERVER_PID" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$SERVER_PID" 2>/dev/null || return 1
  [[ "$(process_start_ticks "$SERVER_PID")" == "$SERVER_TICKS" ]] || return 1
  local cwd cmd
  cwd="$(readlink -f "/proc/$SERVER_PID/cwd" 2>/dev/null || true)"
  cmd="$(tr '\0' ' ' < "/proc/$SERVER_PID/cmdline" 2>/dev/null || true)"
  [[ "$cwd" == "$PROJECT_ROOT" ]] || return 1
  [[ "$cmd" == *npm* || "$cmd" == *node* || "$cmd" == *nodemon* ]] || return 1
  return 0
}
port_listener(){
  local port="$1"
  if command_exists lsof; then lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -1
  elif command_exists ss; then ss -ltnp 2>/dev/null | awk -v p=":$port" '$4 ~ p"$" {print $0; exit}'
  fi
}
http_ok(){ local url="$1"; command_exists curl && curl -fsS --max-time 3 "$url" >/dev/null 2>&1; }

run_external(){
  local description="$1"; shift
  say cmd "$description"
  set +e
  "$@" 2>&1 | while IFS= read -r output; do printf '    %s\n' "$output"; done
  local status=${PIPESTATUS[0]}
  set -e
  if (( status == 0 )); then say ok "$description concluído."
  else say fail "$description falhou com código $status."; fi
  return "$status"
}
run_shell(){
  local description="$1" command_text="$2"
  say cmd "$description"
  set +e
  bash -lc "cd $(printf '%q' "$PROJECT_ROOT") && $command_text" 2>&1 | while IFS= read -r output; do printf '    %s\n' "$output"; done
  local status=${PIPESTATUS[0]}
  set -e
  if (( status == 0 )); then say ok "$description concluído."
  else say fail "$description falhou com código $status."; fi
  return "$status"
}
require_confirmation(){
  local expected="$1"
  if [[ "${KAIRO_ORCH_CONFIRM:-}" != "$expected" ]]; then
    say fail "Confirmação obrigatória ausente. Informe exatamente: $expected"
    return 1
  fi
}

ACTION_IDS=(); ACTION_TITLES=(); ACTION_GROUPS=(); ACTION_RISKS=(); ACTION_DESCS=(); ACTION_ICONS=(); ACTION_CONFIRMS=()
ACTIONS_INITIALIZED=false
register_action(){ ACTION_IDS+=("$1"); ACTION_TITLES+=("$2"); ACTION_GROUPS+=("$3"); ACTION_RISKS+=("$4"); ACTION_DESCS+=("$5"); ACTION_ICONS+=("$6"); ACTION_CONFIRMS+=("${7:-}"); }
init_actions(){
  [[ "$ACTIONS_INITIALIZED" == true ]] && return 0
  ACTION_IDS=(); ACTION_TITLES=(); ACTION_GROUPS=(); ACTION_RISKS=(); ACTION_DESCS=(); ACTION_ICONS=(); ACTION_CONFIRMS=()

  register_action project_overview "Visão geral do projeto" "Diagnóstico" "leitura" "Arquitetura, versões, diretórios, scripts e estado operacional real do Kairo." "🔭"
  register_action prerequisites "Validar pré-requisitos" "Diagnóstico" "leitura" "Verifica Bash, Node.js, npm, Python, Git, curl, permissões e espaço em disco." "$ICON_HEALTH"
  register_action env_status "Auditar configuração" "Ambiente" "leitura" "Valida .env, rede local, cookies, integrações e riscos sem exibir segredos." "$ICON_ENV"
  register_action env_create "Criar .env seguro" "Ambiente" "seguro" "Cria um .env local mínimo, funcional e protegido, sem credenciais fictícias." "🧬"
  register_action runtime_prepare "Preparar diretórios" "Ambiente" "seguro" "Cria storage/database, backups, logs e secrets com permissões restritivas." "$ICON_TOOL"
  register_action integrations_status "Status das integrações" "Ambiente" "leitura" "Verifica Google Agenda, IA e pagamentos com valores sensíveis mascarados." "🔌"

  register_action deps_install "Instalar dependências" "Dependências" "seguro" "Executa npm ci quando existe lockfile; caso contrário, npm install." "$ICON_PACKAGE"
  register_action deps_verify "Validar dependências" "Dependências" "leitura" "Executa npm ls e confirma os módulos essenciais do Kairo." "🧩"
  register_action deps_audit "Auditar vulnerabilidades" "Dependências" "leitura" "Executa npm audit com o lockfile vigente e preserva o código de saída." "$ICON_LOCK"
  register_action deps_outdated "Listar atualizações" "Dependências" "leitura" "Executa npm outdated sem atualizar silenciosamente nenhum pacote." "🛰️"

  register_action server_status "Status da aplicação" "Execução" "leitura" "Mostra processo, PID, porta, URL, saúde e últimas linhas do servidor." "$ICON_SERVER"
  register_action server_start "Iniciar produção local" "Execução" "seguro" "Inicializa npm start em segundo plano e confirma /api/health." "$ICON_RUN"
  register_action server_start_dev "Iniciar desenvolvimento" "Execução" "seguro" "Inicializa npm run dev com Nodemon e confirma /api/health." "⚡"
  register_action server_stop "Encerrar aplicação" "Execução" "atenção" "Encerra somente o grupo de processo iniciado por este orquestrador." "🛑" "ENCERRAR-KAIRO"
  register_action server_restart "Reiniciar aplicação" "Execução" "atenção" "Encerra com segurança e inicia novamente no modo registrado." "🔄" "REINICIAR-KAIRO"
  register_action app_health "Health check completo" "Execução" "leitura" "Valida processo, porta, endpoint, banco e resposta HTTP do Kairo." "$ICON_HEALTH"
  register_action server_logs "Consultar logs" "Execução" "leitura" "Exibe as últimas 160 linhas do processo iniciado pelo orquestrador." "📟"
  register_action browser_open "Abrir Kairo" "Execução" "leitura" "Abre a URL real da aplicação no navegador padrão do ambiente." "$ICON_BROWSER"

  register_action db_status "Resumo do banco" "Banco de dados" "leitura" "Exibe arquivo, tamanho, tabelas, registros, WAL e migrations aplicadas." "$ICON_DB"
  register_action db_integrity "Verificar integridade" "Banco de dados" "leitura" "Executa PRAGMA integrity_check e foreign_key_check em modo somente leitura." "🛡️"
  register_action db_migration_status "Status das migrations" "Banco de dados" "leitura" "Confere schema_migrations e o contrato 001 de isolamento multiusuário." "🧭"
  register_action db_bootstrap "Aplicar bootstrap/migrations" "Banco de dados" "atenção" "Executa o runtime oficial para aplicar migrações e sementes idempotentes." "🌱" "APLICAR-MIGRATIONS"
  register_action db_backup "Criar backup validado" "Banco de dados" "seguro" "Cria backup consistente, valida integridade e registra SHA-256." "💾"
  register_action db_backups "Listar backups" "Banco de dados" "leitura" "Lista backups reais por data, tamanho e hash abreviado." "🗂️"
  register_action db_restore_latest "Restaurar último backup" "Banco de dados" "alto" "Valida o backup mais recente, cria cópia de segurança e restaura atomicamente." "♻️" "RESTAURAR-BANCO"
  register_action db_reset "Reiniciar banco" "Banco de dados" "alto" "Cria backup obrigatório e remove banco, WAL e SHM para novo bootstrap." "🧨" "ZERAR-BANCO"

  register_action test_unit "Testes unitários" "Qualidade e QA" "leitura" "Executa a suíte unitária oficial do package.json." "$ICON_TEST"
  register_action test_integration "Testes de integração" "Qualidade e QA" "leitura" "Executa integrações reais com banco isolado de teste." "$ICON_TEST"
  register_action test_migration "Testes de migration" "Qualidade e QA" "leitura" "Valida migração, integridade e isolamento multiusuário." "🧬"
  register_action test_frontend "Testes de frontend" "Qualidade e QA" "leitura" "Executa os guardiões de segurança e contrato do frontend." "🖥️"
  register_action test_e2e "QA navegada E2E" "Qualidade e QA" "leitura" "Executa Playwright/Chromium sobre servidor e banco temporários." "🎭"
  register_action lint "ESLint" "Qualidade e QA" "leitura" "Executa lint com zero warnings permitidos." "🧹"
  register_action format_check "Prettier check" "Qualidade e QA" "leitura" "Valida formatação sem alterar arquivos." "🧾"
  register_action syntax_check "Sintaxe JavaScript" "Qualidade e QA" "leitura" "Executa o verificador de sintaxe oficial do projeto." "🔎"
  register_action coverage "Cobertura" "Qualidade e QA" "leitura" "Executa C8 e aplica os limites mínimos definidos pelo Kairo." "📈"
  register_action quality_check "Validação completa" "Qualidade e QA" "leitura" "Executa lint, formato, sintaxe, testes, cobertura e política do repositório." "🏅"
  register_action quality_full "Validação total + E2E" "Qualidade e QA" "leitura" "Executa o ciclo completo, incluindo QA navegada Playwright." "💎"

  register_action security_repository "Política do repositório" "Segurança" "leitura" "Detecta segredos, bancos, chaves e artefatos proibidos no conteúdo versionável." "$ICON_LOCK"
  register_action security_full "Auditoria de segurança" "Segurança" "leitura" "Combina política do repositório, npm audit e configuração crítica." "🛡️"
  register_action cleanup_artifacts "Limpar artefatos de QA" "Manutenção" "atenção" "Remove somente coverage, test-results, playwright-report e temporários conhecidos." "🧹" "LIMPAR-ARTEFATOS"
  register_action diagnostics_export "Exportar diagnóstico" "Manutenção" "leitura" "Gera relatório temporário sanitizado, sem banco, token, cookie ou chave." "$ICON_REPORT"

  register_action git_status "Status Git" "GitHub" "leitura" "Exibe branch, remoto, divergência e alterações locais sem modificar o repositório." "$ICON_GIT"
  register_action git_pull_main "Sincronizar main" "GitHub" "atenção" "Executa fetch e pull --rebase --autostash de origin/main." "⬇️" "SINCRONIZAR-MAIN"
  register_action git_publish_main "Commit e push no main" "GitHub" "alto" "Valida main, executa checks, cria commit da tarefa e envia para origin/main." "⬆️" "PUBLICAR-MAIN"

  register_action all_prepare "Preparar Kairo completo" "Fluxos completos" "lote" "Ambiente, diretórios, dependências, configuração, bootstrap e health check." "✨" "PREPARAR-TUDO"
  register_action all_validate "Validar Kairo completo" "Fluxos completos" "lote" "Diagnóstico, banco, segurança, qualidade e E2E em uma execução rastreável." "🏆" "VALIDAR-TUDO"
  register_action all_start "Preparar e iniciar" "Fluxos completos" "lote" "Prepara integralmente o ambiente e inicia o Kairo após todas as validações essenciais." "🚀" "INICIAR-TUDO"

  ACTIONS_INITIALIZED=true
}

action_index(){ local id="$1" i; init_actions; for i in "${!ACTION_IDS[@]}"; do [[ "${ACTION_IDS[$i]}" == "$id" ]] && { printf '%s' "$i"; return 0; }; done; return 1; }
action_title(){ local i; i="$(action_index "$1" 2>/dev/null || true)"; [[ -n "$i" ]] && printf '%s' "${ACTION_TITLES[$i]}" || printf '%s' "$1"; }
list_actions_json(){
  init_actions
  local i comma=""
  printf '['
  for i in "${!ACTION_IDS[@]}"; do
    printf '%s{"id":"%s","number":%d,"title":"%s","group":"%s","risk":"%s","description":"%s","icon":"%s","confirm":"%s"}' \
      "$comma" "$(json_escape "${ACTION_IDS[$i]}")" "$((i+1))" "$(json_escape "${ACTION_TITLES[$i]}")" \
      "$(json_escape "${ACTION_GROUPS[$i]}")" "$(json_escape "${ACTION_RISKS[$i]}")" \
      "$(json_escape "${ACTION_DESCS[$i]}")" "$(json_escape "${ACTION_ICONS[$i]}")" "$(json_escape "${ACTION_CONFIRMS[$i]}")"
    comma=','
  done
  printf ']\n'
}
menu_preview(){ init_actions; local i group=""; for i in "${!ACTION_IDS[@]}"; do if [[ "$group" != "${ACTION_GROUPS[$i]}" ]]; then group="${ACTION_GROUPS[$i]}"; printf '\n[%s]\n' "$group"; fi; printf '%02d  %-26s  %-30s [%s]\n' "$((i+1))" "${ACTION_IDS[$i]}" "${ACTION_TITLES[$i]}" "${ACTION_RISKS[$i]}"; done; }

step_project_overview(){
  local db port host version scripts total_files
  db="$(database_path)"; port="$(project_port)"; host="$(project_host)"
  version="$(package_value 'p.version' 2>/dev/null || echo desconhecida)"
  scripts="$(node -e "const p=require('./package.json');console.log(Object.keys(p.scripts||{}).join(', '))" 2>/dev/null || true)"
  total_files="$(find . -type f -not -path './node_modules/*' -not -path './.git/*' -not -path './storage/*' -not -path './.orchestrator/*' | wc -l | tr -d ' ')"
  echo "Projeto: Kairo v$version"
  echo "Raiz: $PROJECT_ROOT"
  echo "Arquitetura: Node.js + Express + frontend estático + SQLite"
  echo "Entrada: src/server/index.js"
  echo "Frontend: public/ servido pelo Express"
  echo "Banco: $db"
  echo "URL prevista: http://$host:$port"
  echo "Arquivos versionáveis aproximados: $total_files"
  echo "Scripts npm: $scripts"
  echo "Node: $(node -v 2>/dev/null || echo ausente)"
  echo "npm: $(npm -v 2>/dev/null || echo ausente)"
  echo "Git: $(git --version 2>/dev/null || echo ausente)"
  if server_owned; then echo "Servidor: ativo (PID $SERVER_PID, modo $SERVER_MODE, porta $SERVER_PORT)"; else echo "Servidor: não gerenciado ou inativo"; fi
  [[ -f "$PROJECT_ROOT/.env" ]] && echo ".env: presente" || echo ".env: ausente"
  [[ -d "$PROJECT_ROOT/node_modules" ]] && echo "node_modules: presente" || echo "node_modules: ausente"
}

step_prerequisites(){
  local failed=0 available_kb
  echo "Sistema: $(uname -srm 2>/dev/null || echo desconhecido)"
  echo "Bash: ${BASH_VERSION}"
  for bin in node npm python3 git curl flock sha256sum awk sed; do
    if command_exists "$bin"; then printf 'OK  %-12s %s\n' "$bin" "$(command -v "$bin")"; else printf 'FALHA %-10s ausente\n' "$bin"; failed=1; fi
  done
  if command_exists node; then
    node -e 'const [M,m]=process.versions.node.split(".").map(Number); if(M<20||(M===20&&m<9)){console.error("Node.js 20.9+ é obrigatório.");process.exit(1)} console.log(`Node compatível: ${process.version}`)' || failed=1
  fi
  if command_exists npm; then
    npm -v | awk -F. '{if($1<10){print "npm 10+ é obrigatório.";exit 1}else print "npm compatível: "$0}' || failed=1
  fi
  [[ -r "$PROJECT_ROOT/package.json" && -w "$PROJECT_ROOT" ]] || { echo "A raiz precisa ser legível e gravável."; failed=1; }
  available_kb="$(df -Pk "$PROJECT_ROOT" | awk 'NR==2{print $4+0}')"
  echo "Espaço disponível: $(format_bytes "$((available_kb*1024))")"
  (( available_kb >= 524288 )) || { echo "Aviso: menos de 512 MB disponíveis."; failed=1; }
  return "$failed"
}

step_runtime_prepare(){
  mkdir -p storage/database storage/backups storage/logs storage/secrets "$STATE_DIR"
  chmod 700 storage storage/database storage/backups storage/logs storage/secrets "$PROJECT_ROOT/.orchestrator" "$STATE_DIR" 2>/dev/null || true
  for dir in storage storage/database storage/backups storage/logs storage/secrets "$STATE_DIR"; do [[ -d "$dir" && -w "$dir" ]] || { say fail "Diretório indisponível: $dir"; return 1; }; done
  say ok "Diretórios operacionais preparados e graváveis."
}

step_env_create(){
  local env_file="$PROJECT_ROOT/.env"
  if [[ -e "$env_file" ]]; then say warn ".env já existe e não foi sobrescrito."; return 0; fi
  umask 077
  cat > "$env_file" <<'ENV'
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
TRUST_PROXY=false
COOKIE_NAME=kairo.session
COOKIE_SECURE=false
COOKIE_HTTP_ONLY=true
COOKIE_SAME_SITE=lax
SESSION_TTL_SECONDS=28800
JSON_BODY_LIMIT=1mb
URLENCODED_BODY_LIMIT=256kb
AVATAR_BODY_LIMIT=3mb
KAIRO_DB_PATH=storage/database/kairo.sqlite
MIGRATION_OWNER_EMAIL=
SEED_ADMIN_ENABLED=false
SEED_ADMIN_NAME=
SEED_ADMIN_EMAIL=
SEED_ADMIN_PASSWORD=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=
GOOGLE_CALENDAR_ID=primary
GOOGLE_CALENDAR_TIMEZONE=America/Sao_Paulo
PAYMENTS_WEBHOOK_SECRET=
AI_PROVIDER=
AI_BASE_URL=
AI_API_KEY=
AI_MODEL=
ENV
  chmod 600 "$env_file" 2>/dev/null || true
  say ok ".env seguro criado. Segredos criptográficos serão materializados pelo runtime em storage/secrets."
}

step_env_status(){
  node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const file=path.resolve('.env');
function parseEnv(text){
  const result={};
  for(const sourceLine of text.split(/\r?\n/)){
    const line=sourceLine.trim();
    if(!line||line.startsWith('#')) continue;
    const index=line.indexOf('=');
    if(index<1) continue;
    const key=line.slice(0,index).trim();
    let value=line.slice(index+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))) value=value.slice(1,-1);
    result[key]=value;
  }
  return result;
}
const raw=fs.existsSync(file)?parseEnv(fs.readFileSync(file,'utf8')):{};
const value=(k,fallback='')=>String(raw[k]??process.env[k]??fallback).trim();
const bool=(k,fallback)=>['true','1','yes','on','sim'].includes(value(k,String(fallback)).toLowerCase());
const issues=[];
const nodeEnv=value('NODE_ENV','development');
const host=value('HOST','127.0.0.1');
const port=Number(value('PORT','3000'));
const sameSite=value('COOKIE_SAME_SITE','lax');
const secure=bool('COOKIE_SECURE',nodeEnv==='production');
const httpOnly=bool('COOKIE_HTTP_ONLY',true);
if(!['development','test','production'].includes(nodeEnv)) issues.push('NODE_ENV inválido.');
if(!Number.isInteger(port)||port<1||port>65535) issues.push('PORT inválida.');
if(!httpOnly) issues.push('COOKIE_HTTP_ONLY precisa permanecer true.');
if(sameSite==='none'&&!secure) issues.push('SameSite=None exige COOKIE_SECURE=true.');
if(nodeEnv==='production'&&!secure) issues.push('Produção exige cookie seguro.');
if(nodeEnv==='production'&&(host==='127.0.0.1'||host==='localhost')) issues.push('Produção está restrita a loopback; confirme se é intencional.');
const seedEnabled=value('SEED_ADMIN_ENABLED','true').toLowerCase()!=='false';
const seedEmail=value('SEED_ADMIN_EMAIL','admin@admin.com');
const seedPassword=value('SEED_ADMIN_PASSWORD','Admin123#');
// O alerta compara com as credenciais versionadas: o risco não é a senha ser
// fraca, e sim ser pública. Qualquer uma delas intacta mantém o aviso de pé.
if(seedEnabled&&(seedEmail==='admin@admin.com'||seedPassword==='Admin123#')) issues.push('Administrador automático usa credencial padrão insegura; defina SEED_ADMIN_ENABLED=false ou credenciais fortes.');
for(const origin of value('CORS_ORIGINS',`http://127.0.0.1:${port},http://localhost:${port}`).split(',').map(v=>v.trim()).filter(Boolean)){
  if(origin==='*') issues.push('CORS não pode usar origem universal (*).');
  else { try { const u=new URL(origin); if(origin!==u.origin||!['http:','https:'].includes(u.protocol)) throw new Error(); } catch { issues.push(`Origem CORS inválida: ${origin}`); } }
}
console.log(`Arquivo .env: ${fs.existsSync(file)?'presente':'ausente; padrões seguros do código serão avaliados'}`);
console.log(`Ambiente: ${nodeEnv}`);
console.log(`Escuta: http://${host}:${port}`);
console.log(`Cookie: httpOnly=${httpOnly}, secure=${secure}, sameSite=${sameSite}`);
console.log(`Banco: ${value('KAIRO_DB_PATH','storage/database/kairo.sqlite')}`);
console.log(`Administrador automático: ${seedEnabled?'habilitado':'desabilitado'}`);
if(issues.length){ console.log('\nInconsistências:'); issues.forEach((v,i)=>console.log(`${i+1}. ${v}`)); process.exitCode=1; }
else console.log('\nConfiguração essencial coerente.');
NODE
}

step_integrations_status(){
  node --input-type=module <<'NODE'
import fs from 'node:fs';
function parseEnv(text){const result={};for(const sourceLine of text.split(/\r?\n/)){const line=sourceLine.trim();if(!line||line.startsWith('#'))continue;const index=line.indexOf('=');if(index<1)continue;const key=line.slice(0,index).trim();let value=line.slice(index+1).trim();if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);result[key]=value}return result}
const env=fs.existsSync('.env')?parseEnv(fs.readFileSync('.env','utf8')):{};
const get=(k)=>String(env[k]??process.env[k]??'').trim();
const mask=(v)=>!v?'ausente':v.length<8?'configurado':`${v.slice(0,4)}…${v.slice(-3)}`;
const group=(name, keys)=>{const configured=keys.filter(k=>get(k)); console.log(`${name}: ${configured.length===keys.length?'configurada':configured.length?'parcial':'não configurada'}`); for(const k of keys) console.log(`  ${k}: ${mask(get(k))}`)};
group('Google Agenda',['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI']);
group('Pagamentos',['PAYMENTS_WEBHOOK_SECRET']);
const aiKeys=['AI_PROVIDER','AI_BASE_URL','AI_API_KEY','AI_MODEL'];
group('Inteligência Artificial',aiKeys);
console.log(`Timezone Google: ${get('GOOGLE_CALENDAR_TIMEZONE')||'America/Sao_Paulo'}`);
NODE
}

step_deps_install(){
  step_prerequisites >/dev/null || { say fail "Corrija os pré-requisitos antes da instalação."; return 1; }
  local -a npm_env=(env npm_config_fetch_retries=5 npm_config_fetch_retry_factor=2 npm_config_fetch_retry_mintimeout=3000 npm_config_fetch_retry_maxtimeout=30000)
  if [[ -f package-lock.json ]]; then
    run_external "Instalando árvore reproduzível com npm ci e repetição controlada" "${npm_env[@]}" npm ci --no-audit --no-fund
  else
    run_external "Instalando dependências com npm install e repetição controlada" "${npm_env[@]}" npm install --no-audit --no-fund
  fi
}
step_deps_verify(){
  [[ -d node_modules ]] || { say fail "node_modules ausente. Execute Instalar dependências."; return 1; }
  run_external "Validando árvore npm" npm ls --all
  node --input-type=module <<'NODE'
const modules=['express','better-sqlite3','dotenv','zod','helmet','jsonwebtoken'];
for(const name of modules){try{await import(name);console.log(`OK ${name}`)}catch(e){console.error(`FALHA ${name}: ${e.message}`);process.exitCode=1}}
NODE
}
step_deps_audit(){ run_external "Executando npm audit" npm audit; }
step_deps_outdated(){ set +e; npm outdated; local code=$?; set -e; ((code==0||code==1)); }

wait_for_health(){
  local port="$1" attempts="${2:-50}" url="http://127.0.0.1:${port}/api/health" i
  for ((i=1;i<=attempts;i++)); do if http_ok "$url"; then return 0; fi; sleep .5; done
  return 1
}

start_server_mode(){
  local mode="$1" script port listener pid pgid ticks
  ensure_state_dir
  [[ -d node_modules ]] || step_deps_install
  if server_owned; then say warn "Kairo já está ativo no PID $SERVER_PID."; return 0; fi
  port="$(project_port)"
  listener="$(port_listener "$port" || true)"
  if [[ -n "$listener" ]]; then say fail "A porta $port já está ocupada por processo não gerenciado: $listener"; return 1; fi
  script="start"; [[ "$mode" == "development" ]] && script="dev"
  package_has_script "$script" || { say fail "Script npm ausente: $script"; return 1; }
  : > "$SERVER_LOG"; chmod 600 "$SERVER_LOG" 2>/dev/null || true
  say cmd "Iniciando Kairo em modo $mode na porta $port"
  if command_exists setsid; then
    setsid env PORT="$port" npm run "$script" >>"$SERVER_LOG" 2>&1 < /dev/null &
  else
    env PORT="$port" npm run "$script" >>"$SERVER_LOG" 2>&1 < /dev/null &
  fi
  pid=$!; sleep .15
  pgid="$(process_group_id "$pid")"; [[ "$pgid" =~ ^[0-9]+$ ]] || pgid="$pid"
  ticks="$(process_start_ticks "$pid")"
  cat > "$META_FILE" <<META
SERVER_PID=$pid
SERVER_TICKS=$ticks
SERVER_PGID=$pgid
SERVER_MODE=$mode
SERVER_PORT=$port
SERVER_STARTED_AT=$(date +%s)
META
  printf '%s\n' "$pid" > "$PID_FILE"
  if wait_for_health "$port" 60; then
    say ok "Kairo disponível em http://127.0.0.1:$port (PID $pid)."
    return 0
  fi
  say fail "O endpoint /api/health não respondeu após 30 segundos."
  tail -80 "$SERVER_LOG" 2>/dev/null || true
  KAIRO_ORCH_CONFIRM=ENCERRAR-KAIRO step_server_stop_internal || true
  return 1
}
step_server_start(){ start_server_mode production; }
step_server_start_dev(){ start_server_mode development; }

step_server_stop_internal(){
  ensure_state_dir
  if ! server_owned; then rm -f "$PID_FILE" "$META_FILE"; say warn "Nenhum processo gerenciado ativo."; return 0; fi
  local pid="$SERVER_PID" pgid="$SERVER_PGID" i
  say cmd "Encerrando grupo do Kairo (PID $pid, PGID $pgid)"
  if [[ "$pgid" =~ ^[0-9]+$ ]]; then kill -TERM -- "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  else kill -TERM "$pid" 2>/dev/null || true; fi
  for ((i=0;i<40;i++)); do kill -0 "$pid" 2>/dev/null || break; sleep .25; done
  if kill -0 "$pid" 2>/dev/null; then
    say warn "Encerramento gracioso excedeu 10 segundos; aplicando SIGKILL ao processo validado."
    if [[ "$pgid" =~ ^[0-9]+$ ]]; then kill -KILL -- "-$pgid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    else kill -KILL "$pid" 2>/dev/null || true; fi
  fi
  rm -f "$PID_FILE" "$META_FILE"
  say ok "Aplicação encerrada."
}
step_server_stop(){ require_confirmation ENCERRAR-KAIRO; step_server_stop_internal; }
step_server_restart(){
  require_confirmation REINICIAR-KAIRO
  local mode=production
  if server_owned; then mode="$SERVER_MODE"; KAIRO_ORCH_CONFIRM=ENCERRAR-KAIRO step_server_stop_internal; fi
  start_server_mode "$mode"
}
step_server_status(){
  local port url
  port="$(project_port)"; url="http://127.0.0.1:$port"
  if server_owned; then
    echo "Estado: ativo e gerenciado"
    echo "PID: $SERVER_PID | PGID: $SERVER_PGID | modo: $SERVER_MODE | porta: $SERVER_PORT"
    echo "URL: http://127.0.0.1:$SERVER_PORT"
    if http_ok "http://127.0.0.1:$SERVER_PORT/api/health"; then echo "API: saudável"; else echo "API: processo ativo, endpoint indisponível"; fi
  else
    echo "Estado: inativo ou iniciado fora deste orquestrador"
    echo "Porta prevista: $port"
    local listener; listener="$(port_listener "$port" || true)"; [[ -n "$listener" ]] && echo "Listener externo: $listener" || echo "Porta livre"
  fi
  [[ -f "$SERVER_LOG" ]] && { echo; echo "Últimas linhas:"; tail -30 "$SERVER_LOG"; }
}
step_app_health(){
  local port db failed=0
  port="$(project_port)"; db="$(database_path)"
  [[ -f package.json ]] && echo "OK package.json" || { echo "FALHA package.json"; failed=1; }
  [[ -f src/server/index.js ]] && echo "OK servidor" || { echo "FALHA servidor"; failed=1; }
  [[ -f public/index.html ]] && echo "OK frontend" || { echo "FALHA frontend"; failed=1; }
  [[ -d node_modules ]] && echo "OK dependências" || { echo "FALHA dependências"; failed=1; }
  if server_owned; then echo "OK processo PID $SERVER_PID"; else echo "AVISO processo não gerenciado/inativo"; fi
  if http_ok "http://127.0.0.1:$port/api/health"; then
    echo "OK GET /api/health"
    curl -fsS --max-time 4 "http://127.0.0.1:$port/api/health" | head -c 1200; echo
  else echo "FALHA GET /api/health"; failed=1; fi
  if [[ -f "$db" ]]; then KAIRO_DB_READONLY=1 step_db_integrity || failed=1; else echo "AVISO banco ainda não criado"; fi
  return "$failed"
}
step_server_logs(){ [[ -f "$SERVER_LOG" ]] && tail -160 "$SERVER_LOG" || say warn "Nenhum log de servidor gerenciado disponível."; }
step_browser_open(){
  local url="http://127.0.0.1:$(project_port)"
  if command_exists wslview; then wslview "$url" >/dev/null 2>&1 &
  elif command_exists explorer.exe; then explorer.exe "$url" >/dev/null 2>&1 &
  elif command_exists xdg-open; then xdg-open "$url" >/dev/null 2>&1 &
  elif command_exists open; then open "$url" >/dev/null 2>&1 &
  else say warn "Abra manualmente: $url"; return 0; fi
  say ok "Navegador solicitado para $url"
}

require_database(){ local db; db="$(database_path)"; [[ -f "$db" ]] || { say fail "Banco não encontrado: $db"; return 1; }; }
require_sqlite_driver(){
  [[ -d "$PROJECT_ROOT/node_modules" ]] || { say fail "Dependências ausentes. Execute 'Instalar dependências' antes das ações SQLite."; return 1; }
  node -e "require.resolve('better-sqlite3')" >/dev/null 2>&1 || { say fail "Módulo better-sqlite3 indisponível. Reinstale e valide as dependências."; return 1; }
}
step_db_status(){
  local db; db="$(database_path)"
  [[ -f "$db" ]] || { say warn "Banco ainda não existe: $db"; return 0; }
  require_sqlite_driver || return 1
  DB_PATH="$db" node --input-type=module <<'NODE'
import fs from 'node:fs'; import Database from 'better-sqlite3';
const file=process.env.DB_PATH;
if(!fs.existsSync(file)){console.log(`Banco ainda não existe: ${file}`);process.exit(0)}
const stat=fs.statSync(file); console.log(`Arquivo: ${file}`); console.log(`Tamanho: ${stat.size} bytes`);
const db=new Database(file,{readonly:true,fileMustExist:true});
try{
 const journal=db.pragma('journal_mode',{simple:true}); console.log(`Journal: ${journal}`);
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(v=>v.name);
 console.log(`Tabelas (${tables.length}): ${tables.join(', ')}`);
 for(const name of tables){const safe='"'+name.replaceAll('"','""')+'"'; const total=db.prepare(`SELECT COUNT(*) AS total FROM ${safe}`).get().total; console.log(`  ${name}: ${total}`)}
 if(tables.includes('schema_migrations')){const rows=db.prepare('SELECT name, applied_at FROM schema_migrations ORDER BY applied_at').all(); console.log('Migrations:'); rows.forEach(r=>console.log(`  ${r.name} — ${r.applied_at}`));}
 for(const suffix of ['-wal','-shm']){const p=file+suffix;if(fs.existsSync(p))console.log(`${suffix.slice(1).toUpperCase()}: ${fs.statSync(p).size} bytes`)}
} finally {db.close()}
NODE
}
step_db_integrity(){
  local db; db="$(database_path)"; require_database || return 1; require_sqlite_driver || return 1
  DB_PATH="$db" node --input-type=module <<'NODE'
import Database from 'better-sqlite3';
const db=new Database(process.env.DB_PATH,{readonly:true,fileMustExist:true});
try{
 const integrity=db.pragma('integrity_check'); const foreign=db.pragma('foreign_key_check');
 console.log('PRAGMA integrity_check:'); integrity.forEach(v=>console.log(`  ${Object.values(v)[0]}`));
 console.log(`Violações de chave estrangeira: ${foreign.length}`); foreign.slice(0,30).forEach(v=>console.log(JSON.stringify(v)));
 const ok=integrity.every(v=>Object.values(v)[0]==='ok')&&foreign.length===0;
 console.log(ok?'Banco íntegro.':'Banco com inconsistências.'); if(!ok)process.exitCode=1;
} finally {db.close()}
NODE
}
step_db_migration_status(){
  local db; db="$(database_path)"
  [[ -f "$db" ]] || { say warn "Banco ausente; a migration será aplicada no primeiro bootstrap."; return 0; }
  require_sqlite_driver || return 1
  DB_PATH="$db" node --input-type=module <<'NODE'
import fs from 'node:fs'; import Database from 'better-sqlite3';
const file=process.env.DB_PATH; const expected='001_isolamento_multiusuario';
if(!fs.existsSync(file)){console.log('Banco ausente; a migration será aplicada no primeiro bootstrap.');process.exit(0)}
const db=new Database(file,{readonly:true,fileMustExist:true});
try{
 const has=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations'").get());
 if(!has){console.log('Tabela schema_migrations ausente.');process.exitCode=1;}
 else {const row=db.prepare('SELECT name, applied_at FROM schema_migrations WHERE name=?').get(expected); if(row)console.log(`Aplicada: ${row.name} em ${row.applied_at}`); else {console.log(`Pendente: ${expected}`);process.exitCode=1;}}
 const required=['users','activities','timeframes','goals','profile_data','agenda_events','google_tokens'];
 const existing=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(v=>v.name));
 const missing=required.filter(v=>!existing.has(v)); console.log(`Tabelas obrigatórias ausentes: ${missing.length?missing.join(', '):'nenhuma'}`); if(missing.length)process.exitCode=1;
} finally {db.close()}
NODE
}
step_db_bootstrap(){
  require_confirmation APLICAR-MIGRATIONS
  step_runtime_prepare
  [[ -d node_modules ]] || step_deps_install
  node --input-type=module <<'NODE'
import { createKairoRuntime } from './src/server/runtime.js';
const logger={info:(v)=>console.log(typeof v==='string'?v:JSON.stringify(v)),error:(...v)=>console.error(...v),warn:(...v)=>console.warn(...v)};
const runtime=await createKairoRuntime({logger});
try{console.log('Status do domínio:',JSON.stringify(runtime.domainStatus()));console.log('Bootstrap, migrations e seeds concluídos pelo runtime oficial.')}finally{runtime.close()}
NODE
  step_db_integrity
}
step_db_backup(){
  local db backup_dir stamp dest
  db="$(database_path)"; require_database || return 1; require_sqlite_driver || return 1
  backup_dir="$PROJECT_ROOT/storage/backups"; mkdir -p "$backup_dir"; chmod 700 "$backup_dir" 2>/dev/null || true
  stamp="$(date -u '+%Y-%m-%dT%H-%M-%SZ')"; dest="$backup_dir/kairo-manual-$stamp.backup.sqlite"
  DB_PATH="$db" BACKUP_PATH="$dest" node --input-type=module <<'NODE'
import fs from 'node:fs'; import path from 'node:path'; import Database from 'better-sqlite3';
const source=process.env.DB_PATH,dest=process.env.BACKUP_PATH; fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});
const db=new Database(source,{fileMustExist:true});
try{await db.backup(dest,{progress({totalPages,remainingPages}){if(totalPages&&remainingPages%500===0)console.log(`Páginas restantes: ${remainingPages}/${totalPages}`)}})}finally{db.close()}
const verify=new Database(dest,{readonly:true,fileMustExist:true}); try{const i=verify.pragma('integrity_check');if(!i.every(v=>Object.values(v)[0]==='ok'))throw new Error('Backup falhou na verificação de integridade.')}finally{verify.close()}
console.log(`Backup validado: ${dest}`);
NODE
  chmod 600 "$dest" 2>/dev/null || true
  echo "SHA-256: $(sha256_file "$dest")"
  echo "Tamanho: $(format_bytes "$(stat -c %s "$dest" 2>/dev/null || echo 0)")"
}
find_latest_backup(){ find "$PROJECT_ROOT/storage/backups" -maxdepth 1 -type f \( -name '*.sqlite' -o -name '*.backup.sqlite' \) ! -name 'restore-safety-*' -printf '%T@\t%p\n' 2>/dev/null | sort -nr | head -1 | cut -f2-; }
step_db_backups(){
  local dir="$PROJECT_ROOT/storage/backups" file count=0 size hash
  [[ -d "$dir" ]] || { say warn "Diretório de backups ainda não existe."; return 0; }
  while IFS= read -r file; do [[ -n "$file" ]] || continue; count=$((count+1)); size="$(stat -c %s "$file" 2>/dev/null || echo 0)"; hash="$(sha256_file "$file")"; printf '%-22s  %10s  %.12s…  %s\n' "$(date -r "$file" '+%Y-%m-%d %H:%M:%S')" "$(format_bytes "$size")" "$hash" "$(basename "$file")"; done < <(find "$dir" -maxdepth 1 -type f \( -name '*.sqlite' -o -name '*.backup.sqlite' \) -printf '%T@\t%p\n' 2>/dev/null | sort -nr | cut -f2-)
  echo "Total: $count backup(s)."
}
step_db_restore_latest(){
  require_confirmation RESTAURAR-BANCO
  local db backup safety tmp
  db="$(database_path)"; backup="$(find_latest_backup)"
  require_sqlite_driver || return 1
  [[ -n "$backup" && -f "$backup" ]] || { say fail "Nenhum backup SQLite encontrado."; return 1; }
  DB_PATH="$backup" node --input-type=module <<'NODE'
import Database from 'better-sqlite3';const db=new Database(process.env.DB_PATH,{readonly:true,fileMustExist:true});try{const i=db.pragma('integrity_check');const f=db.pragma('foreign_key_check');if(!i.every(v=>Object.values(v)[0]==='ok')||f.length)throw new Error('Backup inválido ou inconsistente.');console.log('Backup candidato íntegro.')}finally{db.close()}
NODE
  if server_owned; then KAIRO_ORCH_CONFIRM=ENCERRAR-KAIRO step_server_stop_internal; fi
  mkdir -p "$(dirname "$db")" "$PROJECT_ROOT/storage/backups"
  if [[ -f "$db" ]]; then safety="$PROJECT_ROOT/storage/backups/restore-safety-$(date -u '+%Y-%m-%dT%H-%M-%SZ').sqlite"; cp -- "$db" "$safety"; chmod 600 "$safety" 2>/dev/null || true; echo "Cópia de segurança atual: $safety"; fi
  tmp="${db}.restore.$$"; cp -- "$backup" "$tmp"; chmod 600 "$tmp" 2>/dev/null || true; mv -f -- "$tmp" "$db"; rm -f -- "${db}-wal" "${db}-shm"
  step_db_integrity
  say ok "Banco restaurado atomicamente a partir de $(basename "$backup")."
}
step_db_reset(){
  require_confirmation ZERAR-BANCO
  local db
  db="$(database_path)"
  if server_owned; then KAIRO_ORCH_CONFIRM=ENCERRAR-KAIRO step_server_stop_internal; fi
  if [[ -f "$db" ]]; then step_db_backup; fi
  rm -f -- "$db" "${db}-wal" "${db}-shm"
  say ok "Banco operacional removido após backup. O próximo bootstrap criará uma base nova."
}

run_npm_script(){ local script="$1" label="$2"; package_has_script "$script" || { say fail "Script npm ausente: $script"; return 1; }; [[ -d node_modules ]] || step_deps_install; run_external "$label" npm run "$script"; }
step_test_unit(){ run_npm_script test:unit "Executando testes unitários"; }
step_test_integration(){ run_npm_script test:integration "Executando testes de integração"; }
step_test_migration(){ run_npm_script test:migration "Executando testes de migration"; }
step_test_frontend(){ run_npm_script test:frontend "Executando testes de frontend"; }
step_test_e2e(){ run_npm_script test:e2e "Executando QA navegada Playwright"; }
step_lint(){ run_npm_script lint "Executando ESLint"; }
step_format_check(){ run_npm_script format:check "Validando Prettier"; }
step_syntax_check(){ run_npm_script check:syntax "Validando sintaxe JavaScript"; }
step_coverage(){ run_npm_script coverage "Executando cobertura C8"; }
step_quality_check(){ run_npm_script check "Executando validação completa"; }
step_quality_full(){ run_npm_script check:full "Executando validação total com E2E"; }
step_security_repository(){ run_npm_script security:repository "Validando política do repositório"; }
step_security_full(){ local failed=0; step_env_status || failed=1; step_security_repository || failed=1; step_deps_audit || failed=1; return "$failed"; }
step_cleanup_artifacts(){
  require_confirmation LIMPAR-ARTEFATOS
  local target
  for target in coverage test-results playwright-report artifacts/qa .cache; do
    [[ -e "$PROJECT_ROOT/$target" ]] || continue
    case "$PROJECT_ROOT/$target" in "$PROJECT_ROOT"|/|/home|/root) say fail "Alvo inseguro bloqueado: $target"; return 1;; esac
    rm -rf --one-file-system -- "$PROJECT_ROOT/$target"
    echo "Removido: $target"
  done
  say ok "Artefatos regeneráveis conhecidos foram limpos."
}
step_diagnostics_export(){
  local report
  report="$(mktemp /tmp/kairo-diagnostico.XXXXXX.md)"
  {
    echo '# Kairo — Diagnóstico sanitizado'; echo; echo "- Gerado em: $(date -Is)"; echo "- Orquestrador: $SCRIPT_VERSION"; echo "- Raiz: $PROJECT_ROOT"; echo
    echo '## Projeto'; echo '```'; step_project_overview 2>&1; echo '```'; echo
    echo '## Pré-requisitos'; echo '```'; step_prerequisites 2>&1 || true; echo '```'; echo
    echo '## Configuração'; echo '```'; step_env_status 2>&1 || true; echo '```'; echo
    echo '## Aplicação'; echo '```'; step_server_status 2>&1 || true; echo '```'; echo
    echo '## Banco'; echo '```'; step_db_status 2>&1 || true; echo '```'; echo
    echo '## Git'; echo '```'; step_git_status 2>&1 || true; echo '```'
  } > "$report"
  chmod 600 "$report" 2>/dev/null || true
  say ok "Relatório sanitizado criado: $report"
}

step_git_status(){
  [[ -d .git ]] || { say warn "Esta cópia não contém .git. O arquivo ZIP não preserva o repositório local."; echo "Remoto esperado: https://github.com/ilyra-ai/kairo.git"; return 0; }
  git status --short --branch
  echo; git remote -v
  echo; git log -1 --oneline --decorate
  local branch; branch="$(git branch --show-current)"; echo "Branch atual: ${branch:-destacada}"
  git rev-list --left-right --count origin/main...HEAD 2>/dev/null | awk '{print "Atrás de origin/main: "$1" | À frente: "$2}' || true
}
step_git_pull_main(){
  require_confirmation SINCRONIZAR-MAIN
  [[ -d .git ]] || { say fail "Diretório .git ausente."; return 1; }
  [[ "$(git branch --show-current)" == "main" ]] || { say fail "A publicação direta exige a branch main."; return 1; }
  run_external "Atualizando referências remotas" git fetch origin main
  run_external "Sincronizando origin/main" git pull --rebase --autostash origin main
}
step_git_publish_main(){
  require_confirmation PUBLICAR-MAIN
  [[ -d .git ]] || { say fail "Diretório .git ausente."; return 1; }
  [[ "$(git branch --show-current)" == "main" ]] || { say fail "A publicação direta exige a branch main."; return 1; }
  [[ -n "$(git status --porcelain)" ]] || { say warn "Não existem alterações para publicar."; return 0; }
  step_quality_check
  git fetch origin main
  git pull --rebase --autostash origin main
  git add -A
  local message="${KAIRO_COMMIT_MESSAGE:-feat(orquestrador): atualização operacional Kairo $(date '+%Y-%m-%d %H:%M')}"
  git commit -m "$message"
  git push origin main
  say ok "Commit e push concluídos no origin/main."
}

run_batch(){ local title="$1"; shift; line; say header "$title"; "$@"; }
step_all_prepare(){
  require_confirmation PREPARAR-TUDO
  run_batch "Validar pré-requisitos" step_prerequisites
  run_batch "Preparar diretórios" step_runtime_prepare
  [[ -f .env ]] || run_batch "Criar ambiente seguro" step_env_create
  run_batch "Auditar ambiente" step_env_status || true
  run_batch "Instalar dependências" step_deps_install
  run_batch "Validar dependências" step_deps_verify
  KAIRO_ORCH_CONFIRM=APLICAR-MIGRATIONS run_batch "Bootstrap e migrations" step_db_bootstrap
  run_batch "Integridade do banco" step_db_integrity
  say ok "Preparação integral concluída."
}
step_all_validate(){
  require_confirmation VALIDAR-TUDO
  run_batch "Visão geral" step_project_overview
  run_batch "Pré-requisitos" step_prerequisites
  run_batch "Configuração" step_env_status
  run_batch "Dependências" step_deps_verify
  [[ -f "$(database_path)" ]] && run_batch "Integridade do banco" step_db_integrity || true
  run_batch "Segurança" step_security_full
  run_batch "Qualidade total" step_quality_full
  say ok "Validação integral concluída."
}
step_all_start(){
  require_confirmation INICIAR-TUDO
  KAIRO_ORCH_CONFIRM=PREPARAR-TUDO step_all_prepare
  run_batch "Iniciar Kairo" step_server_start
  run_batch "Health check" step_app_health
  say ok "Kairo preparado e iniciado."
}

run_action(){
  local id="${1:-}"
  case "$id" in
    project_overview) step_project_overview;; prerequisites) step_prerequisites;; env_status) step_env_status;; env_create) step_env_create;; runtime_prepare) step_runtime_prepare;; integrations_status) step_integrations_status;;
    deps_install) step_deps_install;; deps_verify) step_deps_verify;; deps_audit) step_deps_audit;; deps_outdated) step_deps_outdated;;
    server_status) step_server_status;; server_start) step_server_start;; server_start_dev) step_server_start_dev;; server_stop) step_server_stop;; server_restart) step_server_restart;; app_health) step_app_health;; server_logs) step_server_logs;; browser_open) step_browser_open;;
    db_status) step_db_status;; db_integrity) step_db_integrity;; db_migration_status) step_db_migration_status;; db_bootstrap) step_db_bootstrap;; db_backup) step_db_backup;; db_backups) step_db_backups;; db_restore_latest) step_db_restore_latest;; db_reset) step_db_reset;;
    test_unit) step_test_unit;; test_integration) step_test_integration;; test_migration) step_test_migration;; test_frontend) step_test_frontend;; test_e2e) step_test_e2e;; lint) step_lint;; format_check) step_format_check;; syntax_check) step_syntax_check;; coverage) step_coverage;; quality_check) step_quality_check;; quality_full) step_quality_full;;
    security_repository) step_security_repository;; security_full) step_security_full;; cleanup_artifacts) step_cleanup_artifacts;; diagnostics_export) step_diagnostics_export;;
    git_status) step_git_status;; git_pull_main) step_git_pull_main;; git_publish_main) step_git_publish_main;;
    all_prepare) step_all_prepare;; all_validate) step_all_validate;; all_start) step_all_start;;
    *) say fail "Ação inexistente: $id"; return 127;;
  esac
}

status_json(){
  local name version nodev npmv port host db db_exists=false db_size=0 env_exists=false deps_exists=false state=inactive pid='' mode='' branch='' dirty=0 health=false
  name="$(package_value 'p.name' 2>/dev/null || echo kairo)"; version="$(package_value 'p.version' 2>/dev/null || echo desconhecida)"
  nodev="$(node -v 2>/dev/null || echo ausente)"; npmv="$(npm -v 2>/dev/null || echo ausente)"; port="$(project_port)"; host="$(project_host)"; db="$(database_path)"
  [[ -f "$db" ]] && { db_exists=true; db_size="$(stat -c %s "$db" 2>/dev/null || echo 0)"; }
  [[ -f .env ]] && env_exists=true; [[ -d node_modules ]] && deps_exists=true
  if server_owned; then state=active; pid="$SERVER_PID"; mode="$SERVER_MODE"; port="$SERVER_PORT"; http_ok "http://127.0.0.1:$port/api/health" && health=true; fi
  if [[ -d .git ]]; then branch="$(git branch --show-current 2>/dev/null || true)"; dirty="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"; fi
  printf '{"project":"%s","version":"%s","root":"%s","node":"%s","npm":"%s","host":"%s","port":%s,"serverState":"%s","serverPid":"%s","serverMode":"%s","health":%s,"databasePath":"%s","databaseExists":%s,"databaseSize":%s,"envExists":%s,"dependenciesExists":%s,"branch":"%s","dirty":%s,"time":"%s"}\n' \
    "$(json_escape "$name")" "$(json_escape "$version")" "$(json_escape "$PROJECT_ROOT")" "$(json_escape "$nodev")" "$(json_escape "$npmv")" "$(json_escape "$host")" "$port" "$state" "$(json_escape "$pid")" "$(json_escape "$mode")" "$health" "$(json_escape "$db")" "$db_exists" "$db_size" "$env_exists" "$deps_exists" "$(json_escape "$branch")" "$dirty" "$(date '+%H:%M:%S')"
}

self_test(){
  local failed=0 json count
  say header "Autoteste do $SCRIPT_NAME v$SCRIPT_VERSION"
  bash -n "$SCRIPT_PATH" && say ok "Sintaxe Bash válida." || failed=1
  resolve_project_root && say ok "Projeto Kairo detectado em $PROJECT_ROOT." || failed=1
  init_actions; count="${#ACTION_IDS[@]}"; ((count>=40)) && say ok "Catálogo carregado com $count ações." || { say fail "Catálogo incompleto: $count ações."; failed=1; }
  json="$(list_actions_json)"; python3 -c 'import json,sys;d=json.load(sys.stdin);assert len(d)>=40;assert len({x["id"] for x in d})==len(d)' <<<"$json" && say ok "Catálogo JSON válido e sem IDs duplicados." || failed=1
  valid_port "$WEB_PORT" && say ok "Porta do painel válida: $WEB_PORT." || failed=1
  [[ "$(database_path)" == "$PROJECT_ROOT"/* || "$(database_path)" == /* ]] && say ok "Caminho do banco resolvido." || failed=1
  if ((failed==0)); then say ok "Autoteste concluído sem falhas."; else say fail "Autoteste encontrou falhas."; fi
  return "$failed"
}

cli_menu(){
  init_actions
  local choice id i group=""
  while true; do
    printf '\033[2J\033[H'
    printf '%b  %s  KAIRO ORCHESTRATOR WEB %s%b\n' "$(c "$C_PRIMARY$BOLD")" "$ICON_APP" "$SCRIPT_VERSION" "$(ce)"
    printf '  Projeto: %s\n\n' "$PROJECT_ROOT"
    for i in "${!ACTION_IDS[@]}"; do
      if [[ "$group" != "${ACTION_GROUPS[$i]}" ]]; then group="${ACTION_GROUPS[$i]}"; printf '\n  %b%s%b\n' "$(c "$C_SECONDARY$BOLD")" "$group" "$(ce)"; fi
      printf '  %b%02d%b  %s  %-34s %b[%s]%b\n' "$(c "$C_PRIMARY")" "$((i+1))" "$(ce)" "${ACTION_ICONS[$i]}" "${ACTION_TITLES[$i]}" "$(c "$C_MUTED")" "${ACTION_RISKS[$i]}" "$(ce)"
    done
    printf '\n  00  Sair\n\n  Escolha: '
    read -r choice
    case "${choice,,}" in 0|00|q|sair|exit) return 0;; esac
    if [[ "$choice" =~ ^[0-9]+$ ]] && ((choice>=1&&choice<=${#ACTION_IDS[@]})); then id="${ACTION_IDS[$((choice-1))]}"; else id="$choice"; fi
    line; say cmd "Executando: $(action_title "$id")"
    local idx confirm=""; idx="$(action_index "$id" 2>/dev/null || true)"; [[ -n "$idx" ]] && confirm="${ACTION_CONFIRMS[$idx]}"
    if [[ -n "$confirm" ]]; then printf '  Confirmação obrigatória (%s): ' "$confirm"; read -r KAIRO_ORCH_CONFIRM; export KAIRO_ORCH_CONFIRM; fi
    run_action "$id" || true
    unset KAIRO_ORCH_CONFIRM || true
    printf '\n  Pressione ENTER para continuar...'; read -r _
    group=""
  done
}

open_url(){
  local url="$1"
  $NO_BROWSER && { say warn "Abertura automática desativada. Acesse: $url"; return 0; }
  if command_exists wslview; then wslview "$url" >/dev/null 2>&1 &
  elif command_exists explorer.exe; then explorer.exe "$url" >/dev/null 2>&1 &
  elif command_exists xdg-open; then xdg-open "$url" >/dev/null 2>&1 &
  elif command_exists open; then open "$url" >/dev/null 2>&1 &
  else say warn "Abra manualmente: $url"; fi
}

launch_web(){
  command_exists python3 || { say fail "Python 3 é necessário para o painel Web."; return 1; }
  valid_port "$WEB_PORT" || { say fail "Porta inválida para o painel: $WEB_PORT"; return 1; }
  export KAIRO_ORCH_SCRIPT="$SCRIPT_PATH" KAIRO_ORCH_PROJECT="$PROJECT_ROOT" KAIRO_ORCH_WEB_PORT="$WEB_PORT" KAIRO_ORCH_NO_BROWSER="$NO_BROWSER"
  python3 -u - <<'PYWEB'
import json
import os
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

SCRIPT = os.environ["KAIRO_ORCH_SCRIPT"]
PROJECT = os.environ["KAIRO_ORCH_PROJECT"]
PORT = int(os.environ.get("KAIRO_ORCH_WEB_PORT", "8799"))
NO_BROWSER = os.environ.get("KAIRO_ORCH_NO_BROWSER", "false").lower() == "true"
TOKEN = secrets.token_urlsafe(32)
STARTED = time.time()
HISTORY = []
MAX_HISTORY = 200
HISTORY_LOCK = threading.Lock()


def base_command(*args):
    cmd = [SCRIPT, "--project-root", PROJECT, *args]
    stdbuf = shutil.which("stdbuf")
    return ([stdbuf, "-oL", "-eL"] + cmd) if stdbuf else cmd


def run_capture(*args, timeout=30, env=None):
    merged = os.environ.copy()
    if env:
        merged.update(env)
    try:
        result = subprocess.run(
            base_command(*args),
            cwd=PROJECT,
            text=True,
            capture_output=True,
            timeout=timeout,
            env=merged,
            check=False,
        )
        return result.returncode, result.stdout, result.stderr
    except subprocess.TimeoutExpired as exc:
        return 124, exc.stdout or "", "Tempo limite excedido."
    except Exception as exc:  # noqa: BLE001
        return 1, "", str(exc)


def load_actions():
    code, stdout, _ = run_capture("--list-actions-json")
    if code != 0:
        return []
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return []


def load_status():
    code, stdout, stderr = run_capture("--status-json", timeout=12)
    if code != 0:
        return {"error": stderr or stdout or "Falha ao consultar o estado."}
    try:
        status = json.loads(stdout)
    except json.JSONDecodeError:
        return {"error": "O orquestrador retornou um estado inválido."}
    status["orchestratorUptime"] = int(time.time() - STARTED)
    return status


ACTIONS = load_actions()
ACTIONS_BY_ID = {item["id"]: item for item in ACTIONS}

INDEX_HTML = r'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#111026">
<title>Kairo Orchestrator Web</title>
<style>
:root{
  color-scheme:dark;
  --bg:#070711;--bg-soft:#0d0d1c;--panel:rgba(17,17,38,.82);--panel-solid:#121226;
  --surface:rgba(255,255,255,.065);--surface-strong:rgba(255,255,255,.105);
  --line:rgba(255,255,255,.13);--line-hot:rgba(151,125,255,.5);
  --text:#f7f5ff;--muted:#aaa6c4;--subtle:#7f7b99;
  --purple:#8b7cff;--purple-2:#b584ff;--orange:#ff8b5a;--mint:#4bd7bb;
  --cyan:#58d6ff;--yellow:#f4c96d;--red:#ff647c;--green:#58d39b;
  --shadow:0 30px 90px rgba(0,0,0,.42);--shadow-soft:0 12px 38px rgba(0,0,0,.25);
  --radius-xl:30px;--radius-lg:22px;--radius-md:16px;--radius-sm:12px;
  --sidebar:292px;--console-height:292px;--focus:0 0 0 3px rgba(88,214,255,.42);
  --font:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --mono:"Cascadia Code","SFMono-Regular",Consolas,"Liberation Mono",monospace;
}
html[data-theme="light"]{
  color-scheme:light;--bg:#f4f3fb;--bg-soft:#ebe9f7;--panel:rgba(255,255,255,.86);--panel-solid:#fff;
  --surface:rgba(69,50,116,.055);--surface-strong:rgba(69,50,116,.095);--line:rgba(50,38,90,.13);
  --line-hot:rgba(101,75,223,.38);--text:#1a1730;--muted:#625d78;--subtle:#827c94;
  --purple:#6755df;--purple-2:#8d53dc;--orange:#d95d28;--mint:#087f6b;--cyan:#087ca8;
  --yellow:#8a6200;--red:#c93350;--green:#16764e;--shadow:0 28px 70px rgba(60,42,110,.16);
  --shadow-soft:0 12px 32px rgba(60,42,110,.10);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;background:var(--bg)}
body{margin:0;min-height:100vh;font-family:var(--font);color:var(--text);background:
 radial-gradient(circle at 8% -8%,rgba(139,124,255,.36),transparent 34%),
 radial-gradient(circle at 97% 3%,rgba(255,139,90,.24),transparent 30%),
 radial-gradient(circle at 72% 95%,rgba(75,215,187,.12),transparent 33%),
 linear-gradient(140deg,var(--bg),var(--bg-soft));overflow-x:hidden}
body::before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.35;background-image:
 linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px);background-size:42px 42px;mask-image:linear-gradient(to bottom,black,transparent 82%)}
button,input,select{font:inherit}button{color:inherit}a{color:inherit}
button:focus-visible,input:focus-visible,select:focus-visible,[tabindex]:focus-visible{outline:none;box-shadow:var(--focus)}
::selection{background:rgba(139,124,255,.45);color:#fff}
::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-thumb{background:rgba(150,140,180,.35);border-radius:999px;border:2px solid transparent;background-clip:padding-box}
.skip-link{position:fixed;left:14px;top:-70px;z-index:1000;padding:12px 16px;border-radius:12px;background:var(--panel-solid);border:1px solid var(--line);transition:top .2s}.skip-link:focus{top:14px}
.shell{position:relative;display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr);gap:18px;width:min(1840px,calc(100% - 28px));margin:0 auto;padding:16px 0 calc(var(--console-height) + 38px)}
.glass{border:1px solid var(--line);background:var(--panel);backdrop-filter:blur(26px) saturate(1.2);box-shadow:var(--shadow)}
.sidebar{position:sticky;top:16px;height:calc(100vh - 32px);border-radius:var(--radius-xl);overflow:hidden;display:flex;flex-direction:column;z-index:30}
.brand{display:flex;align-items:center;gap:13px;padding:18px;border-bottom:1px solid var(--line)}
.brand-mark{width:52px;height:52px;border-radius:18px;display:grid;place-items:center;font-size:26px;font-weight:900;color:#100f20;background:linear-gradient(135deg,var(--purple),var(--orange));box-shadow:0 12px 28px rgba(139,124,255,.28)}
.brand-copy{min-width:0}.brand-copy strong{display:block;font-size:17px;letter-spacing:.02em}.brand-copy span{display:block;color:var(--muted);font-size:12px;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.side-tools{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:12px;border-bottom:1px solid var(--line)}
.icon-btn,.pill-btn,.action-btn,.nav-item,.quick-btn,.filter-chip{min-height:44px;border:1px solid var(--line);background:var(--surface);border-radius:999px;cursor:pointer;transition:transform .18s,border-color .18s,background .18s,box-shadow .18s}
.icon-btn:hover,.pill-btn:hover,.action-btn:hover,.nav-item:hover,.quick-btn:hover,.filter-chip:hover{transform:translateY(-1px);border-color:var(--line-hot);background:var(--surface-strong)}
.icon-btn{display:flex;align-items:center;justify-content:center;gap:8px;padding:10px 12px;font-weight:760}.icon-btn span{font-size:12px}
.search-wrap{padding:12px}.search-box{position:relative}.search-box input{width:100%;height:46px;border-radius:15px;border:1px solid var(--line);background:rgba(0,0,0,.12);color:var(--text);padding:0 42px 0 42px}.search-icon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:var(--muted)}.shortcut{position:absolute;right:10px;top:50%;transform:translateY(-50%);font-size:11px;color:var(--subtle);border:1px solid var(--line);border-radius:8px;padding:3px 6px}
.side-nav{overflow:auto;padding:0 10px 18px}.nav-group{margin:10px 0 14px}.nav-heading{display:flex;align-items:center;justify-content:space-between;padding:6px 10px;color:var(--subtle);font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.14em}.nav-count{font-size:10px;border:1px solid var(--line);border-radius:999px;padding:2px 7px}
.nav-item{width:100%;display:grid;grid-template-columns:32px 1fr auto;align-items:center;gap:8px;text-align:left;border-color:transparent;background:transparent;border-radius:13px;padding:8px 10px;margin:2px 0}.nav-item.active{background:linear-gradient(90deg,rgba(139,124,255,.18),rgba(255,139,90,.08));border-color:rgba(139,124,255,.25)}.nav-item .ni{font-size:17px}.nav-item .nt{font-size:12.5px;font-weight:740;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.risk-dot{width:8px;height:8px;border-radius:50%;background:var(--subtle)}.risk-dot[data-risk="seguro"]{background:var(--green)}.risk-dot[data-risk="atenção"]{background:var(--yellow)}.risk-dot[data-risk="alto"]{background:var(--red)}.risk-dot[data-risk="lote"]{background:var(--purple)}
.side-footer{margin-top:auto;border-top:1px solid var(--line);padding:12px}.side-status{display:flex;gap:10px;align-items:center;border:1px solid var(--line);border-radius:16px;padding:11px;background:var(--surface)}.pulse{width:10px;height:10px;border-radius:50%;background:var(--subtle);box-shadow:0 0 0 5px rgba(127,123,153,.12)}.pulse.live{background:var(--green);box-shadow:0 0 0 5px rgba(88,211,155,.14)}.side-status strong{display:block;font-size:12px}.side-status span{display:block;color:var(--muted);font-size:10px;margin-top:2px}
.main{min-width:0}.mobile-bar{display:none;position:sticky;top:8px;z-index:35;align-items:center;justify-content:space-between;margin-bottom:12px;padding:10px 12px;border-radius:18px}.mobile-brand{display:flex;align-items:center;gap:8px;font-weight:850}
.hero{position:relative;overflow:hidden;border-radius:var(--radius-xl);padding:clamp(20px,3.5vw,42px);min-height:284px}.hero::after{content:"";position:absolute;width:340px;height:340px;border-radius:50%;right:-90px;top:-130px;background:conic-gradient(from 120deg,var(--purple),var(--orange),var(--mint),var(--purple));filter:blur(2px);opacity:.24}.hero-grid{position:relative;z-index:2;display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.7fr);gap:28px;align-items:end}.eyebrow{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(139,124,255,.3);background:rgba(139,124,255,.11);border-radius:999px;padding:7px 11px;font-size:11px;font-weight:850;letter-spacing:.08em;text-transform:uppercase;color:var(--purple-2)}.hero h1{font-size:clamp(30px,5vw,58px);line-height:.98;margin:17px 0 14px;max-width:850px;letter-spacing:-.045em}.hero h1 em{font-style:normal;background:linear-gradient(100deg,var(--purple),var(--orange));background-clip:text;color:transparent}.hero p{max-width:760px;color:var(--muted);font-size:clamp(14px,1.7vw,18px);line-height:1.55;margin:0}.hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.pill-btn{padding:11px 16px;font-weight:820}.pill-btn.primary{border:0;color:#11101d;background:linear-gradient(135deg,var(--purple),var(--orange));box-shadow:0 12px 30px rgba(139,124,255,.24)}.pill-btn.ghost{background:var(--surface)}
.orbit-card{position:relative;border:1px solid var(--line);border-radius:26px;padding:20px;background:linear-gradient(145deg,var(--surface-strong),rgba(0,0,0,.12));min-height:210px;display:flex;flex-direction:column;justify-content:space-between}.orbit{width:102px;height:102px;border-radius:50%;display:grid;place-items:center;background:conic-gradient(var(--green) var(--health-angle,0deg),rgba(255,255,255,.08) 0);position:relative}.orbit::before{content:"";position:absolute;inset:10px;border-radius:50%;background:var(--panel-solid)}.orbit strong{position:relative;font-size:24px}.orbit-meta{display:flex;justify-content:space-between;align-items:end;gap:12px}.orbit-meta span{color:var(--muted);font-size:11px}.orbit-meta b{font-size:13px}
.section{margin-top:18px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:12px;margin:0 4px 12px}.section-head h2{font-size:20px;margin:0}.section-head p{color:var(--muted);font-size:12px;margin:3px 0 0}.section-actions{display:flex;gap:8px;flex-wrap:wrap}.filter-chip{min-height:36px;padding:7px 11px;font-size:11px;font-weight:800}.filter-chip.active{background:rgba(139,124,255,.18);border-color:rgba(139,124,255,.4);color:var(--purple-2)}
.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.metric{border-radius:var(--radius-lg);padding:16px;min-height:128px;position:relative;overflow:hidden}.metric::after{content:"";position:absolute;right:-28px;bottom:-38px;width:100px;height:100px;border-radius:50%;background:var(--metric-glow,rgba(139,124,255,.13))}.metric-top{display:flex;justify-content:space-between;gap:10px;align-items:center}.metric-icon{width:40px;height:40px;border-radius:13px;display:grid;place-items:center;background:var(--surface-strong);font-size:19px}.metric-state{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.metric strong{display:block;font-size:18px;margin-top:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.metric small{display:block;color:var(--muted);margin-top:4px;font-size:11px}
.quick-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.quick-btn{border-radius:var(--radius-lg);padding:16px;text-align:left;min-height:116px;display:flex;flex-direction:column;justify-content:space-between}.quick-btn .qi{font-size:25px}.quick-btn b{font-size:14px}.quick-btn span{font-size:11px;color:var(--muted)}
.workspace{container-type:inline-size}.action-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.action-card{position:relative;border:1px solid var(--line);background:var(--panel);border-radius:var(--radius-lg);padding:16px;min-height:182px;display:flex;flex-direction:column;box-shadow:var(--shadow-soft);transition:transform .2s,border-color .2s,background .2s;overflow:hidden}.action-card:hover{transform:translateY(-3px);border-color:var(--line-hot);background:color-mix(in srgb,var(--panel) 78%,var(--purple) 22%)}.action-card::after{content:"";position:absolute;width:120px;height:120px;border-radius:50%;right:-65px;top:-62px;background:var(--card-glow,rgba(139,124,255,.15))}.card-top{position:relative;z-index:1;display:flex;justify-content:space-between;gap:10px}.card-icon{width:44px;height:44px;border-radius:14px;display:grid;place-items:center;font-size:21px;background:var(--surface-strong);border:1px solid var(--line)}.risk-badge{height:27px;display:inline-flex;align-items:center;border-radius:999px;padding:0 9px;border:1px solid var(--line);font-size:9px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}.risk-badge[data-risk="seguro"]{color:var(--green);border-color:rgba(88,211,155,.28)}.risk-badge[data-risk="atenção"]{color:var(--yellow);border-color:rgba(244,201,109,.3)}.risk-badge[data-risk="alto"]{color:var(--red);border-color:rgba(255,100,124,.3)}.risk-badge[data-risk="lote"]{color:var(--purple-2);border-color:rgba(139,124,255,.32)}.action-card h3{position:relative;z-index:1;font-size:15px;margin:13px 0 7px}.action-card p{position:relative;z-index:1;color:var(--muted);font-size:11.5px;line-height:1.45;margin:0 0 14px;flex:1}.action-btn{position:relative;z-index:1;width:100%;padding:9px 12px;min-height:40px;font-size:11px;font-weight:860;display:flex;justify-content:center;align-items:center;gap:7px}.action-btn:disabled{opacity:.45;cursor:not-allowed;transform:none}
.empty{grid-column:1/-1;border:1px dashed var(--line);border-radius:var(--radius-lg);padding:34px;text-align:center;color:var(--muted)}
.console-dock{position:fixed;z-index:80;left:50%;bottom:12px;transform:translateX(-50%);width:min(1800px,calc(100% - 28px));height:var(--console-height);border-radius:26px;overflow:hidden;display:flex;flex-direction:column;transition:height .25s}.console-dock.collapsed{height:58px}.console-head{min-height:58px;display:flex;align-items:center;gap:10px;padding:10px 13px;border-bottom:1px solid var(--line);background:rgba(12,12,26,.92)}html[data-theme="light"] .console-head{background:rgba(255,255,255,.95)}.traffic{display:flex;gap:6px}.traffic i{width:10px;height:10px;border-radius:50%;display:block}.traffic i:nth-child(1){background:var(--red)}.traffic i:nth-child(2){background:var(--yellow)}.traffic i:nth-child(3){background:var(--green)}.console-title{min-width:0;flex:1}.console-title strong{display:block;font-size:12px}.console-title span{display:block;font-size:10px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.console-actions{display:flex;gap:6px}.console-actions button{width:38px;height:38px;border-radius:12px;border:1px solid var(--line);background:var(--surface);cursor:pointer}.progress-line{height:3px;background:rgba(255,255,255,.06)}.progress-line i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--purple),var(--orange),var(--mint));transition:width .3s}.progress-line.running i{width:72%;animation:progress-run 1.7s infinite ease-in-out}.console-body{flex:1;overflow:auto;background:#070811;color:#dfe7ff;padding:13px 16px;font:12px/1.55 var(--mono);white-space:pre-wrap;word-break:break-word}.console-body .ok{color:#68e7ac}.console-body .error{color:#ff758b}.console-body .meta{color:#8f94b1}.console-body .command{color:#6fe2ff}.console-body:empty::before{content:"Console pronto. Selecione uma ação para acompanhar a execução em tempo real.";color:#747b9a}
.lock-screen{position:fixed;inset:0;z-index:500;display:none;place-items:center;padding:20px;background:rgba(5,5,13,.78);backdrop-filter:blur(18px)}.lock-screen.show{display:grid}.lock-card{width:min(470px,100%);border-radius:28px;padding:28px;text-align:center}.lock-icon{width:66px;height:66px;border-radius:22px;display:grid;place-items:center;margin:0 auto 18px;font-size:28px;background:linear-gradient(135deg,var(--purple),var(--orange));color:#111}.lock-card h2{margin:0 0 8px}.lock-card p{color:var(--muted);font-size:13px;line-height:1.5}.lock-card input{width:100%;height:48px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--text);padding:0 14px;margin:10px 0}.lock-card button{width:100%}
dialog{color:var(--text);border:1px solid var(--line);background:var(--panel-solid);border-radius:26px;padding:0;box-shadow:var(--shadow);width:min(520px,calc(100% - 28px))}dialog::backdrop{background:rgba(5,5,13,.72);backdrop-filter:blur(10px)}.dialog-inner{padding:24px}.dialog-icon{width:54px;height:54px;border-radius:18px;display:grid;place-items:center;background:rgba(255,100,124,.14);color:var(--red);font-size:24px}.dialog-inner h2{font-size:20px;margin:16px 0 8px}.dialog-inner p{color:var(--muted);font-size:13px;line-height:1.5}.confirm-code{display:block;font:700 13px var(--mono);padding:11px 13px;border:1px solid rgba(255,100,124,.3);border-radius:12px;color:var(--red);background:rgba(255,100,124,.08);margin:12px 0}.dialog-inner input{width:100%;height:48px;border:1px solid var(--line);border-radius:14px;background:var(--surface);color:var(--text);padding:0 14px}.dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}.dialog-actions button{min-height:44px;border-radius:13px;border:1px solid var(--line);background:var(--surface);padding:9px 14px;font-weight:800;cursor:pointer}.dialog-actions .danger{border:0;background:linear-gradient(135deg,var(--red),var(--orange));color:#fff}
.toast-stack{position:fixed;z-index:600;right:18px;top:18px;display:grid;gap:8px;width:min(380px,calc(100% - 36px))}.toast{border:1px solid var(--line);background:var(--panel-solid);box-shadow:var(--shadow-soft);border-radius:16px;padding:12px 14px;display:flex;gap:10px;align-items:flex-start;animation:toast-in .25s}.toast b{font-size:12px}.toast p{font-size:11px;color:var(--muted);margin:3px 0 0}.toast.success{border-color:rgba(88,211,155,.32)}.toast.error{border-color:rgba(255,100,124,.35)}
.mobile-scrim{display:none;position:fixed;inset:0;z-index:25;background:rgba(4,4,12,.65)}
@keyframes progress-run{0%{transform:translateX(-95%)}100%{transform:translateX(145%)}}@keyframes toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@container (max-width:850px){.action-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:1280px){.metrics{grid-template-columns:repeat(3,minmax(0,1fr))}.quick-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.action-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:900px){:root{--console-height:260px}.shell{display:block;width:min(100% - 18px,900px);padding-top:8px}.mobile-bar{display:flex}.sidebar{position:fixed;left:9px;top:9px;bottom:9px;height:auto;width:min(320px,calc(100% - 36px));transform:translateX(calc(-100% - 20px));transition:transform .25s;z-index:40}.sidebar.open{transform:none}.mobile-scrim.show{display:block}.hero-grid{grid-template-columns:1fr}.orbit-card{min-height:160px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:620px){:root{--console-height:238px}.shell{width:calc(100% - 12px)}.hero{padding:22px 18px}.hero h1{font-size:34px}.hero-actions{display:grid;grid-template-columns:1fr}.pill-btn{width:100%}.metrics,.quick-grid,.action-grid{grid-template-columns:1fr}.metric{min-height:112px}.section-head{align-items:flex-start;flex-direction:column}.console-dock{width:calc(100% - 12px);bottom:6px;border-radius:20px}.console-head{padding:8px}.console-actions button{width:36px}.console-body{font-size:11px;padding:11px}.toast-stack{right:8px;top:8px;width:calc(100% - 16px)}}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;scroll-behavior:auto!important;transition-duration:.001ms!important}}
@media (prefers-contrast:more){:root{--line:rgba(255,255,255,.32);--muted:#d3cfe3}.action-card,.metric,.quick-btn{border-width:2px}}
</style>
</head>
<body>
<a class="skip-link" href="#conteudo">Ir para o conteúdo</a>
<div class="mobile-scrim" id="scrim"></div>
<div class="shell">
  <aside class="sidebar glass" id="sidebar" aria-label="Navegação das ações">
    <div class="brand"><div class="brand-mark" aria-hidden="true">◐</div><div class="brand-copy"><strong>Kairo Orchestrator</strong><span>Central operacional premium</span></div></div>
    <div class="side-tools">
      <button class="icon-btn" id="themeBtn" type="button" title="Alternar tema"><span aria-hidden="true">◒</span><span>Tema</span></button>
      <button class="icon-btn" id="refreshBtn" type="button" title="Atualizar estado"><span aria-hidden="true">↻</span><span>Atualizar</span></button>
    </div>
    <div class="search-wrap"><div class="search-box"><span class="search-icon" aria-hidden="true">⌕</span><input id="search" type="search" autocomplete="off" placeholder="Buscar ações" aria-label="Buscar ações"><span class="shortcut">/</span></div></div>
    <nav class="side-nav" id="nav"></nav>
    <div class="side-footer"><div class="side-status"><i class="pulse" id="sidePulse"></i><div><strong id="sideState">Consultando…</strong><span id="sideDetail">Kairo localhost</span></div></div></div>
  </aside>

  <main class="main" id="conteudo">
    <div class="mobile-bar glass"><div class="mobile-brand"><span aria-hidden="true">◐</span>Kairo Orchestrator</div><button class="icon-btn" id="menuBtn" type="button" aria-label="Abrir menu">☰</button></div>

    <section class="hero glass" aria-labelledby="heroTitle">
      <div class="hero-grid">
        <div>
          <span class="eyebrow"><span aria-hidden="true">✦</span> Torre de controle local-first</span>
          <h1 id="heroTitle">Toda a operação do <em>Kairo</em>, sob um único pulso.</h1>
          <p>Prepare o ambiente, instale dependências, governe o SQLite, execute QA, acompanhe logs e publique no GitHub com ações reais e rastreáveis.</p>
          <div class="hero-actions">
            <button class="pill-btn primary" type="button" data-run="all_start">Preparar e iniciar</button>
            <button class="pill-btn ghost" type="button" data-run="all_validate">Validação total</button>
            <button class="pill-btn ghost" type="button" data-run="project_overview">Diagnóstico</button>
          </div>
        </div>
        <div class="orbit-card">
          <div class="orbit" id="healthOrbit"><strong id="healthScore">0%</strong></div>
          <div class="orbit-meta"><div><span>Prontidão operacional</span><b id="healthLabel">Calculando</b></div><div style="text-align:right"><span>Atualização</span><b id="clock">--:--:--</b></div></div>
        </div>
      </div>
    </section>

    <section class="section" aria-labelledby="metricsTitle">
      <div class="section-head"><div><h2 id="metricsTitle">Pulso do ambiente</h2><p>Estado real coletado diretamente do projeto.</p></div></div>
      <div class="metrics" id="metrics"></div>
    </section>

    <section class="section" aria-labelledby="quickTitle">
      <div class="section-head"><div><h2 id="quickTitle">Acesso rápido</h2><p>Os quatro caminhos mais usados no ciclo local.</p></div></div>
      <div class="quick-grid" id="quickGrid"></div>
    </section>

    <section class="section workspace" aria-labelledby="actionsTitle">
      <div class="section-head">
        <div><h2 id="actionsTitle">Catálogo operacional</h2><p id="actionSummary">Carregando ações…</p></div>
        <div class="section-actions" id="riskFilters" aria-label="Filtros de risco"></div>
      </div>
      <div class="action-grid" id="actionGrid"></div>
    </section>
  </main>
</div>

<section class="console-dock glass" id="consoleDock" aria-label="Console de execução">
  <div class="console-head">
    <div class="traffic" aria-hidden="true"><i></i><i></i><i></i></div>
    <div class="console-title"><strong id="consoleTitle">Console operacional</strong><span id="consoleMeta">Pronto para executar uma ação</span></div>
    <div class="console-actions"><button id="copyConsole" type="button" title="Copiar console">⧉</button><button id="clearConsole" type="button" title="Limpar console">⌫</button><button id="toggleConsole" type="button" title="Recolher console">⌄</button></div>
  </div>
  <div class="progress-line" id="progress"><i></i></div>
  <div class="console-body" id="consoleBody" role="log" aria-live="polite" aria-atomic="false"></div>
</section>

<div class="lock-screen" id="lockScreen"><div class="lock-card glass"><div class="lock-icon">🔐</div><h2>Sessão protegida</h2><p>O token local não foi encontrado. Cole o token exibido no terminal que iniciou o orquestrador.</p><input id="tokenInput" type="password" autocomplete="off" placeholder="Token da sessão"><button class="pill-btn primary" id="unlockBtn" type="button">Desbloquear painel</button></div></div>
<dialog id="confirmDialog"><form method="dialog" class="dialog-inner"><div class="dialog-icon">!</div><h2 id="confirmTitle">Confirmar ação</h2><p id="confirmText"></p><code class="confirm-code" id="confirmCode"></code><input id="confirmInput" autocomplete="off" spellcheck="false" aria-label="Texto de confirmação"><div class="dialog-actions"><button value="cancel">Cancelar</button><button class="danger" value="confirm" id="confirmButton">Executar ação</button></div></form></dialog>
<div class="toast-stack" id="toasts" aria-live="polite"></div>

<script>
const state={token:'',actions:[],status:null,query:'',risk:'todos',running:false,activeId:null};
const $=(s,r=document)=>r.querySelector(s);const $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmtBytes=(n)=>{n=Number(n||0);const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<u.length-1){n/=1024;i++}return `${i? n.toFixed(1):Math.round(n)} ${u[i]}`};
const fmtUptime=(s)=>{s=Number(s||0);const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),x=s%60;return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(x).padStart(2,'0')}`};
const prefersReduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches;
function transition(fn){if(document.startViewTransition&&!prefersReduced())document.startViewTransition(fn);else fn()}
function getToken(){const hash=new URLSearchParams(location.hash.slice(1));const fromHash=hash.get('token');if(fromHash){sessionStorage.setItem('kairo-orch-token',fromHash);history.replaceState(null,'',location.pathname+location.search)}return fromHash||sessionStorage.getItem('kairo-orch-token')||''}
function authHeaders(extra={}){return {'X-Kairo-Token':state.token,...extra}}
async function api(path,options={}){const response=await fetch(path,{...options,headers:authHeaders(options.headers||{})});if(response.status===401){lock();throw new Error('Sessão não autorizada.')}if(!response.ok)throw new Error((await response.text())||`HTTP ${response.status}`);return response}
function toast(title,message,type='success'){const el=document.createElement('div');el.className=`toast ${type}`;el.innerHTML=`<span>${type==='error'?'❌':'✅'}</span><div><b>${esc(title)}</b><p>${esc(message)}</p></div>`;$('#toasts').append(el);setTimeout(()=>el.remove(),4800)}
function lock(){$('#lockScreen').classList.add('show');$('#tokenInput').focus()}
function unlock(){const value=$('#tokenInput').value.trim();if(!value)return;state.token=value;sessionStorage.setItem('kairo-orch-token',value);$('#lockScreen').classList.remove('show');bootstrap().catch(e=>toast('Falha',e.message,'error'))}
function setTheme(theme){document.documentElement.dataset.theme=theme;localStorage.setItem('kairo-orch-theme',theme);document.querySelector('meta[name="theme-color"]').content=theme==='light'?'#f4f3fb':'#111026'}
function initTheme(){const saved=localStorage.getItem('kairo-orch-theme');setTheme(saved||(matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'))}
function healthScore(s){if(!s||s.error)return 0;let n=0;n+=s.envExists?18:0;n+=s.dependenciesExists?22:0;n+=s.databaseExists?18:0;n+=s.serverState==='active'?20:0;n+=s.health?22:0;return n}
function metric(icon,label,value,detail,glow='rgba(139,124,255,.13)'){return `<article class="metric glass" style="--metric-glow:${glow}"><div class="metric-top"><span class="metric-icon">${icon}</span><span class="metric-state">${esc(label)}</span></div><strong title="${esc(value)}">${esc(value)}</strong><small>${esc(detail)}</small></article>`}
function renderStatus(){const s=state.status||{};const active=s.serverState==='active';$('#sidePulse').classList.toggle('live',active&&s.health);$('#sideState').textContent=active?(s.health?'Aplicação saudável':'Processo degradado'):'Aplicação inativa';$('#sideDetail').textContent=`127.0.0.1:${s.port||3000}`;$('#clock').textContent=s.time||'--:--:--';const score=healthScore(s);$('#healthScore').textContent=`${score}%`;$('#healthLabel').textContent=score===100?'Pronto para operar':score>=60?'Preparação parcial':'Ação necessária';$('#healthOrbit').style.setProperty('--health-angle',`${score*3.6}deg`);
 const db=s.databaseExists?fmtBytes(s.databaseSize):'Ainda não criado';const git=s.branch||'ZIP sem .git';
 $('#metrics').innerHTML=[metric('⬢','Node.js',s.node||'ausente',`npm ${s.npm||'ausente'}`),metric('🚀','Servidor',active?(s.serverMode||'ativo'):'inativo',active?`PID ${s.serverPid} · porta ${s.port}`:`porta prevista ${s.port}`,'rgba(88,211,155,.13)'),metric('🗄️','SQLite',db,s.databaseExists?'arquivo operacional':'criado no bootstrap','rgba(255,139,90,.13)'),metric('⚙️','Ambiente',s.envExists?'.env presente':'.env ausente',s.envExists?'configuração local':'use Criar .env seguro','rgba(88,214,255,.13)'),metric('📦','Dependências',s.dependenciesExists?'instaladas':'ausentes',s.dependenciesExists?'node_modules disponível':'execute npm ci','rgba(139,124,255,.14)'),metric('🐙','Git',git,s.dirty?`${s.dirty} alteração(ões) local(is)`:'árvore limpa ou não disponível','rgba(255,139,90,.12)')].join('')}
function riskLabel(r){return r==='leitura'?'Somente leitura':r}
function groupedActions(actions){return actions.reduce((m,a)=>((m[a.group]??=[]).push(a),m),{})}
function renderNav(){const groups=groupedActions(state.actions);$('#nav').innerHTML=Object.entries(groups).map(([group,items])=>`<div class="nav-group"><div class="nav-heading"><span>${esc(group)}</span><span class="nav-count">${items.length}</span></div>${items.map(a=>`<button type="button" class="nav-item ${state.activeId===a.id?'active':''}" data-scroll="${esc(a.id)}"><span class="ni">${a.icon}</span><span class="nt">${esc(a.title)}</span><i class="risk-dot" data-risk="${esc(a.risk)}"></i></button>`).join('')}</div>`).join('')}
function filteredActions(){const q=state.query.toLocaleLowerCase('pt-BR');return state.actions.filter(a=>(state.risk==='todos'||a.risk===state.risk)&&(!q||`${a.title} ${a.description} ${a.group} ${a.id}`.toLocaleLowerCase('pt-BR').includes(q)))}
function renderActions(){const list=filteredActions();$('#actionSummary').textContent=`${list.length} de ${state.actions.length} ações disponíveis`;
 const html=list.length?list.map(a=>`<article class="action-card" id="action-${esc(a.id)}"><div class="card-top"><span class="card-icon">${a.icon}</span><span class="risk-badge" data-risk="${esc(a.risk)}">${esc(riskLabel(a.risk))}</span></div><h3>${esc(a.title)}</h3><p>${esc(a.description)}</p><button type="button" class="action-btn" data-run="${esc(a.id)}" ${state.running?'disabled':''}><span>Executar</span><span aria-hidden="true">→</span></button></article>`).join(''):`<div class="empty">Nenhuma ação corresponde aos filtros atuais.</div>`;
 transition(()=>{$('#actionGrid').innerHTML=html;renderNav()})}
function renderFilters(){const risks=['todos','leitura','seguro','atenção','alto','lote'];$('#riskFilters').innerHTML=risks.map(r=>`<button type="button" class="filter-chip ${state.risk===r?'active':''}" data-risk-filter="${r}">${r==='todos'?'Todas':riskLabel(r)}</button>`).join('')}
function renderQuick(){const ids=['server_start_dev','db_backup','quality_check','git_status'];const map=new Map(state.actions.map(a=>[a.id,a]));$('#quickGrid').innerHTML=ids.map(id=>map.get(id)).filter(Boolean).map(a=>`<button type="button" class="quick-btn glass" data-run="${a.id}"><span class="qi">${a.icon}</span><b>${esc(a.title)}</b><span>${esc(a.group)}</span></button>`).join('')}
function consoleLine(text,kind=''){const body=$('#consoleBody');const span=document.createElement('span');span.className=kind;span.textContent=text;body.append(span);body.scrollTop=body.scrollHeight}
function clearConsole(){$('#consoleBody').textContent=''}
function setRunning(value,action){state.running=value;state.activeId=value?action?.id:null;$('#progress').classList.toggle('running',value);$('#consoleTitle').textContent=value?action.title:'Console operacional';$('#consoleMeta').textContent=value?`${action.group} · ${riskLabel(action.risk)}`:'Pronto para executar uma ação';renderActions()}
function confirmAction(action){if(!action.confirm)return Promise.resolve('');return new Promise(resolve=>{const d=$('#confirmDialog');$('#confirmTitle').textContent=action.title;$('#confirmText').textContent='Esta operação altera o ambiente. Revise o console e digite exatamente o código abaixo.';$('#confirmCode').textContent=action.confirm;$('#confirmInput').value='';$('#confirmButton').disabled=true;const onInput=()=>{$('#confirmButton').disabled=$('#confirmInput').value!==action.confirm};$('#confirmInput').addEventListener('input',onInput);d.addEventListener('close',()=>{ $('#confirmInput').removeEventListener('input',onInput);resolve(d.returnValue==='confirm'?action.confirm:null)},{once:true});d.showModal();setTimeout(()=>$('#confirmInput').focus(),30)})}
async function runAction(id){if(state.running)return toast('Execução em andamento','Aguarde a ação atual terminar.','error');const action=state.actions.find(a=>a.id===id);if(!action)return toast('Ação inválida',id,'error');const confirm=await confirmAction(action);if(confirm===null)return;clearConsole();$('#consoleDock').classList.remove('collapsed');setRunning(true,action);consoleLine(`▶ ${action.title}\n`,'command');consoleLine(`${action.description}\n\n`,'meta');
 try{const response=await api('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:id,confirm})});if(!response.body)throw new Error('Streaming indisponível.');const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const parts=buffer.split('\n\n');buffer=parts.pop()||'';for(const part of parts){const line=part.split('\n').find(v=>v.startsWith('data: '));if(!line)continue;const event=JSON.parse(line.slice(6));if(event.type==='line')consoleLine(event.text,event.text.includes('❌')||event.text.includes('ERRO')?'error':event.text.includes('✅')?'ok':'');if(event.type==='end'){consoleLine(`\n${event.ok?'✅':'❌'} Finalizado em ${event.duration.toFixed(2)}s · código ${event.code}\n`,event.ok?'ok':'error');toast(event.ok?'Ação concluída':'Ação falhou',`${action.title} · código ${event.code}`,event.ok?'success':'error')}}}
 }catch(error){consoleLine(`\nERRO: ${error.message}\n`,'error');toast('Falha de execução',error.message,'error')}finally{setRunning(false);await refreshStatus()}}
async function refreshStatus(){try{const r=await api('/api/status');state.status=await r.json();renderStatus()}catch(e){toast('Estado indisponível',e.message,'error')}}
async function bootstrap(){const [a,s]=await Promise.all([api('/api/actions').then(r=>r.json()),api('/api/status').then(r=>r.json())]);state.actions=a;state.status=s;renderStatus();renderFilters();renderQuick();renderActions()}
function toggleSidebar(open){$('#sidebar').classList.toggle('open',open);$('#scrim').classList.toggle('show',open)}
document.addEventListener('click',e=>{const run=e.target.closest('[data-run]');if(run){runAction(run.dataset.run);return}const n=e.target.closest('[data-scroll]');if(n){const target=$(`#action-${CSS.escape(n.dataset.scroll)}`);target?.scrollIntoView({behavior:prefersReduced()?'auto':'smooth',block:'center'});toggleSidebar(false);return}const f=e.target.closest('[data-risk-filter]');if(f){state.risk=f.dataset.riskFilter;renderFilters();renderActions()}});
$('#search').addEventListener('input',e=>{state.query=e.target.value;renderActions()});$('#themeBtn').addEventListener('click',()=>setTheme(document.documentElement.dataset.theme==='light'?'dark':'light'));$('#refreshBtn').addEventListener('click',refreshStatus);$('#menuBtn').addEventListener('click',()=>toggleSidebar(true));$('#scrim').addEventListener('click',()=>toggleSidebar(false));$('#toggleConsole').addEventListener('click',()=>$('#consoleDock').classList.toggle('collapsed'));$('#clearConsole').addEventListener('click',clearConsole);$('#copyConsole').addEventListener('click',async()=>{await navigator.clipboard.writeText($('#consoleBody').innerText);toast('Console copiado','O conteúdo foi enviado para a área de transferência.')});$('#unlockBtn').addEventListener('click',unlock);$('#tokenInput').addEventListener('keydown',e=>{if(e.key==='Enter')unlock()});
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)){e.preventDefault();$('#search').focus()}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();$('#search').focus()}if(e.key==='Escape')toggleSidebar(false)});
initTheme();state.token=getToken();if(!state.token)lock();else bootstrap().catch(e=>{toast('Falha ao iniciar',e.message,'error');lock()});setInterval(()=>{if(state.token&&!state.running)refreshStatus()},8000);
</script>
</body>
</html>'''


class Handler(BaseHTTPRequestHandler):
    server_version = "KairoOrchestrator/1.0"

    def log_message(self, fmt, *args):
        sys.stdout.write("[painel] " + (fmt % args) + "\n")

    def security_headers(self, content_type="application/json; charset=utf-8"):
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; "
            "connect-src 'self'; img-src 'self' data:; font-src 'self'; base-uri 'none'; "
            "form-action 'none'; frame-ancestors 'none'",
        )

    def send_json(self, payload, status=HTTPStatus.OK):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.security_headers()
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, status=HTTPStatus.OK, content_type="text/plain; charset=utf-8"):
        body = text.encode("utf-8")
        self.send_response(status)
        self.security_headers(content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        header = self.headers.get("X-Kairo-Token", "")
        query = parse_qs(urlparse(self.path).query)
        candidate = header or (query.get("token", [""])[0])
        return secrets.compare_digest(candidate, TOKEN)

    def require_auth(self):
        if self.authorized():
            return True
        self.send_json({"erro": "Sessão local não autorizada."}, HTTPStatus.UNAUTHORIZED)
        return False

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_text(INDEX_HTML, content_type="text/html; charset=utf-8")
            return
        if parsed.path == "/favicon.ico":
            self.send_response(HTTPStatus.NO_CONTENT)
            self.end_headers()
            return
        if not self.require_auth():
            return
        if parsed.path == "/api/actions":
            self.send_json(ACTIONS)
        elif parsed.path == "/api/status":
            self.send_json(load_status())
        elif parsed.path == "/api/history":
            with HISTORY_LOCK:
                self.send_json(HISTORY[:])
        else:
            self.send_json({"erro": "Rota não encontrada."}, HTTPStatus.NOT_FOUND)

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path != "/api/run":
            self.send_json({"erro": "Rota não encontrada."}, HTTPStatus.NOT_FOUND)
            return
        if not self.require_auth():
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length > 16_384:
                raise ValueError("Corpo excede o limite permitido.")
            payload = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError) as exc:
            self.send_json({"erro": str(exc)}, HTTPStatus.BAD_REQUEST)
            return

        action_id = str(payload.get("action", ""))
        action = ACTIONS_BY_ID.get(action_id)
        if not action:
            self.send_json({"erro": "Ação inexistente."}, HTTPStatus.BAD_REQUEST)
            return
        confirmation = str(payload.get("confirm", ""))
        expected = action.get("confirm", "")
        if expected and confirmation != expected:
            self.send_json({"erro": "Confirmação literal inválida."}, HTTPStatus.CONFLICT)
            return

        self.send_response(HTTPStatus.OK)
        self.security_headers("text/event-stream; charset=utf-8")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        env = os.environ.copy()
        env["KAIRO_ORCH_CONFIRM"] = confirmation
        started = time.time()
        item = {
            "action": action_id,
            "title": action["title"],
            "startedAt": time.strftime("%Y-%m-%d %H:%M:%S"),
            "code": None,
            "duration": None,
        }

        def emit(obj):
            data = json.dumps(obj, ensure_ascii=False)
            self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
            self.wfile.flush()

        try:
            emit({"type": "start", "action": action_id})
            process = subprocess.Popen(
                base_command("--run-action", action_id),
                cwd=PROJECT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                env=env,
            )
            assert process.stdout is not None
            for output in process.stdout:
                emit({"type": "line", "text": output})
            code = process.wait()
        except BrokenPipeError:
            return
        except Exception as exc:  # noqa: BLE001
            code = 1
            try:
                emit({"type": "line", "text": f"ERRO DO PAINEL: {exc}\n"})
            except BrokenPipeError:
                return

        duration = round(time.time() - started, 2)
        item.update({"code": code, "duration": duration})
        with HISTORY_LOCK:
            HISTORY.insert(0, item)
            del HISTORY[MAX_HISTORY:]
        try:
            emit({"type": "end", "code": code, "ok": code == 0, "duration": duration})
        except BrokenPipeError:
            return


def port_available(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


if not port_available(PORT):
    print(f"ERRO: a porta local {PORT} já está ocupada.", file=sys.stderr)
    raise SystemExit(1)

server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
server.daemon_threads = True
url = f"http://127.0.0.1:{PORT}/#token={TOKEN}"
print("\n╭──────────────────────────────────────────────────────────────╮")
print("│  Kairo Orchestrator Web v1.0.0                              │")
print("├──────────────────────────────────────────────────────────────┤")
print(f"│  Projeto: {PROJECT[:48]:<48} │")
print(f"│  Painel:  http://127.0.0.1:{PORT:<30} │")
print("│  Segurança: loopback + token efêmero                         │")
print("╰──────────────────────────────────────────────────────────────╯")
print(f"\nURL protegida:\n{url}\n")

if not NO_BROWSER:
    def open_browser():
        time.sleep(0.8)
        candidates = [
            (["wslview", url] if shutil.which("wslview") else None),
            (["explorer.exe", url] if shutil.which("explorer.exe") else None),
            (["xdg-open", url] if shutil.which("xdg-open") else None),
            (["open", url] if shutil.which("open") else None),
        ]
        for command in candidates:
            if command:
                try:
                    subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return
                except OSError:
                    continue
    threading.Thread(target=open_browser, daemon=True).start()

try:
    server.serve_forever(poll_interval=0.35)
except KeyboardInterrupt:
    print("\nPainel encerrado pelo usuário.")
finally:
    server.server_close()
PYWEB
}

show_help(){
  cat <<EOF
$SCRIPT_NAME v$SCRIPT_VERSION

Uso:
  $0 [--web|--cli] [--project-root CAMINHO] [--port PORTA] [--no-browser]
  $0 --self-test
  $0 --menu-preview
  $0 --list-actions-json
  $0 --status-json
  $0 --run-action ID

Opções:
  --web                 Abre o painel Web local (padrão).
  --cli                 Abre o menu de terminal.
  --project-root PATH   Define explicitamente a raiz do Kairo.
  --port PORTA          Porta do painel Web; padrão $DEFAULT_WEB_PORT.
  --no-browser          Não solicita abertura automática do navegador.
  --self-test           Validação segura do arquivo e do catálogo.
  --menu-preview        Lista as ações por grupo.
EOF
}

main(){
  require_bash_version
  local mode=web requested=""
  while (($#)); do
    case "$1" in
      --web) mode=web; shift;;
      --cli) mode=cli; shift;;
      --project-root) [[ $# -ge 2 ]] || { say fail "--project-root exige caminho."; exit 2; }; PROJECT_ROOT_OVERRIDE="$2"; shift 2;;
      --project-root=*) PROJECT_ROOT_OVERRIDE="${1#*=}"; shift;;
      --port) [[ $# -ge 2 ]] || { say fail "--port exige valor."; exit 2; }; WEB_PORT="$2"; shift 2;;
      --port=*) WEB_PORT="${1#*=}"; shift;;
      --no-browser) NO_BROWSER=true; shift;;
      --self-test) mode=selftest; shift;;
      --menu-preview) mode=preview; shift;;
      --list-actions-json) mode=actions_json; shift;;
      --status-json) mode=status_json; shift;;
      --run-action) [[ $# -ge 2 ]] || { say fail "--run-action exige ID."; exit 2; }; mode=action; requested="$2"; shift 2;;
      --run-action=*) mode=action; requested="${1#*=}"; shift;;
      --help|-h) show_help; exit 0;;
      *) say fail "Argumento desconhecido: $1"; show_help; exit 2;;
    esac
  done
  resolve_project_root
  ensure_state_dir
  case "$mode" in
    web) launch_web;;
    cli) cli_menu;;
    selftest) self_test;;
    preview) menu_preview;;
    actions_json) list_actions_json;;
    status_json) status_json;;
    action) run_action "$requested";;
  esac
}

main "$@"

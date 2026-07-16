#!/usr/bin/env bash
# ============================================================================
#  Kairo — Orquestrador de Projeto (WSL2 / Ubuntu)
#  Domine o Seu Tempo · Painel de controle premium de última geração (2026)
#  Uso: chmod +x scripts/unix/run.sh && ./scripts/unix/run.sh
# ============================================================================
set -uo pipefail

# ---------------------------------------------------------------------------
# Paleta de cores (True Color / ANSI) — identidade Kairo (#7c6fff → #ff8b5a)
# ---------------------------------------------------------------------------
if [[ -t 1 ]]; then
  ROXO=$'\e[38;2;124;111;255m'
  LARANJA=$'\e[38;2;255;139;90m'
  VERDE=$'\e[38;2;76;201;145m'
  VERM=$'\e[38;2;255;95;95m'
  AMAR=$'\e[38;2;241;196;15m'
  CINZA=$'\e[38;2;150;150;170m'
  BRANCO=$'\e[38;2;245;245;250m'
  NEG=$'\e[1m'; RST=$'\e[0m'
else
  ROXO=""; LARANJA=""; VERDE=""; VERM=""; AMAR=""; CINZA=""; BRANCO=""; NEG=""; RST=""
fi

PORTA="${PORT:-3000}"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/../.." && pwd )"
cd "$PROJECT_ROOT" || exit 1

# ---------------------------------------------------------------------------
# Barra de progresso dinâmica real
#   $1 = rótulo   $2 = duração aproximada (s)
# ---------------------------------------------------------------------------
barra_progresso() {
  local rotulo="$1" total="${2:-20}" largura=32
  local i preenchido vazio pct
  for ((i=0; i<=total; i++)); do
    pct=$(( i * 100 / total ))
    preenchido=$(( i * largura / total ))
    vazio=$(( largura - preenchido ))
    printf "\r  ${ROXO}%s${RST} [" "$rotulo"
    printf "${LARANJA}%0.s█${RST}" $(seq 1 $preenchido) 2>/dev/null
    printf "${CINZA}%0.s░${RST}" $(seq 1 $vazio) 2>/dev/null
    printf "] ${NEG}%3d%%${RST}" "$pct"
    sleep 0.03
  done
  printf "\n"
}

# Spinner enquanto um comando roda em segundo plano
spinner() {
  local pid=$1 msg=$2
  local frames='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
  local i=0
  while kill -0 "$pid" 2>/dev/null; do
    i=$(( (i+1) % 10 ))
    printf "\r  ${ROXO}${frames:$i:1}${RST} %s" "$msg"
    sleep 0.08
  done
  printf "\r  ${VERDE}✔${RST} %s\n" "$msg"
}

cabecalho() {
  clear
  echo ""
  echo "  ${ROXO}${NEG}╔══════════════════════════════════════════════════════════╗${RST}"
  echo "  ${ROXO}${NEG}║${RST}   ${LARANJA}◐${RST}  ${BRANCO}${NEG}K A I R O${RST}   ${CINZA}·  Domine o Seu Tempo${RST}                 ${ROXO}${NEG}║${RST}"
  echo "  ${ROXO}${NEG}║${RST}   ${CINZA}Orquestrador de Projeto · WSL2/Ubuntu · Edição 2026${RST}     ${ROXO}${NEG}║${RST}"
  echo "  ${ROXO}${NEG}╚══════════════════════════════════════════════════════════╝${RST}"
  echo ""
}

# ---------------------------------------------------------------------------
# Verificações de ambiente
# ---------------------------------------------------------------------------
checar_ambiente() {
  echo "  ${BRANCO}${NEG}Diagnóstico do ambiente${RST}"
  echo "  ${CINZA}────────────────────────────────────────────${RST}"
  if command -v node >/dev/null 2>&1; then
    echo "  ${VERDE}✔${RST} Node.js ....... ${BRANCO}$(node -v)${RST}"
  else
    echo "  ${VERM}✘${RST} Node.js não encontrado. Instale: ${ROXO}https://nodejs.org${RST}"
    return 1
  fi
  if command -v npm >/dev/null 2>&1; then
    echo "  ${VERDE}✔${RST} npm ........... ${BRANCO}$(npm -v)${RST}"
  else
    echo "  ${VERM}✘${RST} npm não encontrado."
    return 1
  fi
  if [[ -d node_modules ]]; then
    echo "  ${VERDE}✔${RST} Dependências .. ${BRANCO}instaladas${RST}"
  else
    echo "  ${AMAR}◌${RST} Dependências .. ${AMAR}ausentes (use a opção 3)${RST}"
  fi
  if lsof -i :"$PORTA" >/dev/null 2>&1 || ss -ltn 2>/dev/null | grep -q ":$PORTA "; then
    echo "  ${AMAR}◌${RST} Porta $PORTA ..... ${AMAR}em uso${RST}"
  else
    echo "  ${VERDE}✔${RST} Porta $PORTA ..... ${BRANCO}livre${RST}"
  fi
  echo ""
}

instalar_deps() {
  echo ""
  if [[ ! -f package.json ]]; then
    echo "  ${VERM}✘ package.json não encontrado neste diretório.${RST}"; return 1
  fi
  echo "  ${BRANCO}Instalando dependências do Kairo...${RST}"
  ( npm install --no-audit --no-fund >/tmp/kairo_npm.log 2>&1 ) &
  local npm_pid=$!
  spinner "$npm_pid" "npm install"
  if wait "$npm_pid"; then
    echo "  ${VERDE}✔ Dependências prontas.${RST}"
  else
    echo "  ${VERM}✘ Falha ao instalar. Veja /tmp/kairo_npm.log${RST}"
    return 1
  fi
}

abrir_navegador() {
  local url="http://localhost:$PORTA"
  echo "  ${ROXO}↗${RST} Abrindo ${BRANCO}$url${RST} ..."
  # WSL2: usa o navegador padrão do Windows quando disponível
  if command -v wslview >/dev/null 2>&1; then wslview "$url" >/dev/null 2>&1 &
  elif command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$url" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$url" >/dev/null 2>&1 &
  else echo "  ${AMAR}Abra manualmente: $url${RST}"; fi
}

preparar_e_subir() {
  local modo="$1"  # start | dev
  cabecalho
  checar_ambiente
  if [[ ! -d node_modules ]]; then
    instalar_deps
  fi
  barra_progresso "Preparando servidor" 18
  echo ""
  echo "  ${VERDE}${NEG}▶ Servidor Kairo iniciando em modo '${modo}'${RST}"
  echo "  ${CINZA}   URL: ${ROXO}http://localhost:$PORTA${RST}"
  echo "  ${CINZA}   (Ctrl+C para encerrar)${RST}"
  echo ""
  ( sleep 2; abrir_navegador ) &
  if [[ "$modo" == "dev" ]]; then
    PORT="$PORTA" npm run dev
  else
    PORT="$PORTA" npm start
  fi
}

reiniciar_banco() {
  echo ""
  local db_path="storage/database/kairo.sqlite"
  if [[ -f "$db_path" ]]; then
    local timestamp backup_path
    timestamp="$(date -u +%Y%m%d-%H%M%S)"
    backup_path="storage/backups/reset-manual-${timestamp}.sqlite"
    mkdir -p "storage/backups"
    barra_progresso "Criando backup de segurança" 12
    if ! cp -- "$db_path" "$backup_path"; then
      echo "  ${VERM}✘ O backup falhou. O banco original foi preservado.${RST}"
      return 1
    fi
    rm -f -- "$db_path" "${db_path}-shm" "${db_path}-wal"
    echo "  ${VERDE}✔ Banco reiniciado com backup em ${backup_path}.${RST}"
    echo "  ${CINZA}  Um novo espaço será criado na próxima inicialização.${RST}"
  else
    echo "  ${AMAR}◌ Nenhum banco encontrado — nada a fazer.${RST}"
  fi
}

menu() {
  cabecalho
  echo "  ${BRANCO}${NEG}Escolha uma ação:${RST}"
  echo ""
  echo "   ${ROXO}1${RST}  ${VERDE}▶${RST}  Iniciar aplicação  ${CINZA}(produção)${RST}"
  echo "   ${ROXO}2${RST}  ${AMAR}⚙${RST}  Modo desenvolvimento  ${CINZA}(nodemon, hot-reload)${RST}"
  echo "   ${ROXO}3${RST}  ${LARANJA}⬇${RST}  Instalar / atualizar dependências"
  echo "   ${ROXO}4${RST}  ${LARANJA}↻${RST}  Reiniciar banco de dados  ${CINZA}(seed limpo)${RST}"
  echo "   ${ROXO}5${RST}  ${ROXO}↗${RST}  Abrir no navegador"
  echo "   ${ROXO}6${RST}  ${VERDE}✔${RST}  Diagnóstico do ambiente"
  echo "   ${ROXO}0${RST}  ${VERM}✘${RST}  Sair"
  echo ""
  printf "  ${BRANCO}➜ Opção: ${RST}"
  read -r opc
  case "$opc" in
    1) preparar_e_subir "start" ;;
    2) preparar_e_subir "dev" ;;
    3) cabecalho; instalar_deps; echo ""; read -rp "  Pressione Enter para voltar..." _ ; menu ;;
    4) cabecalho; reiniciar_banco; echo ""; read -rp "  Pressione Enter para voltar..." _ ; menu ;;
    5) cabecalho; abrir_navegador; echo ""; read -rp "  Pressione Enter para voltar..." _ ; menu ;;
    6) cabecalho; checar_ambiente; read -rp "  Pressione Enter para voltar..." _ ; menu ;;
    0) echo ""; echo "  ${ROXO}Até logo! Foque no que importa. ◐${RST}"; echo ""; exit 0 ;;
    *) menu ;;
  esac
}

# Ponto de entrada — aceita argumento direto (start|dev|install|reset) ou menu
case "${1:-menu}" in
  start)   preparar_e_subir "start" ;;
  dev)     preparar_e_subir "dev" ;;
  install) cabecalho; instalar_deps ;;
  reset)   cabecalho; reiniciar_banco ;;
  *)       menu ;;
esac

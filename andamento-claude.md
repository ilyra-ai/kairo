# 📋 Andamento do Projeto Kairo — Tarefas Pendentes (categorizadas)

> **Regras deste arquivo**
> - Contém **apenas as tarefas PENDENTES** (as concluídas não são listadas).
> - Tudo **categorizado** por área do produto.
> - Cada tarefa é descrita no **máximo nível de detalhe**.
> - Deve ser **atualizado no início de cada nova atividade** (marcar a que está "🔵 EM ANDAMENTO").
> - Idioma: **pt-BR**. Tudo deve funcionar de forma **real** (sem simulações, placeholders, hardcode ou cortes).

**Última atualização:** **Tarefa 26 (Motor de Recompensa + Gestão de Dopamina) CONCLUÍDA e validada por HTTP.**
**Status geral:** 16 de 26 tarefas concluídas e validadas. 10 pendentes (categorizadas abaixo).

> ✅ **Concluído nesta rodada — Tarefa 26 (Motor de Recompensa Dopaminérgica + Gestão de Dopamina):**
> `rewards.js` (motor variável/RPE, moedas, streak, coleção, recordes, dopamenu, config das 9, flags de IA, feedback CSAT 1–5, dashboard executivo) + rotas em `server.js` + frontend (gancho central de celebração multissensorial, HUD, modais de recompensa e avaliação, página "Gestão de Dopamina" só admin com 9 toggles + dashboard executivo com Top 10, retenção D1/D7/D30, DAU/MAU, churn, A/B testing e RFM/LTV). Bug do streak corrigido (causa raiz) e validado.

---

## 🧭 Índice de categorias
1. 🎁 Engajamento, Gamificação & Neurociência — Tarefas **26**, **23**
2. 💳 Monetização & Pagamentos — Tarefa **13**
3. 🤖 Inteligência Artificial — Tarefas **15**, **16**
4. 📊 Dashboard & Visualização de Dados — Tarefas **18**, **19**, **20**, **21**
5. 📅 Agenda — Tarefa **22**
6. 📄 Documentação & Finalização — Tarefas **24**, **25**

---

## 🔧 Contexto técnico (para continuidade)
- **Stack:** Node.js (ESM) + Express + SQLite. Frontend Vanilla JS + HTML + CSS. Idioma pt-BR.
- **Arquivos-chave:** `server.js`, `script.js`, `index.html`, `styles.css`, `login.html`, `landing.html`.
- **Módulos backend:** `auth.js` (usuários/perfis/JWT), `plans.js` (planos/feature flags), `google-calendar.js`. **Novo:** `rewards.js` (motor de recompensa).
- **Padrão:** cada domínio vira `*.js` com `ensureXxxSchema(db)` + funções puras, carregado de forma **resiliente** no `server.js` (try/catch no import).
- **Perfis:** `administrador`, `free`, `plus`, `pro`. Admin seed: `admin@admin.com` / `admin123`. Configurações/Usuários/Planos = só administrador.
- **⚠️ Ambiente:** o sandbox de teste fica dessincronizado do disco real (mostra arquivos "truncados" que estão íntegros no disco). Validar montando cópia íntegra em `/tmp` ou iniciar sessão nova. **Commit/push deve ser feito manualmente pelo usuário.**

---

# 🎁 CATEGORIA 1 — Engajamento, Gamificação & Neurociência

### ✅ Tarefa 26 — Motor de Recompensa + Gestão de Dopamina — CONCLUÍDA E VALIDADA
> Esta tarefa foi finalizada e validada por HTTP (ver nota no topo). O detalhamento abaixo fica como **documentação de referência** do que foi entregue.

**Base científica:** efeito de conclusão, Erro de Previsão de Recompensa (RPE = surpresa gera o pico), reforço de razão variável, dopamina basal baixa no TDAH, micro-metas (+47% foco), Dopamine Menu.

**Pré-requisitos (implementar PRIMEIRO):**
- **P1. Hook central de conclusão:** unificar todos os eventos de "concluir" (toggle de compromisso, concluir foco, fim de ciclo Pomodoro) numa única função `celebrarConclusao(contexto)`.
- **P2. Backend `rewards.js` + tabelas:** `user_gamification` (moedas, streak atual/recorde, contagem do dia, recorde do dia, coleção JSON) e `dopamenu` (itens do cardápio). Rotas `POST /api/rewards/complete` (decide a recompensa **variável no servidor**), `GET /api/rewards/state`, CRUD `/api/dopamenu`.
- **P3. Biblioteca de celebração:** variantes de confete, múltiplos sons sintéticos (Web Audio), vibração háptica (`navigator.vibrate`).

**Os 9 recursos (implementar sobre a base):**
1. Recompensa **variável** + JACKPOT raro (sorteio ponderado no servidor).
2. **Baú/Loot** colecionável (acessórios, temas, selos, moedas).
3. **Combo/Momentum** (multiplicador por conclusões em sequência).
4. **Micro-conclusões** (cada micro-passo solta sua dose).
5. **Antecipação visível** ("faltam X para o baú").
6. **Mensagens RPE** ("Recorde!", "melhor que o esperado").
7. **Multissensorial** (confete + som + háptico + animação).
8. **Dopamenu** integrado (cardápio pessoal de recompensas).
9. **Recompensa em momento surpresa** (timing imprevisível).

**➕ Página "Gestão de Dopamina" (SOMENTE administrador) — 4 novas exigências:**
- **G1. Liga/desliga das 9 dopaminas:** nova página no menu (só admin) com **check** para ativar/desativar cada um dos 9 geradores quando quiser. Persistir em `dopamine_config`. O motor de recompensa respeita esses flags em tempo real.
- **G2. Dashboard executivo completo (nível big tech):**
  - **Top 10 usuários** por uso do app (para premiar separadamente) — ranking com métricas.
  - **O que os usuários mais gostam** (preferência agregada das 9 dopaminas, via avaliações).
  - **Qual das 9 dá mais resultado** (eficácia por gerador: uso × satisfação × retorno).
  - **+5 métricas obrigatórias que as maiores empresas usam:**
    1. **Retenção por coorte** (D1 / D7 / D30).
    2. **DAU/MAU (stickiness / índice de fidelidade).**
    3. **Churn & usuários em risco** (quem está abandonando).
    4. **A/B Testing / Experimentação** das recompensas (qual variante converte mais).
    5. **RFM + LTV** (Recência, Frequência, Valor / valor do tempo de vida).
- **G3. Modo IA (toggle do admin, só nas 9 dopaminas):** o admin ativa/desativa para que a IA (a) **nunca repita** o mesmo prêmio e (b) **aprenda as preferências** — identificando o que cada usuário mais gosta entre as 9 dopaminas. (Depende das Tarefas 15/16 para a IA; a base anti-repetição por heurística já funciona sem IA.)
- **G4. Avaliação do presente (CSAT 1–5):** ao receber o presente pela conclusão, perguntar **"gostou do presente?"** com escala **1 a 5** (técnica CSAT, padrão de mercado). A resposta é **salva na memória do usuário** (tabela `reward_feedback`) para a IA analisar e entregar as melhores recompensas.

**Tabelas novas:** `user_gamification`, `dopamenu`, `dopamine_config` (flags das 9), `reward_events` (histórico p/ métricas e anti-repetição), `reward_feedback` (avaliações 1–5).

**Critério de aceite:** concluir tarefa dispara celebração variável real (respeitando os flags), atualiza moedas/streak/recorde no banco, ocasionalmente baú/jackpot, pede avaliação 1–5 (salva); página "Gestão de Dopamina" (só admin) liga/desliga os 9 e mostra o dashboard executivo com dados reais; tudo testado por HTTP + validação de sintaxe.

### 🟣 Tarefa 23 — Recursos Inovadores (curadoria em andamento)
- **Aprovado pelo usuário:** *Termômetro de Energia & Cronotipo Inteligente* — registrar energia com 1 toque; app aprende picos/vales e sugere encaixar tarefas de alta carga cognitiva nos melhores horários; heatmap do ritmo.
- Demais recursos inovadores seguem em curadoria com o usuário (ex.: Foco Coletivo/Body Doubling, Gêmeo Digital, Mapa Emocional × Produtividade, Ritual de Encerramento). **Aguardar escolha final.**

---

# 💳 CATEGORIA 2 — Monetização & Pagamentos

### 🟡 Tarefa 13 — Gateways de Pagamento (Stripe, Mercado Pago, Nubank/Pix + PayPal + PagSeguro/Asaas)
- Módulo `payments.js` + tabelas `payment_config` e `subscriptions`. Painel admin para conectar cada gateway via API key. Checkout de plano → webhook confirma → atualiza `users.plan`.
- Rotas: `GET/POST /api/payments/config`, `POST /api/payments/checkout`, `POST /api/payments/webhook/:gateway`.
- **⚠️ Exige credenciais reais do usuário.** Sem elas, entrega-se estrutura + configuração; pagamento real só com as chaves.
- **Aceite:** conectar gateway com chave real, gerar cobrança sandbox, confirmar via webhook, plano do usuário muda.

---

# 🤖 CATEGORIA 3 — Inteligência Artificial

### 🟡 Tarefa 15 — Conexão de Modelos de IA via API/Token + Seleção de Modelo
- Em Configurações: inserir API key → app consulta **automaticamente** os modelos do provedor e popula um `<select>`; admin escolhe e **salva**.
- Provedores compatíveis com API OpenAI: OpenAI, OpenRouter, Anthropic, Groq, Together (detectar por base URL).
- Módulo `ai.js` (tabela `ai_config`) + rotas `POST /api/ai/models`, `GET/POST /api/ai/config`.
- **⚠️ Exige a chave de API real do usuário.**
- **Aceite:** inserir chave → modelos carregam sozinhos → salvar → persistido.

### 🟡 Tarefa 16 — Funcionalidades de IA + Chat Popup com Ações
- Análises/dicas/melhorias a partir dos dados do usuário.
- Chat flutuante (canto inferior direito) que executa ações reais via function calling: criar/editar/excluir/concluir tarefas e categorias (reusa `/api/agenda` e `/api/activities`).
- Respeitar feature flag `ai_assistant`. Depende da Tarefa 15.
- **Aceite:** pedir "crie uma tarefa amanhã 9h" e o compromisso aparecer real na agenda.

---

# 📊 CATEGORIA 4 — Dashboard & Visualização de Dados

### 🟢 Tarefa 18 — Dashboard em Tempo Real (auto-atualização)
- Auto-refresh (polling ~15–30s) de KPIs/cards/relógio; pausa em aba oculta (`visibilitychange`); atualização suave; indicador "ao vivo". **Credential-free, baixo risco.**

### 🟢 Tarefa 19 — Adicionar Novos Cards no Dashboard
- Botão "+ Nova Categoria/Card" + modal; **nova rota `POST /api/activities`** (cria atividade + timeframes zerados). Persistência real. **Credential-free.**

### 🟢 Tarefa 20 — Gráficos Temporais com Filtros (dia/mês/ano) + Drill-down Editável
- Gráfico temporal com **3 filtros de múltipla seleção** (dia/mês/ano), interativo e **clicável**: ao clicar, abre **tabela dinâmica abaixo** com **editar/excluir**. Endpoint de agregação `GET /api/analytics/timeseries`. Chart.js/SVG, mobile-first. **Credential-free.**

### 🟢 Tarefa 21 — Construtor de Gráficos + Drill-down
- Criar gráficos: **barras, donut, linhas, colunas, KPI, funil**, interativos e clicáveis (drill-down com tabela editável). Persistir gráficos do usuário (`user_charts`). **Credential-free.**

---

# 📅 CATEGORIA 5 — Agenda

### 🟢 Tarefa 22 — Novo Layout: Gráfico de Gantt
- Botão "Gantt" no seletor de layouts. Linha do tempo horizontal com barras por atividade (início→fim), clicável, com inserir/editar/excluir (via `/api/agenda`). Ideal: arrastar para mover/redimensionar. Responsivo. Seguir padrão `renderLayoutXxx()`. **Credential-free.**

---

# 📄 CATEGORIA 6 — Documentação & Finalização

### 🟢 Tarefa 24 — Confirmar `run.bat` no Windows (validação final)
- `run.sh` já foi VERIFICADO rodando no Linux (sobe o servidor). Falta o **usuário confirmar o `run.bat` na máquina Windows dele** (não executável no sandbox Linux). Investigar causa raiz de qualquer falha que ele reportar.

### 📄 Tarefa 25 — Atualizar o README.md (POR ÚLTIMO)
- Documentar TODOS os módulos: auth/usuários/perfis, planos/feature flags, motor de recompensa, pagamentos, IA/chat, dashboard tempo real, gráficos, Gantt, orquestradores e `.env`. Instruções de setup, admin e credenciais. **Fazer estritamente por último.**

---

## 📌 Ordem sugerida de execução
1. **26** (Motor de Recompensa) — 🔵 em andamento.
2. **18 → 19** (dashboard tempo real e novos cards) — rápidas, credential-free.
3. **20 → 21** (gráficos + drill-down) — credential-free, maior esforço.
4. **22** (Gantt) — credential-free.
5. **23** (Termômetro de Energia + demais inovações aprovadas) — credential-free.
6. **13** (pagamentos), **15 → 16** (IA) — quando o usuário fornecer credenciais.
7. **24** (confirmar run.bat no Windows).
8. **25** (README) — por último.

> Itens que **exigem credenciais do usuário**: 13 (pagamentos), 15 e 16 (IA). Os demais são 100% implementáveis sem credenciais.

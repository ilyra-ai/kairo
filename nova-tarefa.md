# 🚀 Prompt de Continuidade — Projeto Kairo (nova sessão / novo ambiente)

> **Como usar:** abra uma **sessão nova e limpa** do agente, com a pasta do projeto conectada, e **cole todo o conteúdo deste arquivo como a primeira mensagem**. Ele contém tudo o que a IA precisa para retomar o desenvolvimento do Kairo exatamente de onde paramos, sobre a arquitetura profissional atual, sem perder contexto.

---

## 1. REGRAS OBRIGATÓRIAS E INEGOCIÁVEIS (ler linha a linha, sem resumir)

1. Falar comigo em **pt-BR**; mostrar o que está fazendo em pt-BR; documentar em pt-BR; o idioma do app é pt-BR.
2. **Não resumir nem recontextualizar** minhas solicitações: ler linha a linha, sem pular linha.
3. Foco em **qualidade premium VIP**, não em agilidade.
4. Atuar como **especialista PhD + MBA**, profissional de elite, detalhista — nunca simplista.
5. Atuar como **especialista PhD + MBA em Design Web/Gráfico, CSS e UI/UX responsivo** (mobile-first e desktop).
6. Realizar a **validação geral completa do CRUD** na íntegra.
7. **Tudo deve funcionar de forma real**: sem simulações, placeholders, hardcode funcional, dados falsos ou cortes de código/linhas.
8. Seguir instruções e workflows por completo, na íntegra, linha a linha, sem resumir.
9. **Nunca contornar, mentir, pressupor ou enganar.** Ao encontrar erro/falha, **investigar a causa raiz** (inclusive pesquisando na internet) e corrigir de forma real.
10. **Analisar e inspecionar** o código e a documentação antes de alterar.
11. Atuar como **QA navegando via navegador** por todos os menus, links, botões do sidebar, páginas, dropdown de perfil, configurações, cards e tabelas, identificando erros/falhas/incompatibilidades/APIs.
12. Atuar como **Engenheiro de Desenvolvimento PhD + MBA**, buscando a causa raiz dos erros e corrigindo de forma real.
13. Em novas implementações, **pesquisar profundamente na internet as tendências TOP/PREMIUM/VIP de 2026** e implementar de forma real.
14. **Backend, banco, autorização e regras de negócio antes da camada visual** correspondente.
15. **Uma tarefa por vez, completa e validada de ponta a ponta**, mantendo os testes existentes **sempre verdes**.
16. **DAR ANDAMENTO SEGUINDO ESTRITAMENTE O `andamento-claude.md`** (é a fila oficial) e **É OBRIGATÓRIO ATUALIZAR ESSE ARQUIVO NO INÍCIO E NO FINAL DE CADA TASK/ATIVIDADE.** Ver o Protocolo detalhado na Seção 10 — uma tarefa **não é considerada concluída** enquanto o `andamento-claude.md` não for atualizado.
17. Nunca commitar versões parciais/truncadas. Se o ambiente truncar arquivos, parar, achar a causa raiz e corrigir antes de prosseguir.

---

## 2. O QUE É O PROJETO

**Kairo** é uma aplicação web de **produtividade pessoal em pt-BR** (agenda multilayout, atividades, metas, KPIs, Pomodoro inclusivo TDAH/TEA, preferências, gamificação/Dopamenu, administração de usuários e planos, integração opcional com Google Agenda). **Local-first**, backend como fonte de verdade, privacidade por arquitetura.

- Repositório: `https://github.com/ilyra-ai/personal-time-tracker` (branch `main`).
- **Fontes de verdade obrigatórias a ler antes de tudo:**
  - `README.md` (estado real, arquitetura, API, segurança, limitações);
  - `andamento-claude.md` (fila oficial detalhada de tarefas pendentes, com requisitos, dependências, riscos e critérios de aceite).

---

## 3. ESTADO ATUAL VERIFICADO (baseline real)

- **Arquitetura profissional já implementada** (não mudar a estrutura, apenas evoluir sobre ela).
- **Baseline VERDE confirmado:** `npm test` → **56 testes nativos passando, 0 falhas**; `npm ci` compila `better-sqlite3` e o ambiente valida de verdade; auditoria com 0 vulnerabilidades conhecidas; suíte E2E Playwright/Chromium (4 fluxos) aprovada.
- **Operacional hoje:** páginas públicas (landing/login/app protegido), autenticação + sessões + CSRF + reautenticação, isolamento multiusuário, dashboard/atividades/metas/KPIs, agenda (CRUD, conclusão, filtros, 7 layouts), perfil/preferências, planos + feature flags (backend), recompensas/Dopamenu, Google Agenda quando configurado (OAuth `state` + tokens AES-256-GCM por usuário).
- **Ainda NÃO implementado (na fila):** IA generativa/provedores locais (Ollama/LM Studio) e remotos, memória de IA, Estúdio de Treinamento, assistente/chat/copiloto, pagamentos reais, dashboard em tempo real, gráficos/séries temporais/Gantt, energia/cronotipo, construtor de gráficos, e os 12 recursos inteligentes da Tarefa 35.

---

## 4. ARQUITETURA E CONVENÇÕES (seguir à risca)

**Stack:** Node.js ≥ 20 (ESM), Express 4, **better-sqlite3**, Zod (validação), Helmet/CSP, express-rate-limit, JWT em cookie `httpOnly`, bcryptjs, googleapis. Frontend em **HTML/CSS/JS nativos sem build**. ESLint + Prettier + `node:test` + Playwright.

**Estrutura principal:**

```
public/                         # ÚNICO conteúdo servido ao navegador
  index.html (landing), auth/index.html (login), app/index.html (app)
  assets/css/app.css, assets/js/app.js, assets/images/
src/server/
  index.js (entrada), runtime.js (init/shutdown), app.js (composição HTTP e rotas)
  config/ (ambiente validado por Zod + caminhos)
  database/ (sqlite-client.js, index.js, bootstrap.js, migrations/, seeds/)
  middleware/ (authentication.js, error-handler.js, http-security.js, rate-limit.js, validation.js)
  modules/<domínio>/<domínio>.routes.js + .schemas.js + .service.js
  security/ (criptografia/segredos), shared/ (erros HTTP)
tests/ (unit, integration, migration, frontend, e2e)
scripts/ (windows/run.bat, unix/run.sh, quality/)
storage/ (banco, backups, logs, secrets — ignorado pelo Git)
```

**Padrões obrigatórios ao criar um novo domínio/módulo:**

- Cada módulo tem **`.routes.js` (factory `create<Nome>Router(services...)`)** + **`.schemas.js` (Zod)** + **`.service.js`** (regra de negócio com acesso ao `SqliteClient`).
- **Migração versionada** em `src/server/database/migrations/` (seguir o formato da `001-tenant-isolation.js`: criação idempotente, `foreign_key_check`, transacional) e registrá-la no runner em `src/server/database/index.js`.
- Registrar o router em `src/server/app.js` com os middlewares corretos: `requireAuth`, `featureAuthorization(services.plans, '<feature>')` para planos, e guardas de **admin + CSRF + reautenticação recente** para ações sensíveis/administrativas.
- **Isolamento por `user_id`** em todo dado pessoal (FKs compostas), consultas sempre escopadas ao proprietário.
- **Frontend sem inline** (CSP sem `unsafe-inline`, sem atributos `style`, sem `innerHTML` de conteúdo não confiável); tudo acessível e responsivo (mobile-first).
- **Testes obrigatórios** (unit/integration/migration + E2E quando houver UI) para cada funcionalidade nova; manter cobertura mínima (lines/statements ≥ 80, functions ≥ 90, branches ≥ 75).
- **Contrato de erro** padrão: `{ error: { code, message (pt-BR), requestId } }`.
- **Papéis** (`administrador` | `usuario`) são **separados dos planos** (`free` | `plus` | `pro`). Não existe admin/senha padrão: a **primeira conta criada por loopback** vira `administrador`/`pro`.

**Comandos de setup e validação (usar sempre):**

```bash
npm ci                 # instala e compila better-sqlite3
npm start              # sobe em http://localhost:3000  (app em /app, login em /login)
npm test               # 56 testes nativos — devem ficar verdes
npm run check          # lint + format + sintaxe + testes + cobertura + política do repo
npm run check:full     # check + E2E navegado (Playwright/Chromium)
```

A primeira conta administrativa só pode ser criada **localmente** em `http://localhost:3000/login` → "Criar conta".

---

## 5. FILA DE TAREFAS PENDENTES (fonte detalhada: `andamento-claude.md`)

**19 tarefas pendentes**, por categoria:

- 🛡️ **Segurança/Fundação:** **31** (segurança, autorização e isolamento multiusuário — quase concluída, falta QA navegada integral), **32** (dependências, migrações, testes, CI e qualidade), **29** (direitos do titular, exclusão de conta e retenção legal — LGPD/ANPD/Receita).
- 🤖 **Inteligência Artificial:** **15** (gateway de provedores remotos + **locais Ollama/LM Studio**, anti-SSRF, matriz de capacidades, segredos criptografados), **27** (nova página admin **"Configurações de IA" + Estúdio de Treinamento** — mover config de IA para fora de Configurações; skills/workflows/instruções versionados; pacote inicial de competências), **28** (**memória de IA por usuário, criptografada e privada**, com nota honesta de segurança), **16** (**assistente/chat com ações + copiloto na criação de tarefas**), **30** (**dashboard de memória + governança** — admin limpa memória de usuário; usuário limpa mas nunca lê; exclusão de conta com **retenção legal obrigatória**; **+5 tendências de IA 2026**).
- 📊 **Dashboard/Visualização:** **18** (tempo real/auto-atualização), **19** (CRUD de categorias/novos cards), **20** (gráficos temporais com 3 filtros de múltipla seleção dia/mês/ano + drill-down editável), **21** (construtor de gráficos: barras/donut/linha/coluna/KPI/funil + drill-down).
- 📅 **Agenda:** **22** (layout **Gráfico de Gantt** interativo com inserir/editar/excluir).
- 🎁 **Engajamento/Neurociência/Inovação:** **23** (Termômetro de Energia + cronotipo + curadoria), **35** (**Suíte de Produtividade Inteligente Administrável — 12 recursos premium 2026**, com governança `smart_features` administrável só pelo admin, engines determinísticos e IA opcional).
- 💳 **Monetização:** **13** (gateways: Stripe, Mercado Pago, Nubank/Pix, PayPal, PagSeguro/Asaas — **exige credenciais reais do usuário**).
- 🎨 **Marca/Landing:** **33** (redesign integral da landing premium 2027), **34** (tipografia global Imprima).
- ✅ **Validação:** **24** (validação final do `run.bat` no Windows).

---

## 6. ORDEM RECOMENDADA E PRIMEIRA TAREFA

**Comece nesta ordem (cada uma como fatia vertical completa + testada):**

1. **Tarefa 31 — finalizar QA navegada de segurança/isolamento** (fechar acessibilidade e rótulos pendentes; rodar `npm run check:full` e consolidar). É pré-requisito estrutural.
2. **Tarefa 35 — fundação de governança `smart_features`** (migração + service + rotas admin + schemas Zod + testes): tabelas `smart_features`, `smart_feature_config`, `smart_feature_audit`; APIs `GET/PUT /api/admin/smart-features…`, `POST .../:key/test`, auditoria; UI admin de cards clicáveis na página de Configurações (só admin) para editar/ligar/desligar/testar e **vincular modelo de IA** a cada recurso. É o alicerce dos 12 recursos.
3. **Tarefa 15 — gateway de IA** (Ollama `http://127.0.0.1:11434`, LM Studio `http://127.0.0.1:1234`, + remotos OpenAI/OpenRouter/Anthropic/Groq/Together), com `provider_type` explícito, matriz de capacidades, anti-SSRF, timeouts/retry/circuit breaker, segredos criptografados que nunca reaparecem.
4. **Tarefas 27 → 28 → 30 → 16** (Configurações de IA + Estúdio de Treinamento → memória criptografada → dashboard de memória/governança/exclusão de conta com retenção legal → assistente/chat/copiloto).
5. **Tarefas 18 → 19 → 20 → 21 → 22** (dashboard tempo real, cards, gráficos temporais e construtor de gráficos com drill-down editável, Gantt).
6. **Tarefa 23 + Tarefa 35 (os 12 recursos)** e **Tarefa 13 (pagamentos)** quando houver credenciais.
7. **Tarefas 33/34** (landing 2027 + Imprima) e **24** (run.bat Windows).

> **Princípio técnico crítico (causa raiz, comprovado por pesquisa 2026):** o **agendamento autônomo** (Tarefa 35.2 "Auto-organizar meu dia") NÃO deve usar LLM puro — os líderes (Motion/Reclaim/SkedPal/Lifestack) usam **motor de restrições determinístico**; o LLM só interpreta linguagem natural e explica. O **affective computing** (35.11 Mapa Emocional) deve ser **privacy-first/on-device**, e o admin **nunca** lê humor individual do usuário. Tudo em `andamento-claude.md`, Tarefa 35.

---

## 7. REQUISITOS TRANSVERSAIS DA CAMADA DE IA E DOS 12 RECURSOS

- **Somente o `administrador`** acessa Configurações de IA, Estúdio de Treinamento, governança de memória e a governança dos recursos inteligentes — na **página de Configurações do app**, tudo **dinâmico, interativo e clicável**, podendo **criar, editar, excluir, ativar/desativar e incorporar o modelo de IA** a cada função/recurso.
- Proteção **no backend** além de ocultar menu (ocultar não é controle de acesso); CSRF + reautenticação recente em mudanças sensíveis; auditoria de toda alteração.
- **Memória de IA:** criptografada em repouso, isolada por usuário, com consentimento/minimização/expiração/exclusão real; o admin gerencia (limpar por usuário) mas **não lê conteúdo bruto**; o usuário pode **limpar** a própria memória e **excluir a conta on-time**, respeitando **dados obrigatórios por lei** (LGPD/ANPD/Receita Federal/fiscal — **pesquisar e nunca apagar os dados legalmente exigidos**, mantendo-os vinculados ao usuário correto e criptografados). Dashboard de memória (donut, barras, linha temporal com 3 filtros multi-seleção dia/mês/ano) com **Top 10 de consumo de memória** — só admin, sem expor dado sensível.
- **Copiloto na criação de tarefas:** ao criar atividade/tarefa, o usuário pode (opcional) pedir à IA: revisar ortografia, melhorar a descrição, sugerir execução mais rápida, dar dicas — e mais melhorias que a IA julgar úteis.
- **Sem modelo de IA conectado, cada recurso continua real e útil** por regras determinísticas; a IA é camada opcional incorporável pelo admin.

---

## 8. AVISOS IMPORTANTES

- **Não alterar a arquitetura** existente — apenas evoluir sobre ela, seguindo os padrões dos módulos atuais.
- **Credenciais necessárias em algum momento** (fornecidas pelo usuário): chaves de IA remota (se usar nuvem), credenciais dos gateways de pagamento, e credenciais OAuth do Google. Provedores locais (Ollama/LM Studio) não exigem chave.
- **Ao iniciar cada tarefa:** marcar 🔵 EM ANDAMENTO no `andamento-claude.md`; ao concluir, atualizar o arquivo, rodar `npm run check` (ou `check:full`) e só então considerar pronta.
- **Idioma, honestidade e realidade** acima de tudo: nada de simulação, placeholder, hardcode funcional ou corte de código.

---

## 9. MENSAGEM INICIAL SUGERIDA PARA COLAR NA SESSÃO NOVA

> "Você é uma engenheira/desenvolvedora PhD + MBA de elite. Leia integralmente o `README.md` e o `andamento-claude.md` na raiz do projeto Kairo, respeite TODAS as regras deste `nova-tarefa.md` (seções 1 a 10), confirme o baseline com `npm ci && npm test` (devem passar 56 testes), marque a tarefa escolhida como 🔵 EM ANDAMENTO no `andamento-claude.md` (Seção 10), implemente de forma real e testada começando pela **Tarefa 31 (finalização)** e depois pela **Tarefa 35 (fundação `smart_features`)**, sem alterar a arquitetura, uma tarefa por vez mantendo os testes verdes, e **ao concluir cada tarefa atualize obrigatoriamente o `andamento-claude.md` (Seção 10)**. Fale comigo em pt-BR e não pare até concluir cada fatia com validação."

---

## 10. PROTOCOLO OBRIGATÓRIO DE ATUALIZAÇÃO DO `andamento-claude.md` (não negociável)

> ⚠️ **Regra de ouro:** o `andamento-claude.md` é a **fila oficial** e o **registro vivo** do projeto. Toda atividade deve **começar** e **terminar** atualizando esse arquivo. **Uma tarefa NÃO está concluída enquanto o `andamento-claude.md` não estiver atualizado.**

### 10.1 — Ao INICIAR qualquer tarefa/atividade (antes de tocar em código)

1. Abrir o `andamento-claude.md` e **marcar a tarefa escolhida como `🔵 EM ANDAMENTO`** no seu título.
2. Confirmar/atualizar o **inventário** e a **"Próxima tarefa recomendada"** no topo do arquivo.
3. Registrar um breve "ponto de partida" (o que será feito, dependências, riscos), sem apagar histórico relevante.

### 10.2 — Ao FINALIZAR qualquer tarefa/atividade (obrigatório, bloqueante)

1. **Só considerar concluída após** rodar a validação proporcional ao risco: `npm run check` (ou `npm run check:full` quando houver UI) **verde**, com os 56+ testes passando e novos testes adicionados para a funcionalidade.
2. **Remover a tarefa da fila de pendentes** do `andamento-claude.md` (a convenção do arquivo é conter **somente tarefas pendentes**; o que foi concluído pertence ao código, ao Git e ao `README.md`).
3. **Atualizar** no arquivo: o **inventário** (quantidade e IDs pendentes), o **índice de categorias**, a **"Última atualização"** (data + marco) e a **"Próxima tarefa recomendada"**.
4. **Registrar a evidência real** da conclusão (o que foi implementado, quais testes/HTTP/E2E comprovaram, e decisões de arquitetura tomadas) — sem inflar, sem simular.
5. Atualizar o `README.md` quando o estado real do produto mudar (tabela "Estado verificado", API, funcionalidades, limitações).
6. **Commit** com mensagem clara em pt-BR somente após tudo verde e o `andamento-claude.md` atualizado; nunca commitar versão parcial ou truncada.

### 10.3 — Regras de integridade do arquivo

- Nunca resumir, cortar linhas ou perder requisitos já registrados; ao editar, preservar o conteúdo existente.
- Se o ambiente truncar/dessincronizar o arquivo, **parar, investigar a causa raiz e restaurar a íntegra** antes de prosseguir.
- Manter tudo em **pt-BR**, no **nível máximo de detalhe** (sem "mendigar caracteres").
- Cada tarefa mantém seus **critérios de aceite**; só sai da fila quando **todos** forem cumpridos e comprovados de verdade.

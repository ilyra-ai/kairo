<p align="center">
  <img src="./public/assets/images/kairo-logo.svg" width="112" alt="Logotipo do Kairo">
</p>

<h1 align="center">Kairo</h1>

<p align="center">
  <strong>Domine o seu tempo com agenda, foco, contexto e decisões baseadas em dados reais.</strong>
</p>

<p align="center">
  <img alt="Node.js 20 ou superior" src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=nodedotjs&logoColor=white">
  <img alt="Express 4" src="https://img.shields.io/badge/Express-4-111111?logo=express&logoColor=white">
  <img alt="SQLite" src="https://img.shields.io/badge/SQLite-better--sqlite3-003B57?logo=sqlite&logoColor=white">
  <img alt="Testes automatizados" src="https://img.shields.io/badge/testes-56%20nativos%20%2B%207%20E2E-2EA44F">
  <img alt="Idioma português do Brasil" src="https://img.shields.io/badge/idioma-pt--BR-009C3B">
</p>

<p align="center">
  <a href="#início-rápido">Início rápido</a> ·
  <a href="#funcionalidades">Funcionalidades</a> ·
  <a href="#arquitetura">Arquitetura</a> ·
  <a href="#api-http">API</a> ·
  <a href="#qualidade-e-validação">Qualidade</a> ·
  <a href="./andamento-claude.md">Andamento integral</a>
</p>

> [!IMPORTANT]
> O Kairo está em desenvolvimento ativo. A base atual é **local-first**, possui autenticação, isolamento multiusuário, proteção CSRF, confirmação da senha exclusivamente na troca de senha, auditoria e criptografia dos tokens OAuth. Ainda existem itens impeditivos para uma publicação pública, registrados em [Limitações conhecidas](#limitações-conhecidas).

## O que é o Kairo

O **Kairo** é uma aplicação web de produtividade pessoal em português do Brasil. Ela reúne gestão de atividades, agenda multilayout, metas, indicadores, Pomodoro inclusivo, preferências, gamificação, administração de usuários, planos e integração opcional com o Google Agenda.

Os dados funcionais são persistidos em SQLite. As telas consomem APIs reais do backend; integrações indisponíveis não são substituídas por respostas simuladas.

### Princípios

- **Privacidade por arquitetura:** cada registro operacional pertence ao usuário autenticado.
- **Local-first:** banco, backups, logs e segredos permanecem em `storage/` por padrão.
- **Backend como fonte de verdade:** regras de acesso, validações e autorização não dependem apenas da interface.
- **Uma agenda, sete perspectivas:** todos os layouts usam os mesmos eventos persistidos.
- **Segurança fechada:** falhas de autenticação não liberam a aplicação.
- **Evolução auditável:** decisões e tarefas ficam registradas em [`andamento-claude.md`](./andamento-claude.md).

## Estado verificado

Verificação local mais recente: **18 de julho de 2026**.

| Área | Estado real | Evidência atual |
|---|---|---|
| Inicialização e páginas públicas | Operacional | Landing, login, aplicação protegida, assets e redirecionamentos validados por HTTP. |
| Autenticação e sessões | Operacional | Bootstrap local, login, logout, revogação, cookie `httpOnly`, CSRF e confirmação da senha na troca de senha testados. |
| Isolamento multiusuário | Operacional | FKs compostas, consultas por proprietário e testes de tentativa de acesso cruzado. |
| Dashboard, atividades e metas | Operacional | CRUD de atividades, períodos, metas e KPIs reais. |
| Agenda | Operacional | CRUD, conclusão rápida, filtros, duração em minutos e sete layouts. |
| Perfil e preferências | Operacional | Nome, e-mail, avatar validado, tema, som e confete por usuário. |
| Planos e funcionalidades | Operacional no backend | Matriz persistida e autorização aplicada a dashboard, atividades, agenda e Google Agenda. |
| Recompensas e Dopamenu | Operacional | Estado, conclusão idempotente, feedback, itens pessoais, configurações e painel agregado. |
| Google Agenda | Operacional quando configurado | OAuth com `state`, tokens AES-256-GCM por usuário e sincronização manual testada com cliente controlado. |
| IA generativa | Não implementada | A configuração atual de recompensas usa regras; não existe LLM conectado nesta versão. |
| Testes automatizados | Operacional | **56 testes nativos + 7 testes E2E Chromium aprovados**, sem falhas. |
| Auditoria de dependências | Operacional | `npm install` reporta **0 vulnerabilidades conhecidas** na árvore instalada. |

## Início rápido

### Requisitos

- Git;
- Node.js **20 ou superior** — Node.js 24 LTS é recomendado para uso estável;
- npm 10 ou superior;
- navegador moderno com CSS Grid, Web Audio API e cookies habilitados.

### Instalação

```bash
git clone https://github.com/ilyra-ai/personal-time-tracker.git
cd personal-time-tracker
npm ci
npm start
```

Acesse:

- landing page: [http://localhost:3000/](http://localhost:3000/);
- login e cadastro: [http://localhost:3000/login](http://localhost:3000/login);
- aplicação autenticada: [http://localhost:3000/app](http://localhost:3000/app);
- saúde da API: [http://localhost:3000/api/health](http://localhost:3000/api/health).

### Primeira conta

Não existe usuário ou senha padrão. Quando o banco ainda não possui contas:

1. abra `/login` no próprio computador do servidor;
2. escolha **Criar conta**;
3. informe nome, e-mail e uma senha com pelo menos 8 caracteres;
4. a primeira conta recebe papel `administrador` e plano `pro`;
5. os dados legados preservados, quando existentes, são associados a esse proprietário durante o bootstrap.

Por segurança, a primeira conta administrativa só pode ser criada por uma requisição local ao servidor.

#### Conta administrativa do ambiente local

O Kairo não possui usuário administrativo fixo, senha padrão ou credencial de demonstração versionada. A primeira conta criada localmente recebe o papel `administrador` e o plano `pro`; as contas seguintes entram como `usuario` no plano `free`.

### Política de senha e reautenticação

- A senha exige **no mínimo 8 caracteres** (máximo de 128). Não há exigência de letra maiúscula, número ou caractere especial.
- A senha é solicitada **apenas em dois momentos**: no login e ao alterar a senha de uma conta existente.
- Navegar, criar, editar, concluir ou excluir registros, salvar perfil e preferências, e executar operações administrativas **nunca** solicitam a senha novamente — a proteção dessas rotas é feita por sessão, papel e token CSRF.
- Cada usuário altera a própria senha em **Meu Perfil → Alterar minha senha**, informando a senha atual. Ao concluir, as demais sessões do usuário são revogadas automaticamente.

### Inicializadores assistidos

Para o QA local do Kairo no Windows, use os inicializadores oficiais da raiz:

```powershell
.\qa-iniciar-servidor.bat
```

Para encerrar somente o processo que escuta a porta `3000` e iniciar o código atual novamente:

```powershell
.\qa-reiniciar-servidor.bat
```

O orquestrador universal validado no Windows 11 também está disponível na raiz:

```powershell
.\run.bat
```

Ele detecta a stack, instala exatamente o `package-lock.json`, oferece ações não interativas e uma TUI em pt-BR, mantém metadados próprios de processo em `.orchestrator/` e nunca encerra um processo externo apenas porque ele ocupa a porta escolhida. Consulte [a validação operacional completa](docs/quality/validacao-run-windows.md).

Inicializador assistido específico do Kairo no Windows:

```powershell
.\scripts\windows\run.bat
```

Linux, WSL ou macOS:

```bash
chmod +x scripts/unix/run.sh
./scripts/unix/run.sh
```

Os inicializadores específicos localizam a raiz do projeto, verificam Node/npm, instalam dependências e iniciam o servidor. A opção de reiniciar o banco cria um backup em `storage/backups/` antes de remover a base operacional.

### Scripts npm

| Comando | Resultado |
|---|---|
| `npm start` | Inicia `src/server/index.js`. |
| `npm run dev` | Inicia o servidor com reinicialização pelo Nodemon. |
| `npm test` | Executa toda a suíte nativa `node:test`. |
| `npm run test:windows` | Valida o ciclo real do orquestrador em Windows, inclusive bootstrap limpo, SQLite nativo, porta, reinício e isolamento de processos. |
| `npm run test:e2e` | Executa o QA real Playwright/Chromium com servidor e banco temporários. |
| `npm run test:coverage` | Executa os testes com cobertura experimental do Node.js. |
| `npm run check:syntax` | Valida a sintaxe do ponto de entrada e do JavaScript do app. |
| `npm run check` | Executa lint, formatação, sintaxe, testes nativos, cobertura e política do repositório. |
| `npm run check:e2e` | Executa a suíte E2E navegada. |
| `npm run check:full` | Executa o ciclo completo de qualidade local, incluindo E2E. |

## Funcionalidades

### Dashboard e atividades

- cartões por categoria com período diário, semanal e mensal;
- horas atuais e anteriores;
- metas por período e progresso visual;
- KPIs consolidados por usuário;
- criação, consulta, atualização e exclusão de atividades pela API;
- recálculo da agenda sem misturar dados entre contas.

As categorias iniciais são Trabalho, Lazer, Estudos, Exercícios, Social e Autocuidado. Elas são sementes versionadas em `src/server/database/seeds/default-activities.json`, não dados ocultos no frontend.

### Agenda unificada

- criação, leitura, edição, conclusão, reabertura e exclusão;
- associação obrigatória a uma atividade do mesmo usuário;
- data, início, término, descrição, prioridade, carga cognitiva e cor;
- duração calculada e persistida em minutos;
- filtros por intervalo, atividade e conclusão;
- ações rápidas de foco, edição e remoção;
- sete layouts sobre a mesma fonte de dados.

| Layout | Uso principal |
|---|---|
| **TDAH/TEA** | Reduzir carga visual, destacar esforço e orientar o próximo passo. |
| **Atual** | Timeline vertical própria do Kairo. |
| **Google** | Grade semanal com colunas redimensionáveis. |
| **TickTick** | Lista compacta com conclusão rápida. |
| **Morgen** | Time blocking diário. |
| **Todoist** | Lista agrupada por categoria. |
| **Kanban** | Planejado, em andamento e concluído. |

### Modo foco

- ciclos de 15, 25 e 50 minutos;
- iniciar, pausar, retomar e reiniciar;
- anel de progresso;
- vínculo com um compromisso real;
- chuva, ondas, ruído, áudio binaural de 40 Hz ou silêncio;
- sino de conclusão, confete configurável e resposta háptica quando suportada.

### Conta, perfil e administração

- senha de 12 a 128 caracteres com requisitos de complexidade;
- hash `bcrypt` com atualização de custo quando necessário;
- sessão revogável persistida no banco;
- cookie `httpOnly`, `SameSite` e configuração segura por ambiente;
- token CSRF por sessão em todas as mutações protegidas;
- confirmação de senha para operações sensíveis;
- papéis separados dos planos: `administrador` ou `usuario`;
- planos comerciais independentes: `free`, `plus`, `pro` ou planos criados pelo administrador;
- proteção contra remoção ou rebaixamento do último administrador ativo;
- registro de eventos de auditoria sem armazenar senhas.

### Planos e feature flags

O backend mantém catálogo, preço em centavos, descrição, funcionalidades e matriz de autorização. Os planos padrão são:

| Plano | Recursos padrão |
|---|---|
| `free` | Dashboard, agenda, relatórios, Pomodoro e temas. |
| `plus` | Recursos Free, binaural e Google Agenda. |
| `pro` | Todos os recursos cadastrados. |

Administradores possuem acesso operacional total, independentemente do plano. A interface administrativa permite criar planos e funcionalidades, excluir itens não protegidos e alterar a matriz.

### Recompensas e Dopamenu

- moedas, sequência diária e combos;
- conclusão idempotente: o mesmo compromisso não concede recompensa duplicada;
- baús, itens colecionáveis e feedback;
- Dopamenu privado por usuário;
- configurações administrativas de geradores;
- painel executivo derivado de agregações reais do banco;
- eventos auditados e isolados por proprietário.

Os nomes históricos `ai_reward_config` e “IA” nessa área representam regras configuráveis. Eles não significam que um modelo generativo já esteja conectado.

### Google Agenda

- OAuth 2.0 com `state` de uso único vinculado ao usuário e à sessão;
- autorização, callback, status, sincronização e desconexão;
- tokens criptografados com AES-256-GCM e contexto autenticado por usuário;
- preservação segura de `refresh_token`;
- validação de propriedade antes de enviar, atualizar ou excluir eventos;
- revogação remota antes da remoção local da conexão;
- janela de sincronização configurável dentro dos limites validados.

## Arquitetura

```mermaid
flowchart LR
    B["Navegador"] --> P["public/"]
    P --> F["HTML, CSS e JavaScript nativos"]
    F --> H["Express HTTP"]
    H --> M["Autenticação, CSRF, limites e autorização"]
    M --> D["Módulos de domínio"]
    D --> S[("SQLite por usuário")]
    D --> G["Google Calendar API"]
    K["storage/secrets"] --> M
    K --> D
```

### Camadas

| Camada | Local | Responsabilidade |
|---|---|---|
| Interface pública | `public/` | Landing, login, aplicação e assets versionados. |
| Composição HTTP | `src/server/app.js` | Middlewares, rotas, páginas e tratamento de erros. |
| Inicialização | `src/server/runtime.js` | Diretórios, banco, migração, serviços e encerramento. |
| Configuração | `src/server/config/` | Ambiente validado e caminhos absolutos. |
| Segurança | `src/server/middleware/` e `src/server/security/` | Sessão, CSRF, CORS, Helmet, rate limit, confirmação de senha na troca e AES-GCM. |
| Domínio | `src/server/modules/` | Atividades, agenda, autenticação, dashboard, Google, planos, perfil e recompensas. |
| Persistência | `src/server/database/` | Cliente SQLite, migrações, bootstrap e sementes. |
| Dados locais | `storage/` | Banco, backups, logs e chaves; conteúdo ignorado pelo Git. |

### Fluxo de uma mutação sensível

```mermaid
sequenceDiagram
    participant U as Usuário
    participant W as Interface
    participant A as API Kairo
    participant D as SQLite
    U->>W: Confirma a ação
    W->>A: Requisição com cookie e X-CSRF-Token
    A->>A: Valida sessão, papel, plano e CSRF
    alt autenticação recente ausente
        A-->>W: REAUTENTICACAO_NECESSARIA
        W->>U: Solicita a senha atual
        W->>A: POST /api/auth/reauthenticate
    end
    A->>D: Transação escopada pelo user_id
    D-->>A: Resultado persistido
    A-->>W: JSON sem dados sensíveis
```

## Configuração

Copie o modelo e ajuste somente o necessário:

```powershell
Copy-Item .env.example .env
```

| Variável | Padrão | Finalidade |
|---|---|---|
| `NODE_ENV` | `development` | Ambiente: `development`, `test` ou `production`. |
| `HOST` | `127.0.0.1` | Interface de rede de escuta. |
| `PORT` | `3000` | Porta HTTP. |
| `CORS_ORIGINS` | localhost da porta atual | Origens adicionais separadas por vírgula; `*` é rejeitado. |
| `TRUST_PROXY` | `false` | Confiança em proxy reverso explicitamente configurado. |
| `COOKIE_NAME` | `kairo.session` | Nome do cookie de sessão. |
| `COOKIE_SECURE` | depende do ambiente | Exige HTTPS quando `true`; padrão `true` em produção. |
| `COOKIE_HTTP_ONLY` | `true` | Não pode ser desativado. |
| `COOKIE_SAME_SITE` | `lax` | Política `strict`, `lax` ou `none`. |
| `COOKIE_DOMAIN` | vazio | Domínio opcional do cookie. |
| `SESSION_TTL_SECONDS` | `28800` | Duração da sessão, entre 5 minutos e 30 dias. |
| `SESSION_SECRET` | gerado localmente | Segredo com no mínimo 32 bytes. |
| `ENCRYPTION_KEY` | gerada localmente | Chave AES-256 com exatamente 32 bytes. |
| `KAIRO_DB_PATH` | `storage/database/kairo.sqlite` | Caminho absoluto ou relativo do banco. |
| `MIGRATION_OWNER_EMAIL` | vazio | Resolve o proprietário quando uma migração tiver múltiplos administradores possíveis. |
| `JSON_BODY_LIMIT` | `1mb` | Limite geral de JSON. |
| `URLENCODED_BODY_LIMIT` | `256kb` | Limite reservado a formulários codificados. |
| `AVATAR_BODY_LIMIT` | `3mb` | Limite da rota de perfil. |
| `GOOGLE_CLIENT_ID` | vazio | Cliente OAuth do Google. |
| `GOOGLE_CLIENT_SECRET` | vazio | Segredo OAuth do Google. |
| `GOOGLE_REDIRECT_URI` | vazio | Callback absoluto autorizado. |
| `GOOGLE_CALENDAR_ID` | `primary` | Calendário de destino. |
| `GOOGLE_CALENDAR_TIMEZONE` | `America/Sao_Paulo` | Fuso da agenda. |

Quando os segredos não são definidos no `.env`, o Kairo os gera uma vez em `storage/secrets/` e reaproveita o mesmo material nas próximas execuções. Não copie essas chaves para o Git.

### Google Cloud

1. ative a Google Calendar API;
2. configure a tela de consentimento OAuth;
3. crie um cliente do tipo **Aplicativo da Web**;
4. autorize `http://localhost:3000/api/google/callback` ou a URL configurada;
5. preencha as variáveis `GOOGLE_*`;
6. reinicie o servidor e conecte a conta pela interface.

## Persistência e migração

### Diretórios locais

```text
storage/
├── database/kairo.sqlite      # Base operacional
├── backups/                   # Backups e relatórios de migração
├── logs/                      # Saídas locais
└── secrets/                   # Segredo de sessão e chave AES-256
```

Todo o diretório `storage/` é ignorado pelo Git.

### Proteção do legado

Na primeira execução da nova estrutura, um eventual `database.sqlite` da raiz é:

1. validado pelo SQLite;
2. copiado para o novo caminho;
3. copiado para `storage/backups/`;
4. comparado por contagens e integridade;
5. registrado em relatório JSON;
6. arquivado somente depois das verificações.

A migração é transacional, idempotente e executa `foreign_key_check` antes do commit. Falhas restauram o esquema anterior.

### Tabelas

| Domínio | Tabelas principais |
|---|---|
| Identidade | `users`, `auth_sessions`, `audit_events` |
| Produtividade | `activities`, `timeframes`, `goals`, `agenda_events`, `profile_data` |
| Planos | `plans`, `features`, `plan_features` |
| Google | `google_tokens`, `oauth_states` |
| Recompensas | `user_gamification`, `dopamenu`, `dopamine_config`, `ai_reward_config`, `reward_events`, `reward_feedback` |
| Evolução | `schema_migrations` |

## API HTTP

### Convenções de proteção

| Símbolo | Exigência |
|---|---|
| `Público` | Não exige sessão. |
| `Sessão` | Cookie de sessão válido. |
| `Plano` | Funcionalidade liberada ao plano ou papel administrador. |
| `CSRF` | Cabeçalho `X-CSRF-Token` válido. |
| `Recente` | Senha confirmada recentemente. |
| `Admin` | Papel `administrador`. |

Erros seguem o contrato:

```json
{
  "error": {
    "code": "CODIGO_ESTAVEL",
    "message": "Mensagem segura em pt-BR.",
    "requestId": "identificador-da-requisicao"
  }
}
```

### Saúde e autenticação

| Método | Rota | Proteção | Finalidade |
|---|---|---|---|
| `GET` | `/api/health` | Público | Estado do runtime e necessidade de bootstrap. |
| `GET` | `/api/auth/status` | Público | Informa se a primeira conta é necessária. |
| `POST` | `/api/auth/register` | Público | Cria conta; o primeiro admin precisa ser local. |
| `POST` | `/api/auth/login` | Público | Autentica e cria sessão. |
| `GET` | `/api/auth/me` | Sessão | Retorna o usuário público autenticado. |
| `GET` | `/api/auth/csrf` | Sessão | Emite o token CSRF da sessão. |
| `POST` | `/api/auth/reauthenticate` | Sessão + CSRF | Confirma a senha para ações sensíveis. |
| `POST` | `/api/auth/logout` | Sessão + CSRF | Revoga a sessão e remove o cookie. |

### Usuários, perfil e configurações

| Método | Rota | Proteção | Finalidade |
|---|---|---|---|
| `GET` | `/api/users` | Sessão + Admin | Lista contas sem hashes. |
| `POST` | `/api/users` | Sessão + Admin + CSRF + Recente | Cria conta gerenciada. |
| `PUT` | `/api/users/:id` | Sessão + Admin + CSRF + Recente | Atualiza papel, plano, status ou credenciais. |
| `DELETE` | `/api/users/:id` | Sessão + Admin + CSRF + Recente | Exclui outra conta respeitando o último admin. |
| `GET` | `/api/profile` | Sessão | Obtém o perfil privado. |
| `PUT` | `/api/profile` | Sessão + CSRF + Recente | Atualiza perfil e preferências. |
| `POST` | `/api/settings/reset` | Sessão + CSRF + Recente | Restaura somente o workspace do usuário. |

### Dashboard, atividades e agenda

| Método | Rota | Proteção | Finalidade |
|---|---|---|---|
| `GET` | `/api/dashboard/kpis` | Sessão + Plano `dashboard` | Calcula indicadores pessoais. |
| `GET` | `/api/activities` | Sessão + Plano `dashboard` | Lista atividades, períodos e metas. |
| `GET` | `/api/activities/:id/details` | Sessão + Plano `dashboard` | Consulta detalhes próprios. |
| `POST` | `/api/activities` | Sessão + Plano `dashboard` + CSRF | Cria atividade. |
| `PUT` | `/api/activities/:id` | Sessão + Plano `dashboard` + CSRF | Atualiza horas do período. |
| `PUT` | `/api/activities/:id/goals` | Sessão + Plano `dashboard` + CSRF | Define meta. |
| `DELETE` | `/api/activities/:id` | Sessão + Plano `dashboard` + CSRF + Recente | Exclui atividade e dependências próprias. |
| `GET` | `/api/agenda` | Sessão + Plano `agenda` | Lista eventos com filtros. |
| `GET` | `/api/agenda/:id` | Sessão + Plano `agenda` | Obtém um evento próprio. |
| `GET` | `/api/activities/:activity_id/agenda` | Sessão + Plano `agenda` | Lista agenda da atividade própria. |
| `POST` | `/api/agenda` | Sessão + Plano `agenda` + CSRF | Cria compromisso. |
| `PUT` | `/api/agenda/:id` | Sessão + Plano `agenda` + CSRF | Atualiza compromisso completo. |
| `PATCH` | `/api/agenda/:id/completion` | Sessão + Plano `agenda` + CSRF | Conclui ou reabre. |
| `DELETE` | `/api/agenda/:id` | Sessão + Plano `agenda` + CSRF + Recente | Exclui compromisso. |

### Planos e funcionalidades

| Método | Rota | Proteção | Finalidade |
|---|---|---|---|
| `GET` | `/api/plans` | Sessão | Obtém catálogo e matriz. |
| `POST` | `/api/plans` | Sessão + Admin + CSRF + Recente | Cria plano. |
| `PUT` | `/api/plans/:key` | Sessão + Admin + CSRF + Recente | Atualiza plano. |
| `DELETE` | `/api/plans/:key` | Sessão + Admin + CSRF + Recente | Exclui plano não protegido. |
| `POST` | `/api/plans/toggle` | Sessão + Admin + CSRF + Recente | Altera feature flag. |
| `POST` | `/api/features` | Sessão + Admin + CSRF + Recente | Cria funcionalidade. |
| `DELETE` | `/api/features/:key` | Sessão + Admin + CSRF + Recente | Exclui funcionalidade. |

### Recompensas

| Método | Rota | Proteção | Finalidade |
|---|---|---|---|
| `GET` | `/api/rewards/state` | Sessão | Estado e histórico pessoal. |
| `POST` | `/api/rewards/complete` | Sessão + CSRF | Registra conclusão idempotente. |
| `POST` | `/api/rewards/feedback` | Sessão + CSRF | Avalia uma recompensa própria. |
| `GET` | `/api/dopamenu` | Sessão | Lista itens pessoais. |
| `POST` | `/api/dopamenu` | Sessão + CSRF | Cria item pessoal. |
| `PUT` | `/api/dopamenu/:id` | Sessão + CSRF | Atualiza item pessoal. |
| `DELETE` | `/api/dopamenu/:id` | Sessão + CSRF | Remove item pessoal. |
| `GET` | `/api/rewards/config` | Sessão + Admin | Consulta configuração. |
| `POST` | `/api/rewards/config` | Sessão + Admin + CSRF + Recente | Ativa ou desativa gerador. |
| `POST` | `/api/rewards/ai` | Sessão + Admin + CSRF + Recente | Atualiza regra histórica de IA. |
| `GET` | `/api/rewards/dashboard` | Sessão + Admin | Métricas agregadas. |

### Google Agenda

| Método | Rota | Proteção | Finalidade |
|---|---|---|---|
| `GET` | `/api/google/status` | Sessão + Plano `google_calendar` | Estado da integração pessoal. |
| `POST` | `/api/google/auth` | Sessão + Plano + CSRF + Recente | Inicia OAuth. |
| `GET` | `/api/google/callback` | Sessão + Plano + Recente | Valida callback e armazena tokens criptografados. |
| `POST` | `/api/google/sync` | Sessão + Plano + CSRF + Recente | Sincroniza janela informada. |
| `POST` | `/api/google/disconnect` | Sessão + Plano + CSRF + Recente | Revoga e remove a conexão. |

## Estrutura do projeto

```text
Time-tracker-dashboard/
├── public/
│   ├── index.html                       # Landing page
│   ├── auth/index.html                  # Login e cadastro
│   ├── app/index.html                   # Aplicação autenticada
│   └── assets/
│       ├── css/app.css                  # Design system e responsividade
│       ├── js/app.js                    # Interface e integração HTTP
│       └── images/                      # Logotipo, ícones e favicons
├── src/server/
│   ├── index.js                         # Entrada do processo
│   ├── runtime.js                       # Inicialização e encerramento
│   ├── app.js                           # Composição Express
│   ├── config/                          # Ambiente e caminhos
│   ├── database/                        # SQLite, bootstrap, migração e seeds
│   ├── middleware/                      # Segurança e validação HTTP
│   ├── modules/                         # Domínios da aplicação
│   ├── security/                        # Criptografia e segredos
│   └── shared/                          # Erros HTTP compartilhados
├── scripts/
│   ├── windows/run.bat                  # Inicializador Windows
│   └── unix/run.sh                      # Inicializador Unix/WSL
├── tests/
│   ├── unit/                            # Criptografia e bootstrap
│   ├── integration/                     # Serviços, rotas e isolamento
│   ├── migration/                       # Migração tenant-safe
│   ├── frontend/                        # Contratos estáticos de CSP, DOM e acessibilidade
│   ├── windows/                         # Ciclo operacional real do orquestrador no Windows
│   └── e2e/                             # QA real com Playwright/Chromium
├── scripts/quality/                     # Políticas automatizadas do repositório
├── .github/workflows/quality.yml        # CI de qualidade e E2E
├── eslint.config.js                     # Lint moderno do projeto
├── playwright.config.js                 # Navegação real automatizada
├── docs/design/references/              # Referências visuais históricas
├── storage/                             # Dados locais ignorados pelo Git
├── .env.example                         # Contrato de configuração
├── AGENTS.md                            # Regras operacionais do workspace
├── andamento-claude.md                  # Histórico e fila detalhada
├── qa-iniciar-servidor.bat              # Inicialização oficial do servidor para QA local
├── qa-reiniciar-servidor.bat            # Reinício oficial e controlado do servidor de QA
├── run.bat                              # Orquestrador universal validado no Windows 11
├── run.sh                               # Orquestrador universal para Unix/WSL
├── package.json                         # Scripts e dependências
└── README.md                            # Este documento
```

## Qualidade e validação

### Validação automatizada

```bash
npm run check:full
```

Estado atual:

```text
testes nativos: 56
testes E2E Chromium: 7
pass: 63
fail: 0
coverage: 80.85% statements / 80.85% lines / 75.36% branches / 92.56% functions
vulnerabilidades npm conhecidas: 0
```

A suíte cobre:

- transações, rollback, FKs, índices e migração;
- criação e isolamento de workspaces;
- CRUD de atividades e agenda;
- filtros, conclusão e recálculo;
- bootstrap limpo e idempotente do orquestrador em caminho Windows com espaços;
- instalação nativa real do SQLite, ciclo iniciar/parar/reiniciar e preservação de processos externos;
- autenticação, sessão, CSRF e confirmação de senha restrita à troca de senha;
- papéis, planos e proteção do último administrador;
- perfil, reset pessoal e indicadores;
- criptografia AES-256-GCM e adulteração de ciphertext;
- OAuth `state`, tokens e isolamento Google;
- recompensas idempotentes e Dopamenu;
- headers, CORS, rate limiting e contrato de erros;
- CSP sem `unsafe-inline`, ausência de atributos `style`, fonte Imprima computada e controles acessíveis;
- navegação administrativa real em Dashboard, Agenda, Relatórios, Configurações, Usuários, Planos e Dopamina;
- CRUD administrativo real de planos, funcionalidades e configurações de Dopamina;
- CRUD navegável de atividades, horas, metas, detalhes, exclusão sem nova senha e gestão administrativa de usuários;
- alteração administrativa de senha protegida por confirmação recente, com invalidação comprovada da senha anterior;
- agenda integral com criação, edição persistente, alternância de layouts e exclusão pelo card atual;
- relatórios alimentados por dados persistidos e Modo Foco aberto por compromisso real, com início, pausa e reinício do cronômetro;
- proteção contra limpeza tardia dos campos de autenticação depois que o usuário começa a digitar;
- dropdown de perfil, modal de perfil, modal de preferências e responsividade em mobile compacto, tablet e desktop;
- ausência de overflow horizontal documental nas páginas administrativas validadas pelo E2E.

### Smoke test HTTP validado

- `/`, `/login`, `/assets/css/app.css`, `/api/health` e `/api/auth/status`: `200`;
- `/app` sem sessão: `303` para `/login`;
- rotas legadas: redirecionamentos permanentes corretos;
- `/server.js` e `/.env`: `404`, sem exposição de arquivos internos.

### Checklist manual de QA

1. bootstrap, login, recarregamento e logout;
2. dashboard e atualização de KPIs;
3. CRUD completo de atividades, metas e agenda;
4. sete layouts em desktop e mobile;
5. Pomodoro, sons, ciclo e conclusão;
6. perfil, avatar, temas e preferências;
7. usuários, papéis, planos e feature flags;
8. recompensas, Dopamenu e painel administrativo;
9. Google Agenda com credenciais reais, quando disponível;
10. teclado, foco visível, zoom, contraste e leitores de tela.

## Segurança

### Controles implementados

- configuração validada com Zod;
- senhas fortes e hash `bcrypt`;
- sessões revogáveis e expiráveis;
- cookies `httpOnly`, `SameSite` e `Secure` configurável;
- CSRF em mutações;
- confirmação da senha atual exclusivamente na troca da própria senha;
- autorização administrativa e por feature flag;
- isolamento por `user_id` e FKs compostas;
- consultas parametrizadas;
- CORS restritivo e guarda de origem;
- Helmet, CSP, HSTS em produção e `Permissions-Policy`;
- limites gerais, de login, cadastro, mutação e ações sensíveis;
- erros públicos sem stack ou segredo;
- IDs de requisição;
- trilha de auditoria;
- tokens Google criptografados por usuário com AES-256-GCM;
- segredos fora do banco e do Git;
- arquivos públicos servidos somente de `public/assets/`.

### Produção

Antes de publicar:

1. use HTTPS;
2. configure `NODE_ENV=production` e `COOKIE_SECURE=true`;
3. forneça segredos por cofre ou volume protegido;
4. restrinja `CORS_ORIGINS` aos domínios reais;
5. configure proxy reverso e `TRUST_PROXY` conscientemente;
6. execute `npm run check:full` e uma auditoria de segurança completa;
7. valide backups e restauração;
8. faça QA de acessibilidade e navegadores;
9. revalide a política CSP depois de qualquer novo script, estilo, widget ou integração externa.

## Limitações conhecidas

- a sincronização Google é manual e a validação automatizada usa um cliente controlado, não uma conta real;
- o Pomodoro em andamento não sobrevive ao fechamento ou recarregamento da página;
- relatórios avançados, séries temporais, Gantt, energia, cronotipo e construtor de gráficos permanecem na fila;
- o assistente de IA, provedores locais, memória privada e treinamentos ainda não foram implementados;
- pagamentos e cobrança real ainda não foram implementados;
- a interface ainda precisa ampliar a aplicação visual das permissões comerciais além das rotas já protegidas;
- não existe um arquivo `LICENSE` no repositório.

## Continuidade e roadmap

O documento [`andamento-claude.md`](./andamento-claude.md) é a fonte operacional detalhada. Ele registra requisitos, decisões, tarefas, critérios de aceite, evidências e ordem de implementação.

As próximas frentes incluem:

- atualização automática e tempo real;
- novas análises, gráficos e visualizações;
- gestão de energia e cronotipo;
- configurações de IA, provedores em nuvem, Ollama e LM Studio;
- memória privada criptografada e governança administrativa;
- assistência de IA durante a criação de tarefas;
- pagamentos e planos comerciais completos;
- landing page 2027 e refinamento visual premium;
- CI, lint, cobertura e automação de release.

## Solução de problemas

### A porta está em uso

Altere `PORT` no `.env`:

```dotenv
PORT=3001
```

### A aplicação volta ao login

- confirme que o servidor está ativo;
- verifique se o navegador aceita cookies;
- confirme que o acesso é feito pelo mesmo host usado no login;
- faça login novamente se a sessão expirou ou foi revogada.

### A primeira conta não pode ser criada

O bootstrap administrativo aceita somente acesso local. Abra o Kairo diretamente no computador do servidor usando `http://localhost:3000/login` ou `http://127.0.0.1:3000/login`.

### O Google Agenda está indisponível

- confira `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI`;
- valide a mesma URI no Google Cloud;
- verifique se o plano possui `google_calendar`;
- reinicie o servidor após alterar o `.env`;
- confirme que a conta Google autorizada permanece ativa e que a URI de redirecionamento coincide exatamente com a cadastrada.

### O banco não abre

- não edite o SQLite enquanto o servidor estiver ativo;
- preserve `storage/backups/`;
- consulte os relatórios JSON de migração;
- execute `PRAGMA integrity_check` e `PRAGMA foreign_key_check` em uma cópia antes de qualquer restauração manual.

## Licença e suporte

Este repositório não possui `LICENSE`. Nenhum direito de uso, modificação ou redistribuição deve ser presumido além do autorizado pelo titular.

Para relatar um problema, use as [issues do projeto](https://github.com/ilyra-ai/personal-time-tracker/issues) e informe:

- comportamento esperado e observado;
- passos mínimos de reprodução;
- sistema operacional, Node.js e npm;
- rota ou tela afetada;
- logs sem senha, cookie, token, chave, `.env` ou banco de dados.

---

<p align="center">
  <strong>Kairo</strong> — tempo com intenção, dados com contexto e evolução com consistência.
</p>

# Kairo — Domine o Seu Tempo

O **Kairo** (do grego *Kairós*, "o momento certo, oportuno") é um dashboard premium de **foco e produtividade pessoal**, completo e interativo, para registrar, monitorar, editar e analisar o tempo gasto em diversas atividades da vida cotidiana de forma dinâmica e persistente.

O produto foi reengenheirado a partir de um mockup básico para nível **Premium VIP**, aplicando as melhores práticas de engenharia de software e de design UI/UX responsivo (mobile-first e desktop) das tendências de 2026, com foco especial em **inclusão neurodivergente (TDAH/TEA)**.

---

## 🚀 Principais Funcionalidades

### 1. Barra de Navegação Superior (Top Sidebar)
*   **Design Glassmorphism Moderno** com transparência e desfoque de fundo (`backdrop-filter`).
*   **Navegação dinâmica** entre Dashboard, Agenda, Relatórios e Configurações.
*   **Busca inteligente** que filtra os cards de atividade em tempo real.
*   **Indicadores KPI em tempo real**: horas do dia, progresso da meta semanal, categorias ativas e relógio digital.
*   **Dropdown de Perfil** com upload real de foto (Base64 persistido no SQLite), preferências e bloqueio de sessão.

### 2. Gestão de Cards com CRUD Real
*   **Timeframes**: troca rápida entre dados diários, semanais e mensais.
*   **Dropdown contextual (3 pontos)** com ações reais: ✏️ Editar Horas, 🎯 Definir Meta, 📊 Ver Detalhes e 🗑️ Excluir (remoção física em cascata no banco).

### 3. Agenda Multilayout (Tendência 2026)
Sete visualizações comutáveis para o mesmo conjunto de compromissos:
*   **Foco TEA/TDAH** (cards PECS de baixa carga cognitiva), **Atual** (timeline), **Google Agenda** (grade semanal com **colunas redimensionáveis** e persistência em `localStorage`), **TickTick**, **Morgen**, **Todoist** e **Kanban**.
*   Campos avançados por compromisso: prioridade, carga cognitiva, cor customizada e status de conclusão.

### 4. Modo Foco — Pomodoro Inclusivo
*   **Ciclos configuráveis**: Foco Rápido (15 min), Clássico (25 min) e Profundo (50 min).
*   **Anel de progresso radial SVG** com pulsação biométrica.
*   **Sons ambientes sintetizados nativamente** via Web Audio API: Chuva, Ondas, Ruído Branco e **Ondas Binaurais 40 Hz (Gamma)** reais.
*   **Recompensa dopaminérgica**: confete + sino sintético ao concluir o ciclo.
*   Botão de foco ⏱️ disponível em **todos** os layouts da Agenda.

### 5. Feedback e Confirmações Premium
*   **Toast Notifications** de sucesso/erro.
*   **Modais de confirmação customizados** (exclusão de compromisso e restauração do banco), substituindo os diálogos nativos do navegador.

### 6. Relatórios & Insights
*   Gráfico radial de distribuição de tempo por categoria (SVG nativo), KPIs de produtividade e carga mental semanal.

---

## 🛠️ Tecnologias Utilizadas

### Backend
*   **Node.js** com módulos ESM (`import/export`).
*   **Express.js** para a API RESTful e servir os estáticos.
*   **SQLite** via wrappers assíncronos (`sqlite` & `sqlite3`), com **seed** e **migrações** automáticas na inicialização.

### Frontend
*   **HTML5** semântico e acessível.
*   **CSS3** avançado (variáveis nativas, Flexbox, CSS Grid, `cubic-bezier`) com layout 100% responsivo (mobile-first) e tema claro/escuro.
*   **JavaScript (Vanilla)** reativo, orientado a eventos, consumindo a API local via `Fetch`, com **Web Audio API** e **Canvas** (confete).

---

## 📂 Estrutura do Banco de Dados (SQLite)

O banco `database.sqlite` é criado automaticamente e gerencia:

1.  **`activities`** — categorias/atividades monitoradas.
2.  **`timeframes`** — horas correntes e anteriores por período (`daily`, `weekly`, `monthly`), com `ON DELETE CASCADE`.
3.  **`goals`** — metas personalizadas de horas por período.
4.  **`profile_data`** — nome, e-mail, avatar (Base64) e preferências do usuário.
5.  **`agenda_events`** — compromissos com data, horário, prioridade, carga cognitiva, cor e status de conclusão (colunas adicionadas via migração automática).

---

## 💻 Como Executar o Projeto Localmente

### Pré-requisitos
*   [Node.js](https://nodejs.org/) instalado.

### Passo a Passo

1.  **Clonar o repositório** e entrar na pasta:
    ```bash
    git clone https://github.com/ilyra-ai/personal-time-tracker.git
    cd Time-tracker-dashboard
    ```

2.  **Instalar as dependências**:
    ```bash
    npm install
    ```

3.  **Executar em desenvolvimento** (com reinicialização automática via nodemon):
    ```bash
    npm run dev
    ```

4.  **Acessar** no navegador:
    [http://localhost:3000](http://localhost:3000)

> **Nota**: Na primeira inicialização, o servidor detecta o banco vazio e realiza o seed automático das categorias padrão a partir de `data.json`, além de aplicar as migrações da agenda e do perfil.

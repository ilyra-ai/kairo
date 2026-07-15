# TimeTrack — Dashboard de Monitoramento de Tempo Premium

O **TimeTrack** é um sistema completo e interativo de controle e gestão de produtividade pessoal. O projeto permite registrar, monitorar, editar e analisar o tempo gasto em diversas atividades da vida cotidiana de forma dinâmica e persistente.

O dashboard foi totalmente reengenheirado a partir de um mockup básico para um produto de nível **Premium VIP**, utilizando as melhores práticas de engenharia de software e design UI/UX móvel e desktop de 2026.

---

## 🚀 Principais Funcionalidades

### 1. Barra de Navegação Superior (Top Sidebar)
*   **Design Glassmorphism Moderno**: Interface elegante com transparência e desfoque de fundo (`backdrop-filter`) integrada ao tema escuro.
*   **Menu de Navegação Dinâmico**: Alternância rápida entre:
    *   **Dashboard**: Monitoramento principal com cards de atividades.
    *   **Relatórios**: Visão analítica consolidando todas as horas registradas e metas dos períodos.
    *   **Configurações**: Ajustes de preferências do usuário (como o formato de exibição de horas e o período padrão).
*   **Barra de Busca Inteligente**: Caixa de texto expansível que filtra os cards de atividade em tempo real.
*   **Indicadores KPI em Tempo Real**:
    *   Soma de todas as horas produtivas do dia atual.
    *   Barra de progresso de cumprimento da meta semanal consolidada.
    *   Quantidade de categorias ativas cadastradas.
    *   Relógio digital integrado atualizado a cada segundo.
*   **Dropdown do Perfil**: Acesso rápido às configurações do perfil com micro-interações fluidas.

### 2. Gestão de Cards com CRUD Real
*   **Visualização de Timeframes**: Troca rápida entre dados diários, semanais e mensais.
*   **Dropdown Contextual (3 pontos)**: Cada card possui ações funcionais:
    *   ✏️ **Editar Horas**: Modifique os dados de horas atuais e do período anterior.
    *   🎯 **Definir Meta**: Configure limites de tempo para o período ativo. Uma barra de progresso visual surge no card, mudando para tons de alerta caso o limite seja ultrapassado.
    *   📊 **Ver Detalhes**: Modal com tabela consolidando as métricas de todos os períodos para aquela categoria de forma integrada.
    *   🗑️ **Excluir**: Exclui de forma física a atividade e todos os seus históricos do banco de dados local.

### 3. Feedback Instantâneo
*   **Toast Notifications**: Avisos flutuantes automáticos de sucesso ou erro que orientam o usuário a cada ação realizada (salvar, definir meta, excluir, etc.).

---

## 🛠️ Tecnologias Utilizadas

### Backend
*   **Node.js** com módulos ESM (`import/export`).
*   **Express.js** para criação da API RESTful e disponibilização das rotas e estáticos.
*   **SQLite** via wrappers assíncronos (`sqlite` & `sqlite3`) como banco de dados local de baixo acoplamento e alta performance.

### Frontend
*   **HTML5** estruturado de forma semântica e acessível.
*   **CSS3** avançado com variáveis nativas, Flexbox, CSS Grid, animações fluidas (`cubic-bezier`) e layout 100% responsivo (Mobile, Tablet, Desktop).
*   **JavaScript (Vanilla)** reativo e orientado a eventos para manipulação do DOM e consumo assíncrono das APIs locais via `Fetch`.

---

## 📂 Estrutura do Banco de Dados (SQLite)

O banco de dados `database.sqlite` é criado automaticamente e gerencia três tabelas estruturadas:

1.  **`activities`**: Armazena as categorias/atividades do monitor.
2.  **`timeframes`**: Armazena as horas correntes e anteriores indexadas por tipo de período (`daily`, `weekly`, `monthly`), vinculada via chave estrangeira em cascata (`ON DELETE CASCADE`).
3.  **`goals`**: Armazena metas personalizadas de horas definidas pelo usuário para cada tipo de período.

---

## 💻 Como Executar o Projeto Localmente

### Pré-requisitos
*   [Node.js](https://nodejs.org/) instalado em sua máquina.

### Passo a Passo

1.  **Clonar o repositório** e entrar na pasta do projeto:
    ```bash
    git clone https://github.com/ilyra-ai/PERSONAL-TIME-TRACKER-DASHBOARD.git
    cd Time-tracker-dashboard
    ```

2.  **Instalar as dependências** do projeto:
    ```bash
    npm install
    ```

3.  **Executar em ambiente de desenvolvimento** (com reinicialização automática via nodemon):
    ```bash
    npm run dev
    ```

4.  **Acessar a URL** no navegador:
    [http://localhost:3000](http://localhost:3000)

> **Nota**: Ao iniciar pela primeira vez, o servidor detectará o banco de dados vazio e realizará o seed automático das categorias padrões a partir do arquivo `data.json`.

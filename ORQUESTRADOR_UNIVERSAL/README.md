# Orquestrador Universal TUI Premium v5

Dois launchers autônomos para permanecerem na **raiz do projeto**:

- `run.sh`: execução no WSL2 Ubuntu com Bash.
- `run.bat`: execução nativa no Windows 11. O arquivo contém internamente seu núcleo PowerShell 5.1, extraído para um arquivo temporário somente durante a execução.

Os dois launchers preservam a identidade visual do TUI de referência: tela alternativa, cursor oculto, boot animation Braille, paleta RGB Noir Elite, menu navegável, barra de andamento dinâmica, console ao vivo, scrollbar, status, logs, PID, lock, health check, cronômetro e restauração do terminal.

## Princípio de funcionamento

O orquestrador não mantém um menu universal fixo. A cada início ele:

1. localiza manifestos, lockfiles, scripts, arquivos de configuração e componentes do workspace;
2. identifica os ecossistemas realmente presentes;
3. determina os gerenciadores de pacotes a partir dos lockfiles e do campo declarativo do projeto;
4. verifica os requisitos internos do próprio launcher;
5. instala os runtimes ausentes por mecanismos reais da plataforma;
6. instala as dependências declaradas pelos manifestos;
7. calcula uma assinatura SHA-256 dos manifestos para evitar reinstalações desnecessárias;
8. monta o menu somente com ações respaldadas por arquivos, scripts ou configurações existentes;
9. executa os comandos na raiz correta, preservando stdout, stderr e código de saída;
10. mantém metadados validados do processo iniciado, sem encerrar processos externos apenas porque usam a mesma porta.

Nenhuma senha administrativa, usuário, banco, domínio, módulo WSGI ou comando de negócio específico foi incorporado ao código.

## Instalação na raiz do projeto

Copie os dois arquivos para a raiz:

```text
meu-projeto/
├── run.sh
├── run.bat
├── package.json, pyproject.toml, go.mod, Cargo.toml, ...
└── código do projeto
```

### WSL2 Ubuntu

```bash
chmod +x run.sh
./run.sh
```

Também funciona com:

```bash
bash run.sh
```

O bootstrap do WSL2 usa APT quando faltam ferramentas internas ou runtimes disponíveis nos repositórios do Ubuntu/Debian. Dependendo do estado do sistema, poderá solicitar `sudo`.

### Windows 11

No Prompt de Comando ou Windows Terminal:

```bat
run.bat
```

O Windows PowerShell 5.1 já incluído no Windows 11 executa o núcleo incorporado. Quando um runtime exige WinGet, o launcher:

1. tenta registrar o App Installer já presente no Windows;
2. caso ainda não exista, baixa o App Installer atual pelo endereço oficial `https://aka.ms/getwinget`;
3. instala o pacote;
4. atualiza o `PATH` do processo;
5. valida se `winget` ficou efetivamente disponível antes de prosseguir.

Instalações de máquina podem abrir a elevação do Windows ou ser bloqueadas por políticas corporativas. O launcher não burla UAC, Group Policy, antivírus ou políticas de segurança.

## Opções de linha de comando

Disponíveis nos dois launchers:

```text
--list-actions          Lista somente as ações detectadas.
--action ID             Executa uma ação pelo identificador listado.
--port N                Define a porta preferencial, entre 1 e 65535.
--bootstrap-only        Verifica/instala requisitos e encerra.
--dry-run               Mostra comandos sem alterar o projeto.
--no-bootstrap          Desativa a instalação automática.
--help, -h              Exibe ajuda.
```

Exemplos:

```bash
./run.sh --list-actions
./run.sh --bootstrap-only
./run.sh --action START_DEV --port 3000
ORCH_AUTO_CONFIRM=1 ./run.sh --action RESET_DB
```

```bat
run.bat --list-actions
run.bat --bootstrap-only
run.bat --action START_DEV --port 3000
set ORCH_AUTO_CONFIRM=1 && run.bat --action RESET_DB
```

## Variáveis de ambiente

- `PORT`: porta preferencial.
- `NO_COLOR=1`: desativa ANSI/TrueColor.
- `ORCH_AUTO_CONFIRM=1`: autoriza conscientemente uma ação destrutiva em execução não interativa.
- `ORCH_PROJECT_DIR`: uso interno para abrir um componente detectado em workspace sem copiar os launchers.

## Ecossistemas identificados

### Front-end e Node.js

O launcher lê `package.json`, scripts, dependências, `packageManager` e lockfiles de npm, pnpm, Yarn e Bun. Reconhece rótulos e configurações de:

- React, Next.js, Vue, Nuxt, Angular;
- Svelte, SvelteKit, Astro, Remix, Gatsby, SolidJS e Qwik;
- Vite e Storybook;
- Playwright, Cypress, Vitest e Jest;
- scripts personalizados reais definidos em `package.json`.

Ações como desenvolvimento, produção, build, preview, testes, lint, typecheck, formatação, E2E e Storybook só aparecem quando o script ou a configuração correspondente existe.

### Back-end

- Node.js: NestJS, Express, Fastify, Koa, AdonisJS e Strapi, além dos scripts reais do manifesto.
- Python: Django, FastAPI e Flask.
- PHP: Composer e Laravel, além de scripts reais do `composer.json`.
- Ruby: Bundler e Rails.
- Java/Kotlin: Maven, Gradle, Spring e Android quando os arquivos correspondentes existem.
- .NET: solution e project files, restore, build, test e run conforme o tipo detectado.
- Go: módulos, testes, build e execução somente quando existe aplicação executável.
- Rust: Cargo, testes, build, check e execução somente quando existe target binário.

### Mobile

- Flutter e Dart;
- React Native e Expo;
- Ionic, Capacitor e NativeScript;
- Android com Gradle;
- workspaces com diretórios como `mobile`, `android`, `ios`, `apps` ou pacotes detectados.

### Inteligência Artificial e dados

O launcher identifica dependências declaradas, sem inventar pacotes a partir de nomes de imports:

- PyTorch, TensorFlow, JAX, Hugging Face Transformers e Diffusers;
- LangChain, LangChain.js, LlamaIndex e Vercel AI SDK;
- scikit-learn, XGBoost, LightGBM, NumPy, pandas e Polars;
- PySpark, Ray, MLflow e Airflow;
- Streamlit, Gradio e Jupyter;
- fastai, Ultralytics e ONNX Runtime;
- TensorFlow.js e Transformers.js.

Streamlit, Gradio, Jupyter e MLflow somente recebem ações de inicialização quando também existe evidência operacional, como arquivo importando a biblioteca, notebook ou armazenamento MLflow.

### Infraestrutura, automação e workspaces

- Docker e Docker Compose;
- Makefile no WSL2;
- monorepos e componentes em subdiretórios;
- ambientes Conda/Micromamba;
- R/renv/Shiny;
- Julia/Project.toml.

Em workspaces, o menu raiz oferece ações para abrir cada componente. O mesmo launcher é reutilizado com `ORCH_PROJECT_DIR`, sem copiar ou gerar scripts auxiliares dentro das pastas.

## Instalação de dependências do projeto

O comando é escolhido por evidência:

- npm: `npm ci` quando existe lockfile, senão `npm install`;
- pnpm: instalação congelada quando aplicável;
- Yarn: modo imutável quando aplicável;
- Bun: instalação baseada no lockfile;
- Python: `uv sync`, Poetry, Pipenv ou ambiente `.venv` + pip;
- PHP: `composer install`;
- Ruby: `bundle install`;
- Go: download dos módulos;
- Rust: fetch/build pelo Cargo;
- .NET: restore;
- Maven e Gradle: resolução pelos wrappers ou ferramentas detectadas;
- Flutter/Dart: `pub get`;
- Conda/Micromamba: ambiente criado a partir do arquivo declarado;
- R/renv e Julia: restauração do ambiente declarado.

A assinatura dos manifestos fica em `.orchestrator/`. Quando ela não mudou e os diretórios esperados existem, o bootstrap evita reinstalar tudo.

## Imports Python

O menu pode oferecer validação dos imports usados pelo código contra o ambiente instalado. O launcher **não converte automaticamente qualquer nome de import em um nome de pacote PyPI**, porque essa relação não é universal e poderia instalar o pacote errado ou malicioso. A instalação é feita a partir de `requirements*.txt`, `pyproject.toml`, `uv.lock`, `poetry.lock`, `Pipfile` e demais declarações reais do projeto.

## Segurança de processos

Ao iniciar um servidor, o orquestrador registra:

- PID;
- horário de início do processo;
- hash do caminho do projeto;
- ação que originou o processo;
- porta usada.

Antes de parar, os metadados são revalidados. Uma porta ocupada por outro programa bloqueia o início, mas esse programa não é encerrado. O encerramento começa de forma graciosa e só escala para força quando o processo validado não termina no prazo.

## Ações destrutivas

Reset de banco e outras ações classificadas como destrutivas exigem a palavra `CONFIRMAR` no TUI. Em automação não interativa, exigem explicitamente:

```text
ORCH_AUTO_CONFIRM=1
```

## Arquivos internos

Criados em `.orchestrator/` na raiz do projeto:

- logs;
- lock da instância;
- metadados do servidor;
- assinatura das dependências;
- inventário de detecção;
- arquivos temporários controlados.

A pasta pode ser adicionada ao `.gitignore`:

```gitignore
.orchestrator/
```

## Testes incluídos

- `tests/test_run_sh.sh`: testes funcionais e de integração no WSL2/Linux.
- `tests/test_run_bat_static.py`: auditoria lexical e estrutural do payload PowerShell incorporado.
- `tests/test_run_bat_windows.ps1`: suíte para execução nativa no Windows 11.

No WSL2/Linux:

```bash
./tests/test_run_sh.sh
python3 tests/test_run_bat_static.py
```

No Windows 11, na raiz do pacote:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tests\test_run_bat_windows.ps1
```

Consulte `VALIDACAO.md` para os resultados efetivamente obtidos nesta entrega.

# Validação operacional do `run.bat` no Windows

**Data da validação:** 22 de julho de 2026  
**Ambiente:** Windows 11, PowerShell 5.1, Node.js e npm reais  
**Escopo:** Tarefa 24 do projeto Kairo

## Resultado

O orquestrador da raiz foi validado de ponta a ponta em um clone descartável localizado em diretório temporário com espaços. A validação não utilizou banco, credenciais ou arquivos locais do usuário.

- `run.bat --help` e listagem das ações: aprovados, com saída em pt-BR;
- detecção de Node.js, npm, Express, Playwright e estrutura Kairo: aprovada;
- bootstrap sem `node_modules`: `npm ci` concluído, `package-lock.json` preservado e repetição idempotente;
- `better-sqlite3`: módulo nativo carregado e consulta real em SQLite em memória aprovada;
- porta livre: servidor iniciado, resposta HTTP `200` e conteúdo Kairo confirmado;
- encerramento e nova inicialização: árvore de processo anterior finalizada e PID novo confirmado;
- porta ocupada por processo externo: inicialização recusada, retorno de erro e processo externo preservado;
- caminho com espaços: ciclo completo aprovado;
- múltiplos lockfiles locais: `package-lock.json` mantém o npm como gerenciador canônico e um `pnpm-lock.yaml` residual não altera o bootstrap;
- metadados adulterados: recusados sem encerrar o servidor legítimo ou qualquer processo externo;
- TUI interativa: aberta, navegável e encerrada pela tecla documentada;
- entradas inválidas: porta fora do intervalo e ação inexistente recusadas em pt-BR.

O teste automatizado correspondente está em `tests/windows/run-orchestrator.test.js` e é executado por `npm run test:windows`. O GitHub Actions possui um trabalho dedicado em `windows-latest` para impedir regressões específicas da plataforma.

## Causas-raiz corrigidas

1. **Argumento único no PowerShell 5.1:** a saída da análise de argumentos podia virar escalar; ela passou a ser materializada como coleção.
2. **Hash no PowerShell dinâmico:** a resolução automática de `Get-FileHash` era instável no payload; o hash passou a usar diretamente as classes criptográficas do .NET.
3. **Varredura recursiva excessiva:** a detecção percorria `node_modules` antes de filtrar; a travessia agora poda diretórios excluídos antes de entrar neles.
4. **Scripts nativos do npm:** o projeto declara autorização exata para o script de instalação do `better-sqlite3`, necessária nas versões atuais do npm.
5. **Captura assíncrona de processo:** eventos assíncronos de saída podiam ser interrompidos no PowerShell 5.1; a captura passou a utilizar arquivo temporário controlado.
6. **Conflito de log no Windows:** orquestrador e servidor escreviam no mesmo arquivo com bloqueios incompatíveis; cada processo agora possui log próprio.
7. **Conflito com a variável automática `$PID`:** variáveis locais foram renomeadas para não colidir com a variável somente leitura do PowerShell.
8. **Encerramento incompleto:** a árvore validada agora é encerrada com `taskkill /T /F` e a saída do processo é verificada.
9. **JSON com BOM:** metadados passaram a ser gravados explicitamente em UTF-8 sem BOM, garantindo leitura interoperável.
10. **Prontidão HTTP transitória no teste:** a validação aceita somente `ECONNREFUSED`/`ECONNRESET` durante uma janela curta de inicialização e falha se o HTTP não ficar realmente disponível.
11. **Conflito entre lockfiles:** a seleção agora respeita primeiro `packageManager` declarado e, sem declaração, considera `package-lock.json`/`npm-shrinkwrap.json` canônicos antes de lockfiles de outros gerenciadores; conflitos são registrados no log.
12. **Metadados adulteráveis:** `CommandFile`, PID, instante de criação, projeto e porta passaram a ser canonicalizados e validados; a porta precisa pertencer à árvore real do processo registrado.
13. **Encerramento parcial:** todos os PIDs conhecidos da árvore e o fechamento da porta são verificados depois de `taskkill /T /F`; processos adicionais nunca são finalizados para liberar a porta.
14. **Observabilidade após falha:** o visualizador preserva e apresenta separadamente os logs do orquestrador e do servidor, mesmo depois da parada.
15. **Escala da captura ao vivo:** a saída incremental passou a ser lida por fluxo compartilhado, sem reler o arquivo inteiro a cada atualização.
16. **Profundidade da detecção:** o padrão seguro passou a 12 níveis e pode ser configurado entre 1 e 64 por `ORCH_SCAN_DEPTH`.

## Segurança operacional

- O servidor só pode ser encerrado quando PID, instante de criação, diretório do projeto, `CommandFile` contido em `.orchestrator/` e porta pertencente à árvore do processo correspondem aos metadados que o próprio orquestrador gravou.
- Uma porta ocupada sem metadados válidos é tratada como pertencente a terceiro e permanece intacta.
- Metadados adulterados são descartados; os caminhos fornecidos por eles nunca são removidos.
- O encerramento verifica todos os PIDs capturados da árvore e confirma que a porta foi fechada.
- O teste cria e remove somente uma pasta filha validada dentro do diretório temporário do Windows.
- Segredos, `.env`, banco operacional, backups e arquivos não versionados não entram no clone de QA.

## Referências oficiais consultadas

- [Microsoft — `ProcessStartInfo.Arguments`](https://learn.microsoft.com/en-us/dotnet/api/system.diagnostics.processstartinfo.arguments?view=netframework-4.8.1)
- [Microsoft — `powershell.exe` e códigos de saída](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_powershell_exe?view=powershell-5.1)
- [npm — `npm ci`](https://docs.npmjs.com/cli/commands/npm-ci/)
- [npm — controle de scripts de instalação](https://docs.npmjs.com/cli/v11/commands/npm-install-scripts/)
- [npm — contrato de `package.json`](https://docs.npmjs.com/files/package.json/)

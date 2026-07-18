# Validação da tipografia Imprima — Tarefa 34

**Data:** 18 de julho de 2026  
**Fuso:** America/Sao_Paulo  
**Ambiente:** Windows 11, Node.js `26.5.0`, npm `11.18.0`, Playwright `1.61.0`, Chromium `149.0.7827.55`  
**Servidor:** backend real do Kairo com banco SQLite temporário e isolado da suíte E2E

## Referências técnicas consultadas

- [Google Fonts CSS API](https://developers.google.com/fonts/docs/getting_started): inclusão por stylesheet, fallback genérico e `display=swap`.
- [Boas práticas para fontes — web.dev](https://web.dev/articles/font-best-practices): impacto sobre renderização, LCP, CLS, preconnect e troca de fonte.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/): critérios 1.4.4, redimensionamento de texto, e 1.4.10, reflow.
- [Entendimento do critério de reflow](https://www.w3.org/WAI/WCAG21/Understanding/reflow): relação entre ampliação, viewport CSS e conteúdo sem rolagem bidimensional.

Fontes oficiais consultadas em 18 de julho de 2026.

## Implementação comprovada

- Os HTMLs `/`, `/login` e `/app` contêm exatamente um preconnect para `fonts.googleapis.com`, um preconnect com `crossorigin` para `fonts.gstatic.com` e um stylesheet `family=Imprima&display=swap`, nessa ordem.
- A folha compartilhada `public/assets/css/typography.css` define a pilha `"Imprima", sans-serif`, desativa síntese com `font-synthesis: none`, aplica a família aos controles nativos e mantém a classe `.imprima-regular` oficial.
- As 78 declarações de pesos não carregados foram eliminadas: aplicativo 62, autenticação 4 e landing page 12. Todos os pesos ativos da Imprima usam `400`.
- A CSP libera somente `https://fonts.googleapis.com` em `style-src` e `https://fonts.gstatic.com` em `font-src`, sem curingas.
- A autenticação passou a permitir rolagem vertical em telas baixas.
- Os modais usam altura máxima vinculada a `100dvh`, corpo rolável e cabeçalho/rodapé fixos no fluxo, mantendo ações alcançáveis em 320 px.
- Controles operáveis possuem foco visível global de 3 px com `currentColor`.

## Fonte efetivamente renderizada

A validação não se limita à propriedade CSS computada. O teste usa:

1. `document.fonts.load()` e `document.fonts.ready` para comprovar a face Imprima 400 em estado `loaded`;
2. `CSS.getPlatformFontsForNode` do protocolo Chromium para confirmar que glifos da família `Imprima` foram efetivamente desenhados na landing page, autenticação e aplicativo;
3. verificação da pilha computada `Imprima, sans-serif` e de `font-synthesis: none`.

## Métricas observadas

Medição local do fluxo conjunto em Chromium, com cache normal do navegador:

| Rota | LCP | CLS | Viewport CSS | Documento | Família computada |
|---|---:|---:|---:|---:|---|
| Landing `/` | 412 ms | 0,002803 | 1366 × 900 | 1366 × 2791 | `Imprima, sans-serif` |
| Autenticação `/login` | 116 ms | 0 | 1366 × 900 | 1366 × 900 | `Imprima, sans-serif` |
| Aplicativo `/app` | 256 ms | 0,008682 | 1366 × 900 | 1366 × 900 | `Imprima, sans-serif` |

Resultados abaixo dos limites de referência usados pela suíte: LCP até 2.500 ms e CLS até 0,1.

### Transferência tipográfica

- Dois recursos únicos: um CSS e um WOFF2.
- O CSS da API possui 838 bytes por resposta.
- O WOFF2 da Imprima possui 15.864 bytes.
- O fluxo observou 8 respostas tipográficas: 4 CSS e 4 WOFF2; 3 respostas WOFF2 reutilizaram cache e não transferiram novo corpo.
- Total de corpos capturados no fluxo: 19.216 bytes.

Os números são uma medição local reproduzível, não uma promessa universal de desempenho em redes, dispositivos ou regiões diferentes.

## Falha externa e fallback

O cenário de contingência bloqueia requisições para `fonts.googleapis.com` e `fonts.gstatic.com` antes da navegação. Como a Imprima também está instalada localmente no Windows de validação, a suíte substitui apenas o nome da família primária por um identificador deliberadamente indisponível na resposta CSS local do teste. Assim ela força o navegador a usar o fallback genérico real sem alterar o código entregue.

Com a face externa e a família local indisponíveis no cenário controlado:

- landing, autenticação e aplicativo mantiveram conteúdo legível;
- nenhum controle visível ultrapassou a largura do viewport;
- não houve overflow horizontal global;
- navegação, cadastro/entrada e renderização autenticada permaneceram operáveis;
- os bloqueios de rede foram reconhecidos exclusivamente como falhas tipográficas intencionais.

## Responsividade, zoom, foco e textos longos

- Viewports validados: 320 × 720, 375 × 812, 768 × 1024, 1366 × 900, 1440 × 900 e 1920 × 1080.
- Zoom de 200% validado em contexto dedicado: viewport lógico 720 × 450, `devicePixelRatio` 2 e saída física 1440 × 900.
- Reflow equivalente de 1440 px em 200% validado sem overflow horizontal global.
- Foco por teclado comprovado com anel visível de pelo menos 2 px; a implementação usa 3 px.
- Compromisso real criado com título de 200 caracteres e descrição de 4.000 caracteres em pt-BR.
- A API respondeu HTTP 201, o modal reabriu com os valores integrais e a persistência foi confirmada após recarregar a página.

## Evidências visuais

- [Landing 1440 × 900](../design/evidence/imprima-2026/landing-1440.png)
- [Autenticação 375 × 812](../design/evidence/imprima-2026/autenticacao-375.png)
- [Aplicativo 1440 × 900](../design/evidence/imprima-2026/aplicativo-1440.png)
- [Aplicativo em 200% — 1440 × 900 físicos](../design/evidence/imprima-2026/aplicativo-zoom-200.png)
- [Instruções de reprodução](../design/evidence/imprima-2026/README.md)

## Resultado

Os quatro cenários dedicados da Tarefa 34 foram aprovados em sequência única no Chromium:

1. carregamento e renderização efetiva da Imprima 400 nos três shells;
2. fallback funcional com as origens externas bloqueadas;
3. seis larguras, foco, reflow e zoom de 200%;
4. texto pt-BR nos limites reais, persistido e reaberto sem perda.

A evidência final deve ser reconfirmada pelo comando `npm run check:full` antes do encerramento e do commit da tarefa.

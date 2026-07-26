# Matriz de interações da landing pública — Tarefa 33

**Atualização:** 26/07/2026

**Escopo:** landing `/`, autenticação `/login`, destino autenticado `/app` e configuração pública `/api/public/landing`.

## Orçamento de qualidade

- LCP: até 2,5 s em mobile e desktop no ambiente local de QA.
- CLS: até 0,1.
- INP: até 200 ms quando mensurável por interação real.
- Nenhum erro de console, resposta HTTP inesperada ou recurso 404.
- Sem biblioteca visual adicional; composição, motion e demonstração usam HTML/CSS/JS nativos.
- Alvos interativos com pelo menos 44 px e foco nunca encoberto pelo header.
- `prefers-reduced-motion: reduce` remove deslocamentos e rolagem animada.

## Fonte funcional do conteúdo comercial

`GET /api/public/landing` deriva nomes, preços e funcionalidades da matriz administrativa de planos e a disponibilidade do checkout do serviço de pagamentos. O contrato remove modo, origem e qualquer referência a segredo. Os cards não existem codificados no HTML: são construídos com DOM seguro a partir dessa resposta.

## Matriz auditável

| ID/Seletor | Rótulo | Visitante anônimo | Usuário autenticado | Destino/efeito | Contrato automatizado |
|---|---|---|---|---|---|
| `.brand[data-scroll-target="inicio"]` | Kairo | igual | igual | rola ao início e posiciona foco | `landing-ui.test.js` |
| navegação desktop/móvel | Produto, Recursos, Como funciona, Planos, Privacidade, FAQ | igual | igual | âncora existente, rolagem e foco acessível | `landing-ui.test.js` |
| `#menu-trigger` | Abrir/Fechar menu | igual | igual | alterna `aria-expanded`, prende foco, fecha com Escape e restaura foco | `landing-ui.test.js` |
| `[data-auth-link]` | Entrar | abre login | muda para “Abrir meu Kairo” | `/login` ou `/app` | `landing-ui.test.js` |
| `[data-auth-cta]` | Criar conta/Começar gratuitamente | abre cadastro real | muda para “Ir para o dashboard” | `/login?modo=cadastro` ou `/app` | `landing-ui.test.js` |
| CTA “Ver o produto” | Ver o produto | igual | igual | seção `#produto` com foco | `landing-ui.test.js` |
| `[data-plan-action="free"]` | Começar no Free | cadastro | abre plano atual | cadastro ou `myfeatures` | `landing-ui.test.js` + `marketing.service.test.js` |
| `[data-plan-action]` pago | Criar conta e ver plano | abre cadastro preservando plano | abre área de assinatura com plano realçado | `/login?...plano=` ou `/app?secao=myfeatures&plano=` | `landing-ui.test.js` + `marketing.service.test.js` |
| `<details class="faq-item">` | Pergunta da FAQ | igual | igual | acordeão nativo por mouse, toque, Enter e Espaço | sem JavaScript customizado |
| links do rodapé | Produto, Planos, Privacidade, Ajuda e FAQ | igual | igual | âncoras existentes com foco | `landing-ui.test.js` |

## Decisões de privacidade e SEO

- Não há analytics na landing; nenhum identificador, texto, e-mail ou dado de agenda é coletado.
- O estado autenticado é consultado somente em `/api/auth/me` com cookie de mesma origem.
- A página declara idioma pt-BR, título, descrição, canonical relativo ao host atual, Open Graph e imagem real do Kairo.
- Links inexistentes de termos/suporte não foram inventados; o rodapé aponta somente para destinos realmente entregues.

## Referências oficiais consultadas em 26/07/2026

- W3C, WCAG 2.2: https://www.w3.org/TR/WCAG22/
- web.dev, Web Vitals: https://web.dev/articles/vitals
- web.dev, otimização de LCP: https://web.dev/articles/optimize-lcp
- MDN, acessibilidade por teclado: https://developer.mozilla.org/en-US/docs/Web/Accessibility/Guides/Understanding_WCAG/Keyboard

As evidências navegadas, screenshots atualizados e métricas finais serão produzidos exclusivamente no QA geral final, conforme ordem determinada pelo usuário.

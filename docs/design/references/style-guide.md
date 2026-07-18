# Guia de estilo do Kairo

## Escopo

Este documento registra o sistema visual vigente do Kairo. As imagens em `legacy-layouts/` são referências históricas e não substituem os critérios atuais de interface, acessibilidade ou responsividade.

## Larguras de validação

- Mobile compacto: 320 px.
- Mobile de referência: 375 px.
- Tablet vertical: 768 px.
- Desktop base: 1366 px.
- Desktop de referência: 1440 px.
- Desktop amplo: 1920 px.
- Ampliação obrigatória: zoom de 200%, com conteúdo legível e controles operáveis.

## Cores

### Principais

- Roxo de marca: `hsl(246 80% 60%)`.
- Laranja de atividade: `hsl(15 100% 70%)`.
- Azul de lazer: `hsl(195 74% 62%)`.
- Vermelho de estudo: `hsl(348 100% 68%)`.
- Verde de exercício: `hsl(145 58% 55%)`.
- Violeta social: `hsl(264 64% 52%)`.
- Amarelo de autocuidado: `hsl(43 84% 65%)`.

### Neutras

- Fundo profundo: `hsl(226 43% 10%)`.
- Superfície escura: `hsl(235 46% 20%)`.
- Superfície interativa: `hsl(235 45% 33%)`.
- Texto secundário: `hsl(236 100% 87%)`.

## Tipografia oficial

- Família: [Imprima](https://fonts.google.com/specimen/Imprima), com fallback genérico `sans-serif`.
- Peso carregado e permitido: `400`.
- Estilo carregado e permitido: `normal`.
- Síntese de pesos e estilos: desativada por `font-synthesis: none`.
- Corpo base do aplicativo: 18 px, `line-height: 1.5`.
- Landing page: `line-height: 1.6` no corpo e escala fluida com `clamp()` nos títulos.
- Hierarquia: tamanho, cor, espaçamento, composição e contraste; nunca peso sintético.

Todos os documentos HTML carregam, uma única vez e antes das folhas específicas:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Imprima&display=swap" rel="stylesheet">
```

A classe utilitária oficial permanece no sistema tipográfico compartilhado:

```css
.imprima-regular {
  font-family: "Imprima", sans-serif;
  font-weight: 400;
  font-style: normal;
}
```

## Controles e conteúdo

- Botões, campos, seletores, áreas de texto, opções, diálogos e tabelas usam a mesma pilha tipográfica.
- Textos longos em português do Brasil devem quebrar sem cortar conteúdo essencial.
- Tabelas podem usar rolagem horizontal interna quando a relação tabular exigir duas dimensões; a página não pode criar rolagem horizontal global.
- Foco de teclado deve permanecer visível em todos os controles operáveis.
- A autenticação permite rolagem vertical em telas baixas ou ampliadas.

## Segurança, privacidade e carregamento

- `style-src` libera somente a origem própria e `https://fonts.googleapis.com`.
- `font-src` libera somente a origem própria e `https://fonts.gstatic.com`.
- Não são permitidos curingas, estilos embutidos ou atributos `style`.
- `display=swap` mantém o texto visível durante o carregamento.
- Se as origens externas falharem ou forem bloqueadas, o fallback `sans-serif` deve preservar leitura, foco, reflow e operação.
- Qualquer futura auto-hospedagem da Imprima exige revisão separada de licença, cache, CSP, privacidade e desempenho.

## Evidência de qualidade

O relatório versionado em `docs/quality/validacao-tipografia-imprima.md` registra ambiente, rotas, larguras, zoom, fallback, LCP, CLS, bytes e requisições da validação final.

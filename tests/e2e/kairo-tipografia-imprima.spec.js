import { chromium, expect, test } from '@playwright/test';
import {
  entrarComoAdministrador,
  medirOverflowHorizontal,
  observarIntegridadeDaPagina
} from './support/session.js';

test.setTimeout(180000);

const ROTAS_TIPOGRAFICAS = [
  { nome: 'landing', caminho: '/', seletor: '.hero h1' },
  { nome: 'autenticação', caminho: '/login', seletor: '.brand' }
];

const VIEWPORTS_OBRIGATORIOS = [
  { nome: 'mobile compacto', width: 320, height: 720 },
  { nome: 'mobile de referência', width: 375, height: 812 },
  { nome: 'tablet vertical', width: 768, height: 1024 },
  { nome: 'desktop base', width: 1366, height: 900 },
  { nome: 'desktop de referência', width: 1440, height: 900 },
  { nome: 'desktop amplo', width: 1920, height: 1080 }
];

const CAPTURAR_EVIDENCIAS = process.env.KAIRO_CAPTURAR_EVIDENCIAS_TIPOGRAFICAS === '1';
const DIRETORIO_EVIDENCIAS = 'docs/design/evidence/imprima-2026';

async function capturarEvidencia(page, nomeArquivo) {
  if (!CAPTURAR_EVIDENCIAS) return;
  await documentFontReady(page);
  await page.screenshot({
    path: `${DIRETORIO_EVIDENCIAS}/${nomeArquivo}`,
    animations: 'disabled',
    fullPage: false
  });
}

async function instalarObservadoresDeDesempenho(page) {
  await page.addInitScript(() => {
    globalThis.__metricasTipografiaKairo = { cls: 0, lcp: 0 };

    new PerformanceObserver((lista) => {
      for (const entrada of lista.getEntries()) {
        if (!entrada.hadRecentInput) {
          globalThis.__metricasTipografiaKairo.cls += entrada.value;
        }
      }
    }).observe({ type: 'layout-shift', buffered: true });

    new PerformanceObserver((lista) => {
      const entradas = lista.getEntries();
      const ultima = entradas.at(-1);
      if (ultima) globalThis.__metricasTipografiaKairo.lcp = ultima.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
}

async function obterFontesRenderizadas(page, seletor) {
  const sessao = await page.context().newCDPSession(page);
  try {
    await sessao.send('DOM.enable');
    await sessao.send('CSS.enable');
    const { root } = await sessao.send('DOM.getDocument');
    const { nodeId } = await sessao.send('DOM.querySelector', {
      nodeId: root.nodeId,
      selector: seletor
    });
    expect(nodeId, `elemento tipográfico ausente: ${seletor}`).toBeGreaterThan(0);
    const { fonts } = await sessao.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts;
  } finally {
    await sessao.detach();
  }
}

async function aguardarImprimaReal(page, seletor) {
  const faces = await page.evaluate(async () => {
    await document.fonts.load('16px "Imprima"', 'Kairo: ação, foco e tranquilidade');
    await document.fonts.ready;
    return Array.from(document.fonts)
      .filter((face) => face.family.replaceAll('"', '') === 'Imprima')
      .map((face) => ({
        family: face.family.replaceAll('"', ''),
        status: face.status,
        weight: face.weight
      }));
  });

  expect(faces).toContainEqual({ family: 'Imprima', status: 'loaded', weight: '400' });
  const fontesRenderizadas = await obterFontesRenderizadas(page, seletor);
  expect(
    fontesRenderizadas.some(
      (fonte) => fonte.familyName === 'Imprima' && Number(fonte.glyphCount) > 0
    ),
    `Imprima não foi a fonte efetivamente renderizada em ${seletor}`
  ).toBe(true);
}

async function medirPagina(page) {
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    cls: Number(globalThis.__metricasTipografiaKairo?.cls || 0),
    lcpMs: Math.round(Number(globalThis.__metricasTipografiaKairo?.lcp || 0)),
    larguraViewport: window.innerWidth,
    larguraDocumento: document.documentElement.scrollWidth,
    alturaDocumento: document.documentElement.scrollHeight,
    familiaBody: getComputedStyle(document.body).fontFamily,
    sintese: getComputedStyle(document.documentElement).fontSynthesis
  }));
}

async function validarEstruturaLegivel(page, contexto) {
  const resultado = await page.evaluate(() => {
    const visiveis = Array.from(
      document.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea'
      )
    ).filter((elemento) => {
      const estilo = getComputedStyle(elemento);
      const caixa = elemento.getBoundingClientRect();
      const dentroDeMenuMovelFechado = Boolean(elemento.closest('.sidebar-nav:not(.open)'));
      return (
        !dentroDeMenuMovelFechado &&
        estilo.display !== 'none' &&
        estilo.visibility !== 'hidden' &&
        caixa.width > 0
      );
    });

    return {
      texto: document.body.innerText.trim().length,
      larguraViewport: window.innerWidth,
      larguraDocumento: document.documentElement.scrollWidth,
      controlesForaDaLargura: visiveis
        // Um controle dentro de uma faixa que rola na horizontal não está
        // cortado: ele é alcançável rolando, por ponteiro, roda ou teclado.
        // É assim que a barra de navegação acomoda dez destinos em 320px.
        // Recortado de verdade é o que transborda sem nenhuma forma de
        // alcance, e só isso deve reprovar.
        .filter((elemento) => {
          let ancestral = elemento.parentElement;
          while (ancestral && ancestral !== document.documentElement) {
            const estilo = window.getComputedStyle(ancestral);
            const rolaNaHorizontal =
              ['auto', 'scroll'].includes(estilo.overflowX) &&
              ancestral.scrollWidth > ancestral.clientWidth + 1;
            if (rolaNaHorizontal) return false;
            ancestral = ancestral.parentElement;
          }
          return true;
        })
        .map((elemento) => {
          const caixa = elemento.getBoundingClientRect();
          return {
            identificador:
              elemento.id || elemento.textContent?.trim().slice(0, 40) || elemento.tagName,
            esquerda: Math.round(caixa.left),
            direita: Math.round(caixa.right)
          };
        })
        .filter((caixa) => caixa.esquerda < -2 || caixa.direita > window.innerWidth + 2)
    };
  });

  expect(resultado.texto, `${contexto} ficou sem conteúdo legível`).toBeGreaterThan(20);
  expect(resultado.controlesForaDaLargura, `${contexto} possui controles cortados`).toEqual([]);
  expect(
    resultado.larguraDocumento,
    `${contexto} criou overflow horizontal global`
  ).toBeLessThanOrEqual(resultado.larguraViewport + 2);
}

async function validarFocoVisivel(page, contexto) {
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Tab');
  const foco = page.locator(':focus-visible');
  await expect(foco, `${contexto} não expôs foco de teclado`).toHaveCount(1);
  const estilo = await foco.evaluate((elemento) => {
    const calculado = getComputedStyle(elemento);
    return {
      largura: Number.parseFloat(calculado.outlineWidth),
      estilo: calculado.outlineStyle
    };
  });
  expect(estilo.estilo, `${contexto} removeu o anel de foco`).not.toBe('none');
  expect(estilo.largura, `${contexto} usa foco imperceptível`).toBeGreaterThanOrEqual(2);
}

test('Imprima 400 é carregada e efetivamente renderizada nos três shells', async ({
  page
}, testInfo) => {
  const integridade = observarIntegridadeDaPagina(page);
  const requisicoesTipograficas = [];
  const leiturasPendentes = [];

  page.on('response', (response) => {
    if (!/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//.test(response.url())) return;
    leiturasPendentes.push(
      response
        .body()
        .then((conteudo) => {
          requisicoesTipograficas.push({
            bytes: conteudo.byteLength,
            status: response.status(),
            url: response.url()
          });
        })
        .catch(() => {
          requisicoesTipograficas.push({
            bytes: 0,
            status: response.status(),
            url: response.url()
          });
        })
    );
  });

  await instalarObservadoresDeDesempenho(page);
  const metricas = [];

  for (const rota of ROTAS_TIPOGRAFICAS) {
    await page.goto(rota.caminho);
    await aguardarImprimaReal(page, rota.seletor);
    metricas.push({ rota: rota.nome, ...(await medirPagina(page)) });
  }

  await entrarComoAdministrador(page);
  await aguardarImprimaReal(page, '.logo-text');
  metricas.push({ rota: 'aplicativo', ...(await medirPagina(page)) });

  await Promise.all(leiturasPendentes);
  expect(
    requisicoesTipograficas.some((item) => item.url.startsWith('https://fonts.googleapis.com/'))
  ).toBe(true);
  expect(
    requisicoesTipograficas.some((item) => item.url.startsWith('https://fonts.gstatic.com/'))
  ).toBe(true);
  expect(requisicoesTipograficas.every((item) => item.status === 200)).toBe(true);
  expect(requisicoesTipograficas.reduce((total, item) => total + item.bytes, 0)).toBeGreaterThan(0);

  for (const metrica of metricas) {
    expect(metrica.familiaBody).toContain('Imprima');
    expect(metrica.sintese).toBe('none');
    expect(metrica.cls, `CLS elevado em ${metrica.rota}`).toBeLessThanOrEqual(0.1);
    expect(metrica.lcpMs, `LCP não foi observado em ${metrica.rota}`).toBeGreaterThan(0);
    expect(metrica.lcpMs, `LCP acima da faixa boa em ${metrica.rota}`).toBeLessThanOrEqual(2500);
  }

  const evidencia = {
    metricas,
    requisicoes: requisicoesTipograficas,
    totalBytes: requisicoesTipograficas.reduce((total, item) => total + item.bytes, 0)
  };
  console.info(`EVIDENCIA_TIPOGRAFIA_IMPRIMA=${JSON.stringify(evidencia)}`);

  await testInfo.attach('metricas-tipografia-imprima.json', {
    body: Buffer.from(JSON.stringify(evidencia, null, 2)),
    contentType: 'application/json'
  });

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

test('fallback sans-serif mantém os três shells íntegros quando Google Fonts é bloqueado', async ({
  browserName
}, testInfo) => {
  expect(browserName).toBe('chromium');
  const navegadorIsolado = await chromium.launch({ headless: true });
  const contextoIsolado = await navegadorIsolado.newContext({
    baseURL: testInfo.project.use.baseURL
  });
  const page = await contextoIsolado.newPage();
  const integridade = observarIntegridadeDaPagina(page, {
    ignorarBloqueiosTipograficosIntencionais: true
  });
  const requisicoesExternasBloqueadas = [];

  try {
    await page.route(/^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//, (route) => {
      requisicoesExternasBloqueadas.push(route.request().url());
      return route.abort('blockedbyclient');
    });
    await page.route('**/assets/css/*.css', async (route) => {
      const resposta = await route.fetch();
      const cssSemFonteLocal = (await resposta.text()).replaceAll(
        'Imprima',
        'ImprimaIndisponivelKairo'
      );
      await route.fulfill({ response: resposta, body: cssSemFonteLocal });
    });

    for (const rota of ROTAS_TIPOGRAFICAS) {
      await page.goto(rota.caminho);
      await documentFontReady(page);
      const fontes = await obterFontesRenderizadas(page, rota.seletor);
      expect(fontes.some((fonte) => fonte.familyName === 'Imprima')).toBe(false);
      await validarEstruturaLegivel(page, `${rota.nome} com fallback`);
    }

    await entrarComoAdministrador(page);
    await documentFontReady(page);
    const fontesApp = await obterFontesRenderizadas(page, '.logo-text');
    expect(fontesApp.some((fonte) => fonte.familyName === 'Imprima')).toBe(false);
    await validarEstruturaLegivel(page, 'aplicativo com fallback');
    expect(
      requisicoesExternasBloqueadas.some((url) => url.startsWith('https://fonts.googleapis.com/'))
    ).toBe(true);

    await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
      falhasRede: [],
      respostasHttp: [],
      errosConsole: []
    });
  } finally {
    await contextoIsolado.close();
    await navegadorIsolado.close();
  }
});

async function documentFontReady(page) {
  await page.evaluate(async () => document.fonts.ready);
}

test('tipografia preserva reflow, foco e controles de 320 a 1920 px e em zoom de 200%', async ({
  browser,
  page
}, testInfo) => {
  const integridade = observarIntegridadeDaPagina(page);

  for (const viewport of VIEWPORTS_OBRIGATORIOS) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await validarEstruturaLegivel(page, `landing / ${viewport.nome}`);
    await validarFocoVisivel(page, `landing / ${viewport.nome}`);
    if (viewport.width === 1440) await capturarEvidencia(page, 'landing-1440.png');

    await page.goto('/login');
    await validarEstruturaLegivel(page, `autenticação / ${viewport.nome}`);
    const botaoAutenticacao = page.locator(
      '#form-register:not(.hidden) .btn, #form-login:not(.hidden) .btn'
    );
    await botaoAutenticacao.scrollIntoViewIfNeeded();
    await expect(botaoAutenticacao).toBeVisible();
    if (viewport.width === 375) await capturarEvidencia(page, 'autenticacao-375.png');
  }

  await page.setViewportSize({ width: 1366, height: 900 });
  await entrarComoAdministrador(page);

  for (const viewport of VIEWPORTS_OBRIGATORIOS) {
    await page.setViewportSize(viewport);
    const overflow = await medirOverflowHorizontal(page);
    expect(overflow.elementosComOverflow, `aplicativo / ${viewport.nome}`).toEqual([]);
    expect(overflow.larguraDocumento).toBeLessThanOrEqual(viewport.width + 2);

    // A navegação é permanente em todas as larguras desde a remoção do
    // hambúrguer: não há mais estado "open" a verificar, e o destino é
    // alcançado do mesmo modo em qualquer viewport.
    await expect(page.locator('#sidebar-nav')).toBeVisible();
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await expect(page.locator('#section-agenda')).toBeVisible();
    await validarFocoVisivel(page, `aplicativo / ${viewport.nome}`);
    if (viewport.width === 1440) await capturarEvidencia(page, 'aplicativo-1440.png');
  }

  const contextoZoom = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    viewport: { width: 720, height: 450 },
    deviceScaleFactor: 2
  });
  const paginaZoom = await contextoZoom.newPage();
  try {
    await entrarComoAdministrador(paginaZoom);
    await paginaZoom.getByRole('button', { name: 'Agenda', exact: true }).click();
    const metricasZoom = await paginaZoom.evaluate(() => ({
      larguraCss: window.innerWidth,
      densidade: window.devicePixelRatio
    }));
    expect(metricasZoom).toEqual({ larguraCss: 720, densidade: 2 });
    await validarEstruturaLegivel(paginaZoom, 'aplicativo em 1440 px físicos com zoom de 200%');
    await capturarEvidencia(paginaZoom, 'aplicativo-zoom-200.png');
  } finally {
    await contextoZoom.close();
  }

  await page.setViewportSize({ width: 720, height: 450 });
  await validarEstruturaLegivel(page, 'aplicativo com reflow equivalente a 1440 px em 200%');

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

test('texto pt-BR no limite real permanece persistente, editável e sem overflow global', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);
  await entrarComoAdministrador(page);
  await page.setViewportSize({ width: 320, height: 720 });

  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: /Adicionar Compromisso/ }).click();

  const titulo =
    `Revisão estratégica de acessibilidade, foco e bem-estar — ${'ação contínua '.repeat(12)}`.slice(
      0,
      200
    );
  const descricao =
    `Descrição extensa em português do Brasil: ${'priorização consciente, comunicação clara e execução sustentável; '.repeat(80)}`.slice(
      0,
      4000
    );

  await page.getByLabel('Título do Compromisso *').fill(titulo);
  await page.getByLabel('Descrição / Detalhes').fill(descricao);
  await page.getByLabel('Data do Evento *').fill(new Date().toISOString().slice(0, 10));
  await page.getByLabel('Hora de Início *').fill('16:00');
  await page.getByLabel('Hora de Término *').fill('17:00');

  const resultadoCriacao = Promise.race([
    page
      .waitForResponse(
        (response) =>
          response.url().endsWith('/api/agenda') && response.request().method() === 'POST',
        { timeout: 15000 }
      )
      .then((response) => ({ tipo: 'resposta', status: response.status() })),
    page
      .locator('.toast-message')
      .waitFor({ state: 'visible', timeout: 15000 })
      .then(async () => ({
        tipo: 'mensagem',
        texto: await page.locator('.toast-message').textContent()
      }))
  ]);
  await page.locator('#modal-agenda-save').click();
  const resultado = await resultadoCriacao;
  expect(
    resultado,
    `criação interrompida antes da API: ${resultado.texto || 'sem mensagem'}`
  ).toEqual({
    tipo: 'resposta',
    status: 201
  });
  await expect(page.locator('#modal-agenda-overlay')).not.toHaveClass(/open/);

  const cartao = page.locator('.timeline-event-card').filter({ hasText: titulo }).first();
  await expect(cartao).toBeVisible();
  await cartao.click();
  await expect(page.getByLabel('Título do Compromisso *')).toHaveValue(titulo);
  await expect(page.getByLabel('Descrição / Detalhes')).toHaveValue(descricao);
  await validarEstruturaLegivel(page, 'modal com textos máximos em pt-BR');
  await page.locator('#modal-agenda-cancel').click();

  await page.reload();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await expect(page.locator('.timeline-event-card').filter({ hasText: titulo })).toBeVisible();
  await validarEstruturaLegivel(page, 'agenda persistida com texto máximo em pt-BR');

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

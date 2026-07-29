import { expect, test } from '@playwright/test';
import {
  entrarComoAdministrador,
  medirOverflowHorizontal,
  observarIntegridadeDaPagina
} from './support/session.js';

test.setTimeout(120000);

const LARGURAS = [
  { nome: 'mobile-compacto', largura: 320, altura: 700 },
  { nome: 'mobile-padrao', largura: 375, altura: 812 },
  { nome: 'desktop-largo', largura: 1440, altura: 900 }
];

test('QA real: Imprima computada em todo o app, fallback com fontes bloqueadas, larguras e zoom 200%', async ({
  page,
  browser
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  // ── 1) A tipografia oficial é computada na landing, no login e no app ──
  //
  // A Imprima existe apenas em peso 400 e o projeto declara font-synthesis:
  // none, então nenhum destaque por peso era exibido. A Hanken Grotesk entra
  // como companheira exclusivamente nos pesos 500 a 700; o texto corrido
  // continua sendo Imprima. Um elemento pertence à tipografia oficial quando
  // computa uma das duas — nunca uma fonte de sistema.
  const TIPOGRAFIA_OFICIAL = /Imprima|Hanken Grotesk/;

  await page.goto('/');
  const fonteLanding = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fonteLanding).toContain('Imprima');

  await entrarComoAdministrador(page);
  for (const seletor of ['body', 'button', 'input', 'table', 'select']) {
    const fonte = await page
      .locator(seletor)
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily)
      .catch(() => null);
    if (fonte) expect(fonte, `fonte computada de <${seletor}>`).toMatch(TIPOGRAFIA_OFICIAL);
  }

  // O corpo do texto permanece exclusivamente em Imprima: a companheira não
  // pode vazar para a leitura corrente.
  const fonteCorpo = await page.locator('body').evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fonteCorpo).toContain('Imprima');

  // ── 2) Larguras exigidas pela tarefa sem overflow horizontal real ──
  for (const tela of LARGURAS) {
    await page.setViewportSize({ width: tela.largura, height: tela.altura });
    const overflow = await medirOverflowHorizontal(page);
    expect(
      overflow.elementosComOverflow,
      `overflow horizontal em ${tela.nome} (${tela.largura}px)`
    ).toEqual([]);
  }
  await page.setViewportSize({ width: 1366, height: 900 });

  // ── 3) Zoom de 200%: conteúdo legível e sem corte horizontal do documento ──
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  const overflowZoom = await medirOverflowHorizontal(page);
  expect(overflowZoom.larguraDocumento).toBeLessThanOrEqual(overflowZoom.larguraViewport + 2);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });

  // ── 4) Fallback real: bloqueio de fonts.googleapis.com e fonts.gstatic.com ──
  const contextoBloqueado = await browser.newContext({
    viewport: { width: 1366, height: 900 }
  });
  await contextoBloqueado.route(/fonts\.(googleapis|gstatic)\.com/, (rota) => rota.abort());
  const paginaBloqueada = await contextoBloqueado.newPage();

  await paginaBloqueada.goto('/');
  // O texto da chamada principal é escrito por landing.js e diz "Começar
  // gratuitamente" para quem não tem sessão; o teste buscava "Começar agora",
  // que não existe na página.
  // A landing repete a chamada em três pontos da página; basta que a primeira
  // esteja visível para provar que a tipografia carregou sem as fontes remotas.
  await expect(
    paginaBloqueada.getByRole('link', { name: /Começar gratuitamente/ }).first()
  ).toBeVisible();
  const fonteFallback = await paginaBloqueada
    .locator('body')
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(fonteFallback).toContain('sans-serif');
  const overflowFallback = await paginaBloqueada.evaluate(() => ({
    documento: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    viewport: window.innerWidth
  }));
  expect(overflowFallback.documento).toBeLessThanOrEqual(overflowFallback.viewport + 2);

  await paginaBloqueada.goto('/login');
  await expect(paginaBloqueada.locator('#form-register, #form-login').first()).toBeVisible();

  await contextoBloqueado.close();
});

import { expect, test } from '@playwright/test';
import {
  entrarComoAdministrador,
  medirOverflowHorizontal,
  observarIntegridadeDaPagina
} from './support/session.js';

test.setTimeout(120000);

const secoesAdministrativas = [
  { nav: 'Dashboard', seletor: '#section-dashboard', textoEsperado: /Compromissos|Hoje/i },
  { nav: 'Agenda', seletor: '#section-agenda', textoEsperado: /Minha Agenda/i },
  {
    nav: 'Relatórios',
    seletor: '#section-reports',
    textoEsperado: /Relatórios & Insights de Produtividade/i
  },
  { nav: 'Configurações', seletor: '#section-settings', textoEsperado: /Painel de Configurações/i },
  { nav: 'Usuários', seletor: '#section-users', textoEsperado: /Gestão de Usuários e Perfis/i },
  { nav: 'Planos', seletor: '#section-plans', textoEsperado: /Planos e Funcionalidades/i },
  { nav: 'Dopamina', seletor: '#section-dopamine', textoEsperado: /Gestão de Dopamina/i }
];

const viewportsObrigatorios = [
  { nome: 'mobile compacto', largura: 390, altura: 844 },
  { nome: 'tablet vertical', largura: 768, altura: 1024 },
  { nome: 'desktop amplo', largura: 1366, altura: 900 }
];

async function abrirMenuQuandoMobile(page) {
  const larguraViewport = page.viewportSize()?.width ?? 1366;
  if (larguraViewport <= 700) {
    await page.getByRole('button', { name: 'Menu principal' }).click();
    await expect(page.locator('#sidebar-nav')).toHaveClass(/open/);
  }
}

async function validarSecaoAtiva(page, secao) {
  await abrirMenuQuandoMobile(page);
  await page.getByRole('button', { name: new RegExp(secao.nav, 'i') }).click();
  await expect(page.locator(secao.seletor)).toBeVisible();
  await expect(page.locator(secao.seletor)).toContainText(secao.textoEsperado);

  const larguraViewport = page.viewportSize()?.width ?? 1366;
  if (larguraViewport <= 700) {
    await expect(page.locator('#sidebar-nav')).not.toHaveClass(/open/);
    await expect
      .poll(async () => {
        const caixa = await page.locator('#sidebar-nav').boundingBox();
        return Math.round(caixa?.right ?? 0);
      })
      .toBeLessThanOrEqual(2);
  }
}

test('navegação administrativa real não quebra menus, dropdowns, modais e responsividade', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  await entrarComoAdministrador(page);
  await expect(page.locator('#profile-role-badge')).toContainText('Administrador');

  for (const viewport of viewportsObrigatorios) {
    await page.setViewportSize({ width: viewport.largura, height: viewport.altura });

    for (const secao of secoesAdministrativas) {
      await validarSecaoAtiva(page, secao);
      const overflow = await medirOverflowHorizontal(page);
      expect
        .soft(overflow, `overflow horizontal em ${viewport.nome} / ${secao.nav}`)
        .toMatchObject({
          larguraDocumento: expect.any(Number),
          larguraViewport: viewport.largura,
          elementosComOverflow: []
        });
      expect
        .soft(overflow.larguraDocumento, `largura documental em ${viewport.nome} / ${secao.nav}`)
        .toBeLessThanOrEqual(viewport.largura + 2);
    }
  }

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('#profile-toggle').click();
  await page.locator('#dropdown-profile-btn').click();
  await expect(page.locator('#modal-profile-overlay')).toHaveClass(/open/);
  await expect(page.locator('#profile-username')).toHaveValue(/Administrador QA/);
  await page.locator('#modal-profile-cancel').click();
  await expect(page.locator('#modal-profile-overlay')).not.toHaveClass(/open/);

  await page.locator('#profile-toggle').click();
  await page.locator('#dropdown-prefs-btn').click();
  await expect(page.locator('#modal-preferences-overlay')).toHaveClass(/open/);
  await expect(page.locator('#pref-theme')).toBeVisible();
  await expect(page.locator('#pref-confetti')).toBeVisible();
  await page.locator('#modal-preferences-cancel').click();
  await expect(page.locator('#modal-preferences-overlay')).not.toHaveClass(/open/);

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

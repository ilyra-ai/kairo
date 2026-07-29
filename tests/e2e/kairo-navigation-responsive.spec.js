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

// O botão hambúrguer foi removido do produto: a navegação passou a ser
// permanente em todas as larguras, exibindo apenas os ícones. Não há mais menu
// a abrir — abaixo de 780px a faixa rola na horizontal, então o que precisa ser
// garantido é que o alvo esteja à vista antes do clique.
async function garantirNavegacaoAcessivel(page) {
  await expect(page.locator('#sidebar-nav')).toBeVisible();
}

async function validarSecaoAtiva(page, secao) {
  await garantirNavegacaoAcessivel(page);
  // Correspondência exata: o menu tem itens cujo nome é prefixo de outro
  // ("Configurações" e "Configurações de IA"), e uma expressão parcial alcança
  // os dois, fazendo o Playwright recusar o clique por ambiguidade.
  await page.getByRole('button', { name: secao.nav, exact: true }).click();
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

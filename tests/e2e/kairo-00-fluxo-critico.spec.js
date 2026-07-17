import { expect, test } from '@playwright/test';
import { ADMIN_QA, observarIntegridadeDaPagina } from './support/session.js';

function hojeIso() {
  return new Date().toISOString().slice(0, 10);
}

test('fluxo crítico real: cadastro, agenda, CSP, acessibilidade administrativa e estilos dinâmicos', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  await page.goto('/login');
  await expect(page.locator('#form-register')).toBeVisible();
  await expect(page.locator('#auth-context')).toContainText('Crie a primeira conta administrativa');

  await page.locator('#reg-name').fill(ADMIN_QA.nome);
  await page.locator('#reg-email').fill(ADMIN_QA.email);
  await page.locator('#reg-password').fill(ADMIN_QA.senha);
  await page.getByRole('button', { name: 'Criar conta grátis' }).click();

  await page.waitForURL('**/app');
  await expect(page.getByRole('button', { name: /Dashboard/ })).toBeVisible();
  await expect(page.locator('#profile-role-badge')).toContainText('Administrador');

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content');
  expect(csp).toContain("style-src-attr 'none'");
  expect(csp).not.toContain("'unsafe-inline'");

  const fonteComputada = await page
    .locator('body')
    .evaluate((body) => getComputedStyle(body).fontFamily);
  expect(fonteComputada).toContain('Imprima');

  await page.getByRole('button', { name: /Agenda/ }).click();
  await page.getByRole('button', { name: /Adicionar Compromisso/ }).click();
  await expect(page.locator('#modal-agenda-title')).toHaveText('Novo Compromisso');
  await expect(page.locator('#modal-agenda-save')).toHaveText('Agendar');

  await page.getByLabel('Título do Compromisso *').fill('Compromisso QA CSP');
  await page
    .getByLabel('Descrição / Detalhes')
    .fill('Validação real de estilo dinâmico sem atributo style.');
  await page.getByLabel('Data do Evento *').fill(hojeIso());
  await page.getByLabel('Hora de Início *').fill('09:00');
  await page.getByLabel('Hora de Término *').fill('10:00');
  await page.getByLabel('Cor Customizada:').fill('#12ab34');
  await page.locator('#modal-agenda-save').click();

  await expect(page.locator('#modal-agenda-overlay')).not.toHaveClass(/open/);
  await expect(page.getByText('Compromisso QA CSP')).toBeVisible();

  const cartaoAgenda = page
    .locator('.timeline-event-card')
    .filter({ hasText: 'Compromisso QA CSP' })
    .first();
  await expect(cartaoAgenda).toBeVisible();
  await expect
    .poll(() => cartaoAgenda.evaluate((element) => getComputedStyle(element).borderLeftColor))
    .toBe('rgb(18, 171, 52)');

  await expect(page.locator('[style]')).toHaveCount(0);

  await cartaoAgenda.click();
  await expect(page.locator('#modal-agenda-title')).toHaveText('Editar Compromisso');
  await expect(page.locator('#modal-agenda-save')).toHaveText('Salvar alterações');
  await page.locator('#modal-agenda-cancel').click();

  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.locator('label[for="settings-theme"]')).toBeVisible();
  await expect(page.locator('label[for="settings-confetti"]')).toBeVisible();
  await expect(page.locator('label[for="settings-sound"]')).toBeVisible();

  await page.getByRole('button', { name: /Planos/ }).click();
  const primeiroToggle = page.locator('.admin-plan-toggle').first();
  await expect(primeiroToggle).toHaveAttribute('aria-label', /plano/i);
  await expect(page.locator('.feat-del').first()).toHaveAttribute(
    'aria-label',
    /Excluir funcionalidade/i
  );

  await page.getByRole('button', { name: /Usuários/ }).click();
  await expect(page.locator('.user-role-select').first()).toHaveAttribute(
    'aria-label',
    /Perfil de acesso/
  );
  await expect(page.locator('.user-plan-select').first()).toHaveAttribute(
    'aria-label',
    /Plano comercial/
  );

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

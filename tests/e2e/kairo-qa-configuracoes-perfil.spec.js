import { expect, test } from '@playwright/test';
import {
  confirmarSenhaAtualQuandoSolicitada,
  entrarComoAdministrador,
  observarIntegridadeDaPagina
} from './support/session.js';

test.setTimeout(90000);

test('QA real: configurações persistem, perfil edita e preferências sincronizam', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  await entrarComoAdministrador(page);
  await expect(page.locator('#profile-role-badge')).toContainText('Administrador');

  // ── CONFIGURAÇÕES: alterações persistem de verdade após recarregar ──
  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.locator('#section-settings')).toBeVisible();

  await page.locator('#settings-theme').selectOption('claro');
  const confettiAntes = await page.locator('#settings-confetti').isChecked();
  await page.locator('#settings-confetti').setChecked(!confettiAntes);
  await expect
    .poll(async () => page.evaluate(() => document.body.classList.contains('light-theme')))
    .toBe(true);

  await page.reload();
  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.locator('#settings-theme')).toHaveValue('claro');
  await expect.poll(() => page.locator('#settings-confetti').isChecked()).toBe(!confettiAntes);

  // restaura tema escuro para os demais QAs
  await page.locator('#settings-theme').selectOption('escuro');
  await expect(page.locator('#settings-theme')).toHaveValue('escuro');

  // ── PERFIL: edição real do nome com persistência ──
  await page.locator('#profile-toggle').click();
  await page.locator('#dropdown-profile-btn').click();
  await expect(page.locator('#modal-profile-overlay')).toHaveClass(/open/);
  await page.locator('#profile-username').fill('Administrador QA Integral');
  await page.locator('#modal-profile-save').click();
  await confirmarSenhaAtualQuandoSolicitada(page);
  await expect(page.locator('#modal-profile-overlay')).not.toHaveClass(/open/);

  await page.locator('#profile-toggle').click();
  await page.locator('#dropdown-profile-btn').click();
  await expect(page.locator('#profile-username')).toHaveValue('Administrador QA Integral');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-profile-overlay')).not.toHaveClass(/open/);

  // ── PREFERÊNCIAS: modal salva e sincroniza com Configurações ──
  await page.locator('#profile-toggle').click();
  await page.locator('#dropdown-prefs-btn').click();
  await expect(page.locator('#modal-preferences-overlay')).toHaveClass(/open/);
  await page.locator('#pref-theme').selectOption('claro');
  await page.locator('#modal-preferences-save').click();
  await expect(page.locator('#modal-preferences-overlay')).not.toHaveClass(/open/);
  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.locator('#settings-theme')).toHaveValue('claro');
  await page.locator('#settings-theme').selectOption('escuro');

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

import { expect, test } from '@playwright/test';
import { entrarComoAdministrador, observarIntegridadeDaPagina } from './support/session.js';

test.setTimeout(90000);

test('QA real: pill do Google na Agenda reflete o estado real com ícone + rótulo + cor', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  await entrarComoAdministrador(page);
  await page.getByRole('button', { name: /Agenda/ }).click();

  const pill = page.locator('#agenda-google-pill');
  await expect(pill).toBeVisible();

  // O pill sai de "loading" para um estado real do backend.
  await expect.poll(() => pill.getAttribute('data-state')).not.toBe('loading');

  const estado = await pill.getAttribute('data-state');
  const icone = (await page.locator('#agenda-google-icon').textContent())?.trim();
  const rotulo = (await page.locator('#agenda-google-label').textContent())?.trim();

  // Nenhum estado é transmitido apenas por cor: ícone e rótulo sempre presentes.
  expect(icone && icone.length > 0).toBeTruthy();
  expect(rotulo && rotulo.length > 0).toBeTruthy();

  if (estado === 'connected') {
    expect(icone).toContain('✓');
    await expect(page.locator('#agenda-google-sync')).toBeVisible();
  } else if (estado === 'disconnected') {
    expect(icone).toContain('✕');
    await expect(page.locator('#agenda-google-sync')).toBeHidden();
  } else {
    // warning (não configurada) ou danger — botão de sync oculto.
    await expect(page.locator('#agenda-google-sync')).toBeHidden();
  }

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

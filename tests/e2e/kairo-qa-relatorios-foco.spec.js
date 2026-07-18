import { expect, test } from '@playwright/test';
import { entrarComoAdministrador, observarIntegridadeDaPagina } from './support/session.js';

test.setTimeout(90000);

test('QA real: horas semanais alimentam relatórios e o modo foco conta de verdade', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  await entrarComoAdministrador(page);

  // ── DADOS REAIS: editar horas no período semanal (fonte dos Relatórios) ──
  await page.getByRole('button', { name: /Dashboard/ }).click();
  await page.locator('#weekly').click();
  const card = page.locator('.card[data-id]').first();
  await expect(card).toBeVisible();
  const cardId = await card.getAttribute('data-id');
  await card.locator('.ellipsis-btn').click();
  await page.locator(`#dropdown-${cardId}`).getByText('Editar Horas', { exact: true }).click();
  await expect(page.locator('#modal-edit-title')).toContainText(/semanal/i);
  await page.locator('#edit-current').fill('3.5');
  await page.locator('#edit-previous').fill('1');
  await page.locator('#modal-edit-save').click();
  await expect(page.locator(`.card[data-id="${cardId}"] .time-duration h1`)).toHaveText('3.5hrs');

  // ── RELATÓRIOS: KPIs, grid, gráfico radial e legenda com dados reais ──
  await page.getByRole('button', { name: /Relatórios/ }).click();
  await expect(page.locator('#section-reports')).toBeVisible();
  await expect(page.locator('#reports-grid')).not.toBeEmpty();
  await expect(page.locator('#reports-grid')).toContainText('3.5');
  await expect(page.locator('#reports-chart-radial')).toBeVisible();
  await expect(page.locator('#reports-chart-legend')).not.toBeEmpty();
  await expect(page.locator('#report-kpi-top-activity')).not.toHaveText('-');

  // ── MODO FOCO: play, contagem real, pausa e reset ──
  await page.getByRole('button', { name: /Dashboard/ }).click();
  const displayInicial = (await page.locator('#focus-timer-display').textContent())?.trim();
  await page.locator('#btn-focus-play-pause').click();
  await expect
    .poll(async () => (await page.locator('#focus-timer-display').textContent())?.trim(), {
      timeout: 5000
    })
    .not.toBe(displayInicial);
  await page.locator('#btn-focus-play-pause').click();
  await page.locator('#btn-focus-reset').click();
  await expect(page.locator('#focus-timer-display')).toHaveText(displayInicial ?? '25:00');

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

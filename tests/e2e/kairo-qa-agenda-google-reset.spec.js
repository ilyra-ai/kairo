import { expect, test } from '@playwright/test';
import {
  confirmarSenhaAtualQuandoSolicitada,
  entrarComoAdministrador,
  observarIntegridadeDaPagina
} from './support/session.js';

test.setTimeout(120000);

function hojeIso() {
  return new Date().toISOString().slice(0, 10);
}

test('QA real: agenda completa (editar, layouts, excluir), Google honesto e reset com reautenticação', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  await entrarComoAdministrador(page);

  // ── AGENDA: criar compromisso real ──
  await page.getByRole('button', { name: /Agenda/ }).click();
  await page.getByRole('button', { name: /Adicionar Compromisso/ }).click();
  await page.getByLabel('Título do Compromisso *').fill('Compromisso QA Integral');
  await page.getByLabel('Data do Evento *').fill(hojeIso());
  await page.getByLabel('Hora de Início *').fill('14:00');
  await page.getByLabel('Hora de Término *').fill('15:00');
  await page.locator('#modal-agenda-save').click();
  await expect(page.locator('#modal-agenda-overlay')).not.toHaveClass(/open/);

  const cartao = page
    .locator('.timeline-event-card')
    .filter({ hasText: 'Compromisso QA Integral' })
    .first();
  await expect(cartao).toBeVisible();

  // ── AGENDA: edição com salvamento real e persistência comprovada ──
  await cartao.click();
  await expect(page.locator('#modal-agenda-title')).toHaveText('Editar Compromisso');
  await page.getByLabel('Título do Compromisso *').fill('Compromisso QA Integral Editado');
  await page.getByLabel('Hora de Término *').fill('15:30');
  await page.locator('#modal-agenda-save').click();
  await expect(page.locator('#modal-agenda-overlay')).not.toHaveClass(/open/);
  await expect(
    page.locator('.timeline-event-card').filter({ hasText: 'Compromisso QA Integral Editado' })
  ).toBeVisible();

  await page.reload();
  await page.getByRole('button', { name: /Agenda/ }).click();
  const cartaoEditado = page
    .locator('.timeline-event-card')
    .filter({ hasText: 'Compromisso QA Integral Editado' })
    .first();
  await expect(cartaoEditado).toBeVisible();

  // ── AGENDA: alternância real de layouts sem quebrar a página ──
  await page.locator('#btn-layout-kanban').click();
  await expect(page.getByText('Compromisso QA Integral Editado').first()).toBeVisible();
  await page.locator('#btn-layout-todoist').click();
  await expect(page.getByText('Compromisso QA Integral Editado').first()).toBeVisible();
  await page.locator('#btn-layout-atual').click();
  await expect(
    page.locator('.timeline-event-card').filter({ hasText: 'Compromisso QA Integral Editado' })
  ).toBeVisible();

  // ── AGENDA: exclusão real com modal de confirmação dedicado ──
  const botaoExcluirEvento = page.getByRole('button', { name: 'Excluir evento' }).first();
  if (await botaoExcluirEvento.isVisible().catch(() => false)) {
    await botaoExcluirEvento.click();
  } else {
    await cartaoEditado.locator('.btn-delete').first().click();
  }
  await expect(page.locator('#modal-confirm-delete-overlay')).toHaveClass(/open/);
  await page.locator('#modal-confirm-delete-btn').click();
  await expect(page.locator('#modal-confirm-delete-overlay')).not.toHaveClass(/open/);
  await expect(
    page.locator('.timeline-event-card').filter({ hasText: 'Compromisso QA Integral Editado' })
  ).toHaveCount(0);

  // ── GOOGLE AGENDA: status honesto conforme configuração real do ambiente ──
  await page.getByRole('button', { name: /Configurações/ }).click();
  await expect(page.locator('#google-status-title')).not.toBeEmpty();
  const estadoGoogle = (await page.locator('#google-status-title').textContent())?.trim();
  if (estadoGoogle === 'Não configurada') {
    await expect(page.locator('#google-hint')).toContainText('GOOGLE_CLIENT_ID');
    await expect(page.locator('#btn-google-connect')).toBeHidden();
    await expect(page.locator('#btn-google-sync')).toBeHidden();
  } else if (estadoGoogle === 'Desconectada') {
    await expect(page.locator('#btn-google-connect')).toBeVisible();
    await expect(page.locator('#btn-google-sync')).toBeHidden();
  } else if (estadoGoogle === 'Conectada') {
    await expect(page.locator('#btn-google-sync')).toBeVisible();
    await expect(page.locator('#btn-google-disconnect')).toBeVisible();
  }

  // ── RESET DO WORKSPACE: destrutivo real com Escape, reautenticação e re-seed ──
  await page.locator('#settings-db-reset').click();
  await expect(page.locator('#modal-confirm-reset-overlay')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-confirm-reset-overlay')).not.toHaveClass(/open/);

  await page.locator('#settings-db-reset').click();
  await page.locator('#modal-confirm-reset-btn').click();
  await confirmarSenhaAtualQuandoSolicitada(page);
  await expect(page.locator('#modal-confirm-reset-overlay')).not.toHaveClass(/open/);

  await page.getByRole('button', { name: /Dashboard/ }).click();
  await expect(page.locator('.card[data-id]').first()).toBeVisible();

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

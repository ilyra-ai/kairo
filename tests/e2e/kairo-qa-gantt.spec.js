import { expect, test } from '@playwright/test';
import { entrarComoAdministrador, observarIntegridadeDaPagina } from './support/session.js';

test.setTimeout(120000);

function hojeIso() {
  return new Date().toISOString().slice(0, 10);
}

test('QA real: layout Gantt exibe barras reais, edita ao clicar e mantém alternativa acessível', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  await entrarComoAdministrador(page);

  // Cria um compromisso real para aparecer no Gantt.
  await page.getByRole('button', { name: /Agenda/ }).click();
  await page.getByRole('button', { name: /Adicionar Compromisso/ }).click();
  await page.getByLabel('Título do Compromisso *').fill('Compromisso Gantt QA');
  await page.getByLabel('Data do Evento *').fill(hojeIso());
  await page.getByLabel('Hora de Início *').fill('09:00');
  await page.getByLabel('Hora de Término *').fill('11:00');
  await page.locator('#modal-agenda-save').click();
  await expect(page.locator('#modal-agenda-overlay')).not.toHaveClass(/open/);

  // Alterna para o layout Gantt.
  await page.locator('#btn-layout-gantt').click();
  await expect(page.locator('.agenda-gantt')).toBeVisible();

  // A barra do compromisso aparece com rótulo real.
  const barra = page.locator('.gantt-bar').filter({ hasText: 'Compromisso Gantt QA' }).first();
  await expect(barra).toBeVisible();

  // Controles de zoom presentes.
  await expect(page.getByRole('button', { name: 'Dia' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Semana' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mês' })).toBeVisible();

  // Alternativa acessível em lista descreve o compromisso.
  await expect(page.locator('.gantt-a11y-item').first()).toContainText('Compromisso Gantt QA');

  // Clicar na barra abre o modal de edição do evento correto.
  await barra.click();
  await expect(page.locator('#modal-agenda-title')).toHaveText('Editar Compromisso');
  await expect(page.getByLabel('Título do Compromisso *')).toHaveValue('Compromisso Gantt QA');
  await page.locator('#modal-agenda-cancel').click();

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

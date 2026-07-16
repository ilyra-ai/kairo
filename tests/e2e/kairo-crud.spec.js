import { expect, test } from '@playwright/test';
import {
  confirmarSenhaAtualQuandoSolicitada,
  entrarComoAdministrador,
  observarIntegridadeDaPagina
} from './support/session.js';

test.setTimeout(120000);

async function localizarPrimeiraAtividade(page) {
  const card = page.locator('.card[data-id]').first();
  await expect(card).toBeVisible();
  const id = await card.getAttribute('data-id');
  const titulo = (await card.locator('.top-section p').textContent())?.trim() ?? 'Atividade';
  return { id, titulo };
}

async function acionarOpcaoDaAtividade(page, id, nomeOpcao) {
  const card = page.locator(`.card[data-id="${id}"]`);
  await card.locator('.ellipsis-btn').click();
  await page.locator(`#dropdown-${id}`).getByText(nomeOpcao, { exact: true }).click();
}

test('CRUD real: atividades, metas, exclusão, teclado e gestão administrativa de usuários', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  await entrarComoAdministrador(page);
  await expect(page.locator('#profile-role-badge')).toContainText('Administrador');

  const { id, titulo } = await localizarPrimeiraAtividade(page);

  await acionarOpcaoDaAtividade(page, id, 'Editar Horas');
  await expect(page.locator('#modal-edit-overlay')).toHaveClass(/open/);
  await expect(page.locator('#modal-edit-title')).toContainText(titulo);
  await page.locator('#edit-current').fill('2.5');
  await page.locator('#edit-previous').fill('1.25');
  await page.locator('#modal-edit-save').click();
  await expect(page.locator('#modal-edit-overlay')).not.toHaveClass(/open/);
  await expect(page.locator(`.card[data-id="${id}"] .time-duration h1`)).toHaveText('2.5hrs');
  await expect(page.locator(`.card[data-id="${id}"] .time-duration small`)).toContainText(
    '1.25hrs'
  );

  await acionarOpcaoDaAtividade(page, id, 'Definir Meta');
  await expect(page.locator('#modal-goal-overlay')).toHaveClass(/open/);
  await expect(page.locator('#modal-goal-title')).toContainText(titulo);
  await page.locator('#goal-target').fill('5');
  await page.locator('#modal-goal-save').click();
  await expect(page.locator('#modal-goal-overlay')).not.toHaveClass(/open/);
  await expect(page.locator(`#progress-${id}`)).toContainText('Meta: 5hrs');
  await expect(page.locator(`#progress-${id}`)).toContainText('50%');

  await acionarOpcaoDaAtividade(page, id, 'Ver Detalhes');
  await expect(page.locator('#modal-details-overlay')).toHaveClass(/open/);
  await expect(page.locator('#modal-details-title')).toContainText(titulo);
  await expect(page.locator('#details-grid')).toContainText('2.5hrs');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-details-overlay')).not.toHaveClass(/open/);

  await acionarOpcaoDaAtividade(page, id, 'Excluir');
  await expect(page.locator('#modal-delete-overlay')).toHaveClass(/open/);
  await expect(page.locator('#delete-activity-name')).toHaveText(titulo);
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal-delete-overlay')).not.toHaveClass(/open/);

  await acionarOpcaoDaAtividade(page, id, 'Excluir');
  await page.locator('#modal-delete-confirm').click();
  await confirmarSenhaAtualQuandoSolicitada(page);
  await expect(page.locator('#modal-delete-overlay')).not.toHaveClass(/open/);
  await expect(page.locator(`.card[data-id="${id}"]`)).toHaveCount(0);

  await page.getByRole('button', { name: /Usuários/ }).click();
  await page.getByRole('button', { name: /Novo Usuário/ }).click();
  const dialogoCadastro = page.getByRole('dialog', { name: 'Cadastrar usuário' });
  await expect(dialogoCadastro).toBeVisible();
  await dialogoCadastro.locator('[name="name"]').fill('Usuário QA CRUD');
  await dialogoCadastro.locator('[name="email"]').fill('qa-crud@kairo.local');
  await dialogoCadastro.locator('[name="password"]').fill('KairoCRUD!2026');
  await dialogoCadastro.getByRole('button', { name: 'Criar usuário' }).click();

  const linhaUsuario = page
    .locator('#users-table-body tr')
    .filter({ hasText: 'qa-crud@kairo.local' });
  await expect(linhaUsuario).toBeVisible();
  await linhaUsuario.locator('.user-role-select').selectOption('administrador');
  await expect(linhaUsuario.locator('.user-role-select')).toHaveValue('administrador');
  await linhaUsuario.locator('.user-plan-select').selectOption('pro');
  await expect(linhaUsuario.locator('.user-plan-select')).toHaveValue('pro');

  await linhaUsuario.getByRole('button', { name: /Excluir usuário Usuário QA CRUD/ }).click();
  const dialogoExclusaoUsuario = page.getByRole('dialog', { name: 'Excluir usuário' });
  await expect(dialogoExclusaoUsuario).toBeVisible();
  await dialogoExclusaoUsuario.getByRole('button', { name: 'Excluir usuário' }).click();
  await confirmarSenhaAtualQuandoSolicitada(page);
  await expect(
    page.locator('#users-table-body tr').filter({ hasText: 'qa-crud@kairo.local' })
  ).toHaveCount(0);

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

import { expect, test } from '@playwright/test';
import {
  confirmarSenhaAtualQuandoSolicitada,
  entrarComoAdministrador,
  observarIntegridadeDaPagina
} from './support/session.js';

test.setTimeout(120000);

async function preencherDialogo(page, titulo, valores, confirmar) {
  const dialogo = page.getByRole('dialog', { name: titulo });
  await expect(dialogo).toBeVisible();

  for (const [nome, valor] of Object.entries(valores)) {
    await dialogo.locator(`[name="${nome}"]`).fill(String(valor));
  }

  await dialogo.getByRole('button', { name: confirmar }).click();
  await confirmarSenhaAtualQuandoSolicitada(page);
  await expect(dialogo).not.toBeVisible();
}

async function confirmarDialogo(page, titulo, botao) {
  const dialogo = page.getByRole('dialog', { name: titulo });
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole('button', { name: botao }).click();
  await confirmarSenhaAtualQuandoSolicitada(page);
  await expect(dialogo).not.toBeVisible();
}

test('CRUD real: planos, funcionalidades e gestão administrativa de Dopamina', async ({ page }) => {
  const integridade = observarIntegridadeDaPagina(page);

  await entrarComoAdministrador(page);
  await expect(page.locator('#profile-role-badge')).toContainText('Administrador');

  await page.getByRole('button', { name: /Planos/ }).click();
  await expect(page.locator('#section-plans')).toBeVisible();
  await expect(page.locator('#plans-matrix-table')).toContainText('Funcionalidade');

  await page.locator('#btn-add-plan').click();
  await preencherDialogo(
    page,
    'Criar novo plano',
    {
      name: 'Plano QA Premium',
      key: 'qa_premium',
      price: '4900'
    },
    'Criar plano'
  );
  await expect(page.locator('#plans-matrix-head')).toContainText('Plano QA Premium');

  await page.locator('#btn-add-feature').click();
  await preencherDialogo(
    page,
    'Criar funcionalidade',
    {
      label: 'Assistente QA Premium',
      key: 'qa_assistente'
    },
    'Criar funcionalidade'
  );
  await expect(page.locator('#plans-matrix-body')).toContainText('Assistente QA Premium');

  const alternadorFeature = page.getByRole('button', {
    name: /Assistente QA Premium no plano Plano QA Premium/
  });
  await expect(alternadorFeature).toBeVisible();
  const estadoAntes = await alternadorFeature.getAttribute('aria-pressed');
  await alternadorFeature.click();
  await confirmarSenhaAtualQuandoSolicitada(page);
  await expect(alternadorFeature).toHaveAttribute(
    'aria-pressed',
    estadoAntes === 'true' ? 'false' : 'true'
  );

  await page.getByRole('button', { name: 'Excluir funcionalidade Assistente QA Premium' }).click();
  await confirmarDialogo(page, 'Excluir funcionalidade', 'Excluir funcionalidade');
  await expect(page.locator('#plans-matrix-body')).not.toContainText('Assistente QA Premium');

  await page.getByRole('button', { name: 'Excluir plano Plano QA Premium' }).click();
  await confirmarDialogo(page, 'Excluir plano', 'Excluir plano');
  await expect(page.locator('#plans-matrix-head')).not.toContainText('Plano QA Premium');

  await page.getByRole('button', { name: /Dopamina/ }).click();
  await expect(page.locator('#section-dopamine')).toBeVisible();
  await expect(page.locator('#dopamine-toggles')).toContainText('Recompensa Variável + Jackpot');
  await expect(page.locator('#dopamine-ai')).toContainText('IA nunca repete o mesmo prêmio');

  const alternadorGerador = page.getByRole('button', {
    name: 'Recompensa Variável + Jackpot'
  });
  await expect(alternadorGerador).toBeVisible();
  const geradorAntes = await alternadorGerador.getAttribute('aria-pressed');
  await alternadorGerador.click();
  await confirmarSenhaAtualQuandoSolicitada(page);
  await expect(alternadorGerador).toHaveAttribute(
    'aria-pressed',
    geradorAntes === 'true' ? 'false' : 'true'
  );

  const alternadorIa = page.getByRole('button', {
    name: 'IA nunca repete o mesmo prêmio'
  });
  await expect(alternadorIa).toBeVisible();
  const iaAntes = await alternadorIa.getAttribute('aria-pressed');
  await alternadorIa.click();
  await confirmarSenhaAtualQuandoSolicitada(page);
  await expect(alternadorIa).toHaveAttribute('aria-pressed', iaAntes === 'true' ? 'false' : 'true');

  await expect(page.locator('#section-dopamine')).toContainText('Dashboard Executivo');
  await expect(page.locator('#dopamine-dashboard')).toContainText('Totais');

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

import { expect, test } from '@playwright/test';
import { entrarComoAdministrador, observarIntegridadeDaPagina } from './support/session.js';

const SENHA_USUARIO_QA = 'KairoPlano!2026';
const CONTAS = Object.freeze([
  { nome: 'Usuário Free QA', email: 'qa-free@kairo.local', plano: 'free' },
  { nome: 'Usuário Plus QA', email: 'qa-plus@kairo.local', plano: 'plus' },
  { nome: 'Usuário Pro QA', email: 'qa-pro@kairo.local', plano: 'pro' }
]);
const MENUS_ADMIN = Object.freeze([
  '#nav-settings',
  '#nav-users',
  '#nav-plans',
  '#nav-dopamine',
  '#nav-ai',
  '#nav-smart'
]);

test.setTimeout(120_000);

async function csrf(page) {
  const response = await page.request.get('/api/auth/csrf');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).csrfToken;
}

async function mutacao(page, method, path, data) {
  return page.request.fetch(path, {
    method,
    data,
    headers: { 'X-CSRF-Token': await csrf(page) }
  });
}

async function sair(page) {
  const response = await mutacao(page, 'POST', '/api/auth/logout');
  expect(response.status()).toBe(204);
  await page.goto('/login');
}

async function entrarComoUsuario(page, conta) {
  await page.goto('/login');
  const formulario = page.locator('#form-login');
  await expect(formulario).toBeVisible();
  await formulario.locator('#login-email').fill(conta.email);
  await formulario.locator('#login-password').fill(SENHA_USUARIO_QA);
  await formulario.locator('#btn-login').click();
  await page.waitForURL('**/app');
  await expect(page.locator('#profile-role-badge')).toContainText(`Usuário · ${conta.plano}`, {
    ignoreCase: true
  });
}

async function criarContas(page) {
  for (const conta of CONTAS) {
    const response = await mutacao(page, 'POST', '/api/users', {
      name: conta.nome,
      email: conta.email,
      password: SENHA_USUARIO_QA,
      role: 'usuario',
      plan: conta.plano
    });
    expect(response.status(), `criação da conta ${conta.plano}`).toBe(201);
  }
}

async function matriz(page) {
  const response = await page.request.get('/api/plans');
  expect(response.ok()).toBeTruthy();
  return (await response.json()).matrix;
}

async function esperarInicializacao(page) {
  await expect(page.getByRole('button', { name: 'Dashboard' })).toBeVisible();
  await expect(page.locator('#profile-role-badge')).not.toHaveText('');
}

async function validarAcessoDireto(page, plano, recursos, administrador = false) {
  const casos = [
    ['/api/agenda', administrador || recursos.agenda],
    ['/api/charts', administrador || recursos.reports],
    ['/api/google/status', administrador || recursos.google_calendar],
    ['/api/ai/assistant/status', administrador || recursos.ai_assistant]
  ];
  for (const [rota, permitido] of casos) {
    const response = await page.request.get(rota);
    if (permitido) {
      expect(response.status(), `${plano}: ${rota} deveria estar liberada`).toBe(200);
    } else {
      expect(response.status(), `${plano}: ${rota} deveria estar bloqueada`).toBe(403);
      expect((await response.json()).error.code).toBe('FUNCIONALIDADE_NAO_INCLUIDA');
    }
  }

  const usuarios = await page.request.get('/api/users');
  expect(usuarios.status()).toBe(administrador ? 200 : 403);
}

async function validarInterfaceDoPlano(page, conta, recursos) {
  for (const seletor of MENUS_ADMIN) await expect(page.locator(seletor)).toBeHidden();

  await expect(page.locator('#nav-agenda')).toBeVisible({ visible: Boolean(recursos.agenda) });
  await expect(page.locator('#nav-reports')).toBeVisible({ visible: Boolean(recursos.reports) });
  await expect(page.locator('#assistant-fab')).toBeVisible({
    visible: Boolean(recursos.ai_assistant)
  });

  if (recursos.agenda) {
    await page.locator('#nav-agenda').click();
    await expect(page.locator('#section-agenda')).toBeVisible();
    await expect(page.locator('#google-agenda-bar')).toBeVisible({
      visible: Boolean(recursos.google_calendar)
    });
    await page.waitForLoadState('networkidle');
  }
  if (recursos.reports) {
    await page.locator('#nav-reports').click();
    await expect(page.locator('#section-reports')).toBeVisible();
    await expect
      .poll(() => page.locator('#timeseries-chart').locator(':scope > *').count())
      .toBeGreaterThan(0);
    await expect
      .poll(() => page.locator('#charts-grid').locator(':scope > *').count())
      .toBeGreaterThan(0);
  }

  // Tentativa direta de abrir uma seção administrativa deve permanecer no dashboard.
  await page.goto('/app?secao=settings');
  await esperarInicializacao(page);
  await expect(page.locator('#section-dashboard')).toBeVisible();
  await expect(page.locator('#section-settings')).toBeHidden();

  await validarAcessoDireto(page, conta.plano, recursos);
}

test('37.1–37.4 — matriz navegável por plano, admin integral e bloqueio direto na API', async ({
  page
}) => {
  const integridade = observarIntegridadeDaPagina(page);

  await entrarComoAdministrador(page);
  await esperarInicializacao(page);
  await expect(page.locator('#profile-role-badge')).toContainText('Administrador · Pro');
  for (const seletor of MENUS_ADMIN) await expect(page.locator(seletor)).toBeVisible();

  await page.goto('/app?secao=ai');
  await esperarInicializacao(page);
  await expect(page.locator('#section-ai')).toBeVisible();
  await validarAcessoDireto(page, 'administrador', {}, true);
  await criarContas(page);

  const matrizAtual = await matriz(page);
  for (const conta of CONTAS) {
    await sair(page);
    await entrarComoUsuario(page, conta);
    await esperarInicializacao(page);
    await validarInterfaceDoPlano(page, conta, matrizAtual[conta.plano]);
  }

  // A matriz persiste e passa a valer no próximo carregamento, sem deploy.
  await sair(page);
  await entrarComoAdministrador(page);
  let response = await mutacao(page, 'POST', '/api/plans/toggle', {
    plan_key: 'free',
    feature_key: 'reports',
    enabled: false
  });
  expect(response.status()).toBe(200);

  await sair(page);
  await entrarComoUsuario(page, CONTAS[0]);
  await esperarInicializacao(page);
  await expect(page.locator('#nav-reports')).toBeHidden();
  response = await page.request.get('/api/charts');
  expect(response.status()).toBe(403);
  expect((await response.json()).error.code).toBe('FUNCIONALIDADE_NAO_INCLUIDA');

  // Restaura o estado padrão para que o cenário seja autossuficiente.
  await sair(page);
  await entrarComoAdministrador(page);
  response = await mutacao(page, 'POST', '/api/plans/toggle', {
    plan_key: 'free',
    feature_key: 'reports',
    enabled: true
  });
  expect(response.status()).toBe(200);

  await expect(integridade.exigirPaginaIntegra()).resolves.toEqual({
    falhasRede: [],
    respostasHttp: [],
    errosConsole: []
  });
});

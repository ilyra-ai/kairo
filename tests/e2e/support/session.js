import { expect } from '@playwright/test';
import { ADMIN_QA } from './credentials.js';

export { ADMIN_QA } from './credentials.js';

export async function entrarComoAdministrador(page) {
  await page.goto('/login');

  const formularioRegistro = page.locator('#form-register');
  const formularioLogin = page.locator('#form-login');
  await page.waitForFunction(() => {
    const registro = document.getElementById('form-register');
    const login = document.getElementById('form-login');
    return Boolean(
      (registro && !registro.classList.contains('hidden')) ||
      (login && !login.classList.contains('hidden'))
    );
  });

  if (await formularioRegistro.isVisible()) {
    await page.locator('#reg-name').fill(ADMIN_QA.nome);
    await page.locator('#reg-email').fill(ADMIN_QA.email);
    await page.locator('#reg-password').fill(ADMIN_QA.senha);
    await page.getByRole('button', { name: 'Criar conta grátis' }).click();
  } else {
    await formularioLogin.locator('#login-email').fill(ADMIN_QA.email);
    await formularioLogin.locator('#login-password').fill(ADMIN_QA.senha);
    await formularioLogin.locator('#btn-login').click();
  }

  await page.waitForURL('**/app');
  await page.getByRole('button', { name: /Dashboard/ }).waitFor({ state: 'visible' });
}

export async function confirmarSenhaAtualQuandoSolicitada(page) {
  const dialogoSenha = page
    .locator('.app-dialog-overlay')
    .filter({ hasText: 'Confirmar sua senha' });
  try {
    await dialogoSenha.waitFor({ state: 'visible', timeout: 3000 });
  } catch {
    return;
  }
  await dialogoSenha.getByLabel('Senha atual').fill(ADMIN_QA.senha);
  await dialogoSenha.getByRole('button', { name: 'Confirmar' }).click();
  await expect(dialogoSenha).not.toBeVisible();
}

export function observarIntegridadeDaPagina(page, options = {}) {
  const ignorarBloqueiosTipograficosIntencionais =
    options.ignorarBloqueiosTipograficosIntencionais === true;
  const errosConsole = [];
  const errosConsole403PossivelmenteEsperados = [];
  const falhasRede = [];
  const respostasHttpInvalidas = [];
  const respostasPendentes = [];
  let desafiosReautenticacaoEsperados = 0;

  page.on('console', (message) => {
    const texto = message.text();
    const bloqueioTipograficoIntencional =
      ignorarBloqueiosTipograficosIntencionais &&
      texto.startsWith('Failed to load resource: net::ERR_BLOCKED_BY_CLIENT');
    const erroDeSondagemSemSessao =
      texto.includes('Failed to load resource') && texto.includes('401');
    const desafioReautenticacaoEsperado =
      texto.includes('Failed to load resource') && texto.includes('403');
    if (message.type() === 'error' && desafioReautenticacaoEsperado) {
      errosConsole403PossivelmenteEsperados.push(texto);
      return;
    }
    if (message.type() === 'error' && bloqueioTipograficoIntencional) return;
    if (message.type() === 'error' && !erroDeSondagemSemSessao) {
      errosConsole.push(texto);
    }
  });

  page.on('requestfailed', (request) => {
    falhasRede.push(
      `${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'falha'}`
    );
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    respostasPendentes.push(
      (async () => {
        const sondagemSemSessaoEsperada = status === 401 && url.endsWith('/api/auth/me');
        if (sondagemSemSessaoEsperada || status < 400) return;

        if (status === 403) {
          const payload = await response.json().catch(() => null);
          if (payload?.error?.code === 'REAUTENTICACAO_NECESSARIA') {
            desafiosReautenticacaoEsperados += 1;
            return;
          }
        }

        respostasHttpInvalidas.push(`${status} ${url}`);
      })()
    );
  });

  return {
    async exigirPaginaIntegra() {
      await Promise.all(respostasPendentes);
      const falhasInesperadas = falhasRede.filter((falha) => {
        const falhaDeFonteExterna =
          falha.includes('fonts.gstatic.com') || falha.includes('fonts.googleapis.com');
        const cancelamentoDeNavegacao = falha.includes('net::ERR_ABORTED');
        return !falhaDeFonteExterna && !cancelamentoDeNavegacao;
      });

      const errosConsole403Inesperados =
        respostasHttpInvalidas.length === 0 && desafiosReautenticacaoEsperados > 0
          ? []
          : errosConsole403PossivelmenteEsperados;

      return {
        falhasRede: falhasInesperadas,
        respostasHttp: respostasHttpInvalidas,
        errosConsole: [...errosConsole, ...errosConsole403Inesperados]
      };
    }
  };
}

export async function medirOverflowHorizontal(page) {
  return page.evaluate(() => {
    const larguraViewport = window.innerWidth;

    const elementosMensuraveis = Array.from(document.body.querySelectorAll('*'))
      .filter((elemento) => {
        const estilo = getComputedStyle(elemento);
        const elementoOculto = estilo.display === 'none' || estilo.visibility === 'hidden';
        const dentroDeScrollHorizontal = elemento.closest('.table-responsive, .admin-table-scroll');
        const dentroDeCamadaForaDoFluxo = Boolean(
          elemento.closest('.top-sidebar, .sidebar-nav, .mobile-overlay, .modal-overlay')
        );
        return !elementoOculto && !dentroDeScrollHorizontal && !dentroDeCamadaForaDoFluxo;
      })
      .map((elemento) => {
        const caixa = elemento.getBoundingClientRect();
        return {
          tag: elemento.tagName.toLowerCase(),
          id: elemento.id,
          classe: String(elemento.className || ''),
          direita: Math.round(caixa.right),
          esquerda: Math.round(caixa.left),
          largura: Math.round(caixa.width)
        };
      });

    const larguraDocumento = Math.max(
      larguraViewport,
      ...elementosMensuraveis.map((item) => item.direita)
    );

    const elementosComOverflow = elementosMensuraveis
      .filter((item) => item.direita > larguraViewport + 2 || item.esquerda < -2)
      .slice(0, 10);

    return {
      larguraViewport,
      larguraDocumento,
      elementosComOverflow
    };
  });
}

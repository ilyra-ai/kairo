export const ADMIN_QA = {
  nome: 'Administrador QA',
  email: 'qa-admin@kairo.local',
  senha: 'KairoQA!2026Segura'
};

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

export function observarIntegridadeDaPagina(page) {
  const errosConsole = [];
  const falhasRede = [];
  const respostasHttpInvalidas = [];

  page.on('console', (message) => {
    const texto = message.text();
    const erroDeSondagemSemSessao =
      texto.includes('Failed to load resource') && texto.includes('401');
    if (message.type() === 'error' && !erroDeSondagemSemSessao) errosConsole.push(texto);
  });

  page.on('requestfailed', (request) => {
    falhasRede.push(
      `${request.method()} ${request.url()} :: ${request.failure()?.errorText || 'falha'}`
    );
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    const sondagemSemSessaoEsperada = status === 401 && url.endsWith('/api/auth/me');
    if (status >= 400 && !sondagemSemSessaoEsperada)
      respostasHttpInvalidas.push(`${status} ${url}`);
  });

  return {
    async exigirPaginaIntegra() {
      const falhasInesperadas = falhasRede.filter((falha) => {
        const falhaDeFonteExterna =
          falha.includes('fonts.gstatic.com') || falha.includes('fonts.googleapis.com');
        const cancelamentoDeNavegacao = falha.includes('net::ERR_ABORTED');
        return !falhaDeFonteExterna && !cancelamentoDeNavegacao;
      });

      return {
        falhasRede: falhasInesperadas,
        respostasHttp: respostasHttpInvalidas,
        errosConsole
      };
    }
  };
}

export async function medirOverflowHorizontal(page) {
  return page.evaluate(() => {
    const larguraViewport = window.innerWidth;

    const elementosMensuraveis = Array.from(document.body.querySelectorAll('*'))
      .filter((elemento) => {
        const dentroDeScrollHorizontal = elemento.closest('.table-responsive, .admin-table-scroll');
        const dentroDeCamadaForaDoFluxo = Boolean(
          elemento.closest('.top-sidebar, .sidebar-nav, .mobile-overlay, .modal-overlay')
        );
        return !dentroDeScrollHorizontal && !dentroDeCamadaForaDoFluxo;
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

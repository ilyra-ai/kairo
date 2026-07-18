import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '../..');
const publicDirectory = join(projectRoot, 'public');
const scriptsDirectory = join(publicDirectory, 'assets', 'js');

const readProjectFile = (...segments) => readFileSync(join(projectRoot, ...segments), 'utf8');
const appScript = readProjectFile('public', 'assets', 'js', 'app.js');
const appStyles = readProjectFile('public', 'assets', 'css', 'app.css');
const typographyStyles = readProjectFile('public', 'assets', 'css', 'typography.css');
const appHtml = readProjectFile('public', 'app', 'index.html');
const httpSecuritySource = readProjectFile('src', 'server', 'middleware', 'http-security.js');
const htmlFiles = [
  ['landing', readProjectFile('public', 'index.html')],
  ['autenticação', readProjectFile('public', 'auth', 'index.html')],
  ['aplicativo', appHtml]
];

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Marcador inicial ausente: ${startMarker}`);
  assert.notEqual(end, -1, `Marcador final ausente: ${endMarker}`);
  return source.slice(start, end);
}

test('scripts próprios não usam injeção HTML nem diálogos nativos', () => {
  const scriptFiles = readdirSync(scriptsDirectory)
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => [fileName, readFileSync(join(scriptsDirectory, fileName), 'utf8')]);

  for (const [fileName, source] of scriptFiles) {
    assert.doesNotMatch(
      source,
      /\b(?:innerHTML|outerHTML|insertAdjacentHTML)\b/,
      `${fileName} reintroduziu uma API de injeção HTML`
    );
    assert.doesNotMatch(
      source,
      /(?:\bwindow\s*\.\s*)?\b(?:alert|confirm|prompt)\s*\(/,
      `${fileName} reintroduziu um diálogo nativo bloqueante`
    );
  }
});

test('HTML próprio é compatível com CSP sem scripts, estilos ou eventos embutidos', () => {
  for (const [pageName, source] of htmlFiles) {
    assert.doesNotMatch(source, /\sstyle\s*=/i, `${pageName} contém atributo style`);
    assert.doesNotMatch(
      source,
      /\son[a-z]+\s*=/i,
      `${pageName} contém manipulador de evento embutido`
    );
    assert.doesNotMatch(source, /<style\b/i, `${pageName} contém bloco style embutido`);
    assert.doesNotMatch(
      source,
      /<script\b(?![^>]*\bsrc\s*=)[^>]*>/i,
      `${pageName} contém script embutido`
    );
    assert.doesNotMatch(
      source,
      /(?:href|src)\s*=\s*["']javascript:/i,
      `${pageName} contém URL javascript`
    );
  }
});

test('todas as páginas aplicam CSP de scripts estrita e carregam Imprima', () => {
  const linksTipograficos = [
    '<link rel="preconnect" href="https://fonts.googleapis.com">',
    '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Imprima&display=swap">',
    '<link rel="stylesheet" href="/assets/css/typography.css">'
  ];

  for (const [pageName, source] of htmlFiles) {
    assert.match(source, /http-equiv="Content-Security-Policy"/i, `${pageName} não aplica CSP`);
    assert.match(source, /script-src 'self'/, `${pageName} não restringe scripts à origem do app`);
    assert.doesNotMatch(
      source,
      /script-src[^;]*'unsafe-inline'/,
      `${pageName} permite script embutido`
    );
    assert.match(source, /style-src-attr 'none'/, `${pageName} permite atributo style`);
    assert.doesNotMatch(
      source,
      /style-src-attr[^;]*'unsafe-inline'/,
      `${pageName} permite estilo embutido por atributo`
    );
    const posicoes = linksTipograficos.map((link) => source.indexOf(link));
    for (const [indice, link] of linksTipograficos.entries()) {
      assert.equal(
        source.split(link).length - 1,
        1,
        `${pageName} deve conter exatamente uma ocorrência de ${link}`
      );
      if (indice > 0) {
        assert.ok(
          posicoes[indice - 1] < posicoes[indice],
          `${pageName} carrega os recursos tipográficos fora da ordem obrigatória`
        );
      }
    }
  }

  const stylesheetsAtivos = [
    ['aplicativo', appStyles],
    ['autenticação', readProjectFile('public', 'assets', 'css', 'auth.css')],
    ['landing page', readProjectFile('public', 'assets', 'css', 'marketing.css')]
  ];
  for (const [nome, stylesheet] of stylesheetsAtivos) {
    assert.match(stylesheet, /['"]Imprima['"]\s*,\s*sans-serif/);
    assert.doesNotMatch(
      stylesheet,
      /font-weight\s*:\s*(?!400\b)(?:[1-9]00|bold(?:er)?|lighter)\b/i,
      `${nome} solicita peso não carregado da Imprima`
    );
    assert.doesNotMatch(
      stylesheet,
      /font-family\s*:[^;]*(?:Rubik|Inter|Roboto|Poppins|Montserrat|Arial|Segoe UI|system-ui)/i,
      `${nome} reintroduziu uma família tipográfica substituída`
    );
  }

  assert.match(typographyStyles, /font-synthesis:\s*none/);
  assert.match(
    typographyStyles,
    /\.imprima-regular\s*\{\s*font-family:\s*"Imprima",\s*sans-serif;\s*font-weight:\s*400;\s*font-style:\s*normal;\s*\}/s
  );
});

test('CSP HTTP bloqueia scripts embutidos e limita as origens tipográficas', () => {
  assert.match(httpSecuritySource, /scriptSrc:\s*\["'self'"\]/);
  assert.match(httpSecuritySource, /scriptSrcAttr:\s*\["'none'"\]/);
  assert.match(httpSecuritySource, /styleSrcAttr:\s*\["'none'"\]/);
  assert.doesNotMatch(httpSecuritySource, /scriptSrc:[^\n]*unsafe-inline/);
  assert.doesNotMatch(httpSecuritySource, /styleSrcAttr:[^\n]*unsafe-inline/);
  assert.match(
    httpSecuritySource,
    /styleSrc:\s*\["'self'",\s*'https:\/\/fonts\.googleapis\.com'\]/
  );
  assert.match(httpSecuritySource, /fontSrc:\s*\["'self'",\s*'https:\/\/fonts\.gstatic\.com'\]/);
});

test('controles críticos possuem nomes acessíveis específicos', () => {
  for (const controlId of [
    'settings-theme',
    'settings-confetti',
    'settings-sound',
    'pref-theme',
    'pref-confetti',
    'focus-sound-select'
  ]) {
    assert.match(
      appHtml,
      new RegExp(`<label[^>]+for="${controlId}"`),
      `${controlId} não possui label associado`
    );
  }

  const agendaSource = sourceBetween(
    appScript,
    'function openAgendaModal',
    'async function saveAgendaModal'
  );
  const plansSource = sourceBetween(
    appScript,
    'async function renderPlansAdmin',
    'function initPlansAdmin'
  );
  const usersSource = sourceBetween(
    appScript,
    'function createUserSelect',
    'function initUsersAdmin'
  );

  assert.match(agendaSource, /saveButton\.textContent\s*=\s*"Agendar"/);
  assert.match(agendaSource, /saveButton\.textContent\s*=\s*"Salvar alterações"/);
  assert.match(plansSource, /ariaLabel:\s*label/);
  assert.match(
    plansSource,
    /planFeatureToggleLabel\(btn\.dataset\.featureLabel,\s*btn\.dataset\.planLabel,\s*enabled\)/
  );
  assert.match(plansSource, /ariaLabel:\s*`Excluir plano \$\{planLabel\}`/);
  assert.match(plansSource, /ariaLabel:\s*`Excluir funcionalidade \$\{featureLabel\}`/);
  assert.match(usersSource, /attributes:\s*\{\s*"aria-label":\s*ariaLabel\s*\}/);
  assert.match(usersSource, /`Perfil de acesso de \$\{u\.name\}`/);
  assert.match(usersSource, /`Plano comercial de \$\{u\.name\}`/);
  assert.match(usersSource, /"aria-label":\s*`Excluir usuário \$\{u\.name\}`/);
});

test('preferências usam a rota dedicada e o perfil envia somente dados cadastrais', () => {
  const preferencesSource = sourceBetween(
    appScript,
    'async function saveProfilePreferences',
    'let activeDialogCleanup'
  );
  const profileSource = sourceBetween(
    appScript,
    'async function saveProfileModal',
    'async function savePreferencesModal'
  );

  assert.match(preferencesSource, /apiFetch\("\/api\/profile\/preferences"/);
  assert.match(profileSource, /apiFetch\("\/api\/profile"/);
  assert.match(profileSource, /const payload\s*=\s*\{\s*username,\s*email,\s*avatar:/s);
  assert.doesNotMatch(profileSource, /\b(?:theme|focus_sound|enable_confetti)\b/);
});

test('horas e metas preservam valores decimais', () => {
  const hoursSource = sourceBetween(
    appScript,
    'async function saveEditModal',
    '// MODAIS CARD — DEFINIÇÃO DE META'
  );
  const goalsSource = sourceBetween(
    appScript,
    'async function saveGoalModal',
    '// MODAIS CARD — VER DETALHES'
  );

  assert.match(hoursSource, /Number\(currentValue\)/);
  assert.match(hoursSource, /Number\(previousValue\)/);
  assert.doesNotMatch(hoursSource, /parseInt\s*\(/);
  assert.match(goalsSource, /Number\(targetValue\)/);
  assert.match(goalsSource, /target_hours:\s*targetHours/);
  assert.doesNotMatch(goalsSource, /parseInt\s*\(/);
  assert.match(appHtml, /id="edit-current"[^>]*step="0\.25"/);
  assert.match(appHtml, /id="edit-previous"[^>]*step="0\.25"/);
  assert.match(appHtml, /id="goal-target"[^>]*step="0\.25"/);
});

test('reautenticação e CRUD administrativo usam diálogo acessível e funcional', () => {
  const dialogSource = sourceBetween(
    appScript,
    'function showAppDialog',
    '// Correção do Bug de QA: populateCategorySelect'
  );
  const reauthenticationSource = sourceBetween(
    appScript,
    'async function confirmRecentAuthentication',
    'async function apiFetch'
  );

  assert.match(dialogSource, /role:\s*"dialog"/);
  assert.match(dialogSource, /"aria-modal":\s*"true"/);
  assert.match(dialogSource, /"aria-labelledby":\s*titleId/);
  assert.match(dialogSource, /event\.key\s*===\s*"Tab"/);
  assert.match(dialogSource, /event\.key\s*===\s*"Escape"/);
  assert.match(dialogSource, /form\.append\(actions\)/);
  assert.match(dialogSource, /attributes:\s*\{\s*type:\s*"submit"\s*\}/s);
  assert.match(reauthenticationSource, /showAppDialog\(/);
  assert.ok(
    (appScript.match(/showAppDialog\(/g) || []).length >= 7,
    'CRUD administrativo não está coberto pelo diálogo seguro'
  );
  assert.match(appStyles, /\.app-dialog\b/);
  assert.match(appStyles, /\.app-dialog-open\b/);
});

test('ondas binaurais são liberadas pela matriz real do plano', () => {
  const capabilitySource = sourceBetween(
    appScript,
    'function canUseBinauralSound',
    'async function saveProfilePreferences'
  );
  const soundSource = sourceBetween(
    appScript,
    'function startFocusSound',
    'function stopFocusSound'
  );
  const userCreationSource = sourceBetween(
    appScript,
    'function initUsersAdmin',
    '// INTEGRAÇÃO GOOGLE CALENDAR'
  );

  assert.match(capabilitySource, /apiFetch\("\/api\/plans"\)/);
  assert.match(capabilitySource, /payload\.matrix\[currentUser\.plan\]/);
  assert.match(capabilitySource, /planFeatures\?\.\[FEATURE_BINAURAL\]/);
  assert.match(soundSource, /type\s*===\s*FEATURE_BINAURAL\s*&&\s*!canUseBinauralSound\(\)/);
  assert.doesNotMatch(capabilitySource, /currentUser\.plan\s*===\s*["'`](?:free|plus|pro)["'`]/);
  assert.match(userCreationSource, /apiFetch\("\/api\/plans"\)/);
  assert.doesNotMatch(userCreationSource, /value:\s*["']free["']/);
});

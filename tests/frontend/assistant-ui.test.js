import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(testDirectory, '../..');
const readProjectFile = (...segments) => readFileSync(join(projectRoot, ...segments), 'utf8');
const appScript = readProjectFile('public', 'assets', 'js', 'app.js');
const appStyles = readProjectFile('public', 'assets', 'css', 'app.css');
const appHtml = readProjectFile('public', 'app', 'index.html');

test('chat expõe estado acessível, histórico, privacidade e cancelamento do streaming', () => {
  assert.match(
    appHtml,
    /id="assistant-fab"[^>]+aria-expanded="false"[^>]+aria-controls="assistant-panel"/
  );
  assert.match(appHtml, /id="assistant-panel"[^>]+aria-busy="false"/);
  assert.match(appHtml, /id="assistant-messages"[^>]+role="log"/);
  assert.match(appHtml, /id="assistant-connection"[^>]+role="status"/);
  assert.match(appHtml, /id="assistant-remote-consent"/);
  assert.match(appHtml, /id="assistant-stop"/);
  assert.match(appHtml, /id="assistant-clear"/);

  assert.match(appScript, /apiFetch\(`\$\{ASSISTENTE_BASE\}\/status`\)/);
  assert.match(appScript, /apiFetch\(`\$\{ASSISTENTE_BASE\}\/history`\)/);
  assert.match(appScript, /method:\s*"DELETE"/);
  assert.match(appScript, /apiFetch\(`\$\{ASSISTENTE_BASE\}\/chat\/stream`/);
  assert.match(appScript, /Accept:\s*"text\/event-stream"/);
  assert.match(appScript, /new AbortController\(\)/);
  assert.match(appScript, /assistenteEstado\.controlador\?\.abort\(\)/);
  assert.match(appScript, /remote_consent:\s*true/);
  assert.match(appScript, /event\.key\s*===\s*"Escape"/);
});

test('propostas usam identificador persistido e cancelamento server-side sem argumentos confiados ao cliente', () => {
  const start = appScript.indexOf('function renderPropostaAssistente');
  const end = appScript.indexOf('function campoAgendaDoCopiloto', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const source = appScript.slice(start, end);

  assert.match(source, /proposal_id/);
  assert.match(source, /confirm:\s*\{\s*proposal_id:\s*proposalId\s*\}/s);
  assert.match(source, /\/proposals\/\$\{encodeURIComponent\(proposalId\)\}/);
  assert.match(source, /\{ method:\s*"DELETE" \}/);
  assert.match(source, /confirm\.disabled\s*=\s*true/);
  assert.match(source, /cancel\.disabled\s*=\s*true/);
  assert.doesNotMatch(source, /proposta\.arguments/);
  assert.doesNotMatch(source, /confirm:\s*\{[^}]*tool:/s);
});

test('copiloto da agenda oferece as nove assistências e aplicação sempre explícita', () => {
  for (const kind of [
    'correcao',
    'clareza',
    'passos',
    'dicas',
    'microtarefas',
    'estimativa',
    'dependencias',
    'prioridade',
    'criterio'
  ]) {
    assert.match(appHtml, new RegExp(`<option value="${kind}">`));
  }

  for (const control of [
    'agenda-ai-trigger',
    'agenda-ai-kind',
    'agenda-ai-target',
    'agenda-ai-original',
    'agenda-ai-suggestion',
    'agenda-ai-apply',
    'agenda-ai-apply-partial',
    'agenda-ai-retry',
    'agenda-ai-discard'
  ]) {
    assert.match(appHtml, new RegExp(`id="${control}"`));
  }

  assert.match(appScript, /apiFetch\(`\$\{ASSISTENTE_BASE\}\/copilot`/);
  assert.match(appScript, /const targetField = campoAgendaDoCopiloto\(\)/);
  assert.match(appScript, /targetField\.value = value/);
  assert.match(appScript, /suggestion\.selectionStart/);
  assert.match(appScript, /suggestion\.selectionEnd/);
  assert.match(appScript, /O conteúdo original foi preservado/);
  assert.doesNotMatch(appScript, /agenda-ai-(?:apply|apply-partial)[^\n]*\.click\(\)/);
});

test('criação e edição de categoria também oferecem copiloto opcional sem sobrescrita automática', () => {
  assert.ok(appScript.includes('assistant: { fieldName: "title" }'));
  assert.match(appScript, /function appendDialogAiAssistant/);
  assert.ok(appScript.includes('text: "Ajudar com IA"'));
  assert.match(appScript, /Original preservado/);
  assert.match(appScript, /Aplicar parcialmente/);
  assert.match(appScript, /Tentar novamente/);
  assert.ok(appScript.includes('text: "Descartar"'));
  assert.match(appScript, /suggestion\.selectionStart/);
  assert.match(appScript, /target\.value = value/);
  assert.match(appScript, /canUseFeature\("ai_assistant"\)/);
});

test('assistente e copiloto respeitam mobile, área segura, foco e redução de movimento', () => {
  assert.match(appStyles, /env\(safe-area-inset-bottom\)/);
  assert.match(appStyles, /@media \(max-height: 540px\) and \(orientation: landscape\)/);
  assert.match(appStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.assistant-panel/);
  assert.match(appStyles, /\.assistant-fab:focus-visible/);
  assert.match(appStyles, /\.agenda-ai-field select:focus-visible/);
  assert.match(appStyles, /\.agenda-ai-comparison[\s\S]*?grid-template-columns/);
});

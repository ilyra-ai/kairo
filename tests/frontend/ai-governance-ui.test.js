import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const html = fs.readFileSync(path.join(ROOT, 'public/app/index.html'), 'utf8');
const script = fs.readFileSync(path.join(ROOT, 'public/assets/js/app.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT, 'public/assets/css/app.css'), 'utf8');

test('LLMOps expõe avaliação, aprovação, comparação, canary e scorecard reais', () => {
  for (const id of [
    'ai-tab-llmops',
    'ai-panel-llmops',
    'ai-llmops-artifact',
    'ai-llmops-versions',
    'ai-llmops-canaries',
    'ai-llmops-score-body'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const contract of [
    '/evaluate',
    '/approve',
    '/compare?left=',
    '/canary',
    '/training/canaries/',
    '/training/scorecards'
  ]) {
    assert.ok(script.includes(contract), `contrato LLMOps ausente: ${contract}`);
  }
  assert.match(script, /release_approved/);
  assert.match(script, /Amostra mínima/);
});

test('Centro de ferramentas e MCP governa risco, escopos, limites e decisões sem habilitação automática', () => {
  for (const id of [
    'ai-tab-tools',
    'ai-panel-tools',
    'ai-tool-policies-list',
    'ai-mcp-list',
    'ai-tool-audit-body'
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const risk of ['somente_leitura', 'mutavel', 'destrutiva', 'externa']) {
    assert.ok(script.includes(risk), `classe de risco ausente: ${risk}`);
  }
  assert.ok(script.includes('/tool-policies/'));
  assert.ok(script.includes('/mcp/servers'));
  assert.match(script, /Tokens literais não são aceitos/);
  assert.match(script, /mantém o servidor desativado/);
});

test('governança administrativa preserva responsividade mobile e redução de movimento global', () => {
  assert.match(styles, /\.ai-governance-item/);
  assert.match(styles, /\.ai-tabs[\s\S]*overflow-x:\s*auto/);
  assert.match(styles, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
});

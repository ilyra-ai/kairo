import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const html = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'public', 'assets', 'css', 'marketing.css'), 'utf8');
const script = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'landing.js'), 'utf8');
const authScript = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'auth.js'), 'utf8');
const appScript = fs.readFileSync(path.join(root, 'public', 'assets', 'js', 'app.js'), 'utf8');

test('landing possui arquitetura completa, SEO local coerente e nenhum link simbólico', () => {
  for (const section of [
    'inicio',
    'produto',
    'recursos',
    'como-funciona',
    'planos',
    'privacidade',
    'faq'
  ]) {
    assert.match(html, new RegExp(`id="${section}"`));
  }
  assert.doesNotMatch(html, /href="#"(?:\s|>)/);
  assert.match(html, /<link rel="canonical" href="\/"/);
  assert.match(html, /property="og:image" content="\/assets\/images\/favicon-kairo-256\.png"/);
  assert.match(html, /<main id="conteudo">/);
  assert.match(html, /class="skip-link" href="#conteudo"/);
  assert.doesNotMatch(html, /<script(?![^>]*src=)/);
  assert.doesNotMatch(html, /\son[a-z]+=/i);
});

test('menu móvel implementa estado acessível, Escape, foco preso e restauração de foco', () => {
  assert.match(
    html,
    /id="menu-trigger"[\s\S]*aria-expanded="false"[\s\S]*aria-controls="mobile-menu"/
  );
  assert.match(html, /id="mobile-menu"[\s\S]*hidden/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /event\.key !== 'Tab'/);
  assert.match(script, /state\.menuReturnFocus\?\.focus\(\)/);
  assert.match(script, /menuTrigger\.setAttribute\('aria-expanded', 'true'\)/);
});

test('CTAs tratam visitante, sessão ativa, cadastro e intenção de plano de ponta a ponta', () => {
  assert.match(html, /href="\/login\?modo=cadastro" data-auth-cta/);
  assert.match(script, /fetch\('\/api\/auth\/me'/);
  assert.match(script, /state\.authenticated \? '\/app' : '\/login'/);
  assert.match(script, /destino=planos&plano=/);
  assert.match(authScript, /authQuery\.get\("modo"\) === "cadastro"/);
  assert.match(authScript, /return `\/app\?secao=myfeatures&plano=/);
  assert.match(appScript, /function openRequestedSection\(\)/);
  assert.match(appScript, /p\.key === planoPretendido \? " is-target"/);
});

test('planos e funcionalidades comerciais vêm do backend, sem preços codificados na landing', () => {
  assert.match(html, /id="plans-grid"/);
  assert.match(script, /fetch\('\/api\/public\/landing'/);
  assert.match(script, /plan\.price_label/);
  assert.match(script, /plan\.checkout_available/);
  assert.doesNotMatch(html, /R\$\s*(?:19|39)/);
  assert.doesNotMatch(html, /class="plan-card"/);
});

test('responsividade, alvos mínimos e redução de movimento estão definidos no CSS e no JS', () => {
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /@media \(max-width: 1060px\)/);
  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 390px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(script, /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/);
  assert.match(script, /reducedMotion\.matches \? 'auto' : 'smooth'/);
  assert.match(css, /scroll-padding-top:/);
  assert.match(css, /:focus-visible/);
});

const state = {
  authenticated: false,
  mobileMenuOpen: false,
  menuReturnFocus: null
};

const menuTrigger = document.getElementById('menu-trigger');
const mobileMenu = document.getElementById('mobile-menu');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function createElement(tag, options = {}) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attributes ?? {})) {
    element.setAttribute(name, String(value));
  }
  return element;
}

function closeMobileMenu({ restoreFocus = false } = {}) {
  if (!state.mobileMenuOpen) return;
  state.mobileMenuOpen = false;
  mobileMenu.hidden = true;
  menuTrigger.setAttribute('aria-expanded', 'false');
  menuTrigger.setAttribute('aria-label', 'Abrir menu');
  document.body.classList.remove('menu-open');
  if (restoreFocus) state.menuReturnFocus?.focus();
}

function openMobileMenu() {
  state.mobileMenuOpen = true;
  state.menuReturnFocus = document.activeElement;
  mobileMenu.hidden = false;
  menuTrigger.setAttribute('aria-expanded', 'true');
  menuTrigger.setAttribute('aria-label', 'Fechar menu');
  document.body.classList.add('menu-open');
  mobileMenu.querySelector('a')?.focus();
}

function focusableMenuItems() {
  return [...mobileMenu.querySelectorAll('a[href], button:not([disabled])')].filter(
    (element) => !element.hidden
  );
}

function handleMenuKeyboard(event) {
  if (!state.mobileMenuOpen) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMobileMenu({ restoreFocus: true });
    return;
  }
  if (event.key !== 'Tab') return;
  const items = focusableMenuItems();
  if (items.length === 0) return;
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function focusSection(target) {
  if (!target) return;
  const previousTabIndex = target.getAttribute('tabindex');
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  target.addEventListener(
    'blur',
    () => {
      if (previousTabIndex === null) target.removeAttribute('tabindex');
      else target.setAttribute('tabindex', previousTabIndex);
    },
    { once: true }
  );
}

function navigateToSection(event) {
  const id = event.currentTarget.dataset.scrollTarget;
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  closeMobileMenu();
  target.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'start' });
  window.history.replaceState({}, '', `#${id}`);
  window.setTimeout(() => focusSection(target), reducedMotion.matches ? 0 : 350);
}

function intendedPlanUrl(planKey) {
  const params = new URLSearchParams({ secao: 'myfeatures', plano: planKey });
  return state.authenticated
    ? `/app?${params}`
    : `/login?modo=cadastro&destino=planos&plano=${encodeURIComponent(planKey)}`;
}

function updateAuthenticationActions() {
  document.querySelectorAll('[data-auth-link]').forEach((link) => {
    link.href = state.authenticated ? '/app' : '/login';
    link.textContent = state.authenticated ? 'Abrir meu Kairo' : link.dataset.authLabel;
  });
  document.querySelectorAll('[data-auth-cta]').forEach((link) => {
    link.href = state.authenticated ? '/app' : '/login?modo=cadastro';
    const arrow = link.querySelector('span[aria-hidden="true"]');
    link.firstChild.textContent = state.authenticated ? 'Ir para o dashboard ' : 'Começar gratuitamente ';
    if (arrow) arrow.textContent = '→';
  });
  const authState = document.getElementById('auth-state');
  if (state.authenticated && authState) {
    authState.textContent = 'Sua sessão está ativa · Continue diretamente no seu dashboard';
  }
}

async function loadAuthenticationState() {
  try {
    const response = await fetch('/api/auth/me', {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin'
    });
    state.authenticated = response.ok;
  } catch {
    state.authenticated = false;
  }
  updateAuthenticationActions();
}

function planCard(plan, maximumFeatureCount, checkout) {
  const card = createElement('article', {
    className: `plan-card${plan.features.length === maximumFeatureCount ? ' is-featured' : ''}`,
    attributes: { 'data-plan-key': plan.key }
  });
  const tag = createElement('span', {
    className: 'plan-tag',
    text: plan.price_cents === 0 ? 'Comece aqui' : `${plan.features.length} recursos incluídos`
  });
  const title = createElement('h3', { text: plan.name });
  const price = createElement('div', { className: 'plan-price', text: plan.price_label });
  if (plan.price_cents > 0) price.appendChild(createElement('small', { text: ' / mês' }));
  const description = createElement('p', { text: plan.description });
  const features = createElement('ul', { className: 'plan-features' });
  plan.features.forEach((feature) => features.appendChild(createElement('li', { text: feature.label })));
  const action = createElement('a', {
    className: plan.features.length === maximumFeatureCount ? 'button button-primary' : 'button button-secondary',
    text:
      plan.price_cents === 0
        ? state.authenticated
          ? 'Abrir meu plano'
          : 'Começar no Free'
        : state.authenticated
          ? `Ver ${plan.name} no app`
          : `Criar conta e ver ${plan.name}`,
    attributes: { href: intendedPlanUrl(plan.key), 'data-plan-action': plan.key }
  });
  const note = createElement('p', {
    className: 'plan-note',
    text:
      plan.price_cents === 0
        ? 'Nenhum checkout é necessário.'
        : plan.checkout_available
          ? 'Checkout seguro disponível após entrar.'
          : checkout.message
  });

  card.append(tag, title, price, description, features, action, note);
  return card;
}

async function loadPlans() {
  const status = document.getElementById('plans-status');
  const grid = document.getElementById('plans-grid');
  try {
    const response = await fetch('/api/public/landing', {
      headers: { Accept: 'application/json' }
    });
    const payload = await response.json();
    if (!response.ok || !Array.isArray(payload.plans)) {
      throw new Error(payload?.error?.message || 'Não foi possível consultar os planos configurados.');
    }
    grid.replaceChildren();
    const maximumFeatureCount = Math.max(...payload.plans.map((plan) => plan.features.length), 0);
    payload.plans.forEach((plan) => {
      grid.appendChild(planCard(plan, maximumFeatureCount, payload.checkout));
    });
    const count = Number(payload.smart_features_count) || 0;
    status.textContent = `${payload.plans.length} planos carregados da configuração atual${count > 0 ? ` · ${count} recursos inteligentes registrados` : ''}.`;
  } catch (error) {
    grid.replaceChildren();
    status.classList.add('is-error');
    status.textContent = `${error.message} Recarregue a página ou procure o administrador.`;
  }
}

function initializeReveals() {
  const reveals = document.querySelectorAll('.reveal');
  if (reducedMotion.matches || !('IntersectionObserver' in window)) {
    reveals.forEach((element) => element.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.12 }
  );
  reveals.forEach((element) => observer.observe(element));
}

function initializeLanding() {
  menuTrigger.addEventListener('click', () => {
    if (state.mobileMenuOpen) closeMobileMenu({ restoreFocus: true });
    else openMobileMenu();
  });
  document.addEventListener('keydown', handleMenuKeyboard);
  window.addEventListener('resize', () => {
    if (window.innerWidth > 1060) closeMobileMenu();
  });
  document
    .querySelectorAll('[data-scroll-target]')
    .forEach((link) => link.addEventListener('click', navigateToSection));
  document.getElementById('current-year').textContent = String(new Date().getFullYear());
  initializeReveals();
  loadAuthenticationState()
    .then(loadPlans)
    .catch(() => {});
}

initializeLanding();

// ============================================================
// CONFIGURAÇÃO E ESTADO GLOBAL
// ============================================================

// Mapeamento de títulos do banco → cores CSS dos cards
const CARD_COLORS = {
  Work: "orange",
  Play: "blue",
  Study: "red",
  Exercise: "green",
  Social: "purple",
  "Self Care": "yellow"
};

// Mapeamento de classes css para timeline por categoria
const TIMELINE_CLASSES = {
  Work: "work",
  Play: "play",
  Study: "study",
  Exercise: "exercise",
  Social: "social",
  "Self Care": "selfcare"
};

// Pictogramas Emojis grandes para o layout inclusivo TDAH/TEA
const CATEGORY_PICTOGRAMS = {
  Work: "💻",
  Play: "🎮",
  Study: "📚",
  Exercise: "🏃",
  Social: "👥",
  "Self Care": "💆"
};

// Tradução de títulos do banco → pt-BR
const TITLE_PT = {
  Work: "Trabalho",
  Play: "Lazer",
  Study: "Estudos",
  Exercise: "Exercícios",
  Social: "Social",
  "Self Care": "Autocuidado"
};

// Configurações de tradução por timeframe
const TIMEFRAMES_CONFIG = {
  daily: { label: "Ontem", name: "diário" },
  weekly: { label: "Última semana", name: "semanal" },
  monthly: { label: "Último mês", name: "mensal" }
};

// Estado global
let activitiesData = [];
let agendaEvents = [];
let activeTimeframe = "daily";
// Período independente da seção de Relatórios (Tarefa 20): o usuário escolhe
// diário/semanal/mensal sem afetar o filtro do Dashboard.
let reportsPeriod = "weekly";
const REPORTS_PERIOD_LABEL = { daily: "Diário", weekly: "Semanal", monthly: "Mensal" };
let activeSection = "dashboard";
let activeInlineActivityId = null;
let activeAgendaLayout = "atual"; // tdah, atual, google, ticktick, morgen, todoist, kanban
let userProfile = {
  username: "",
  email: "",
  avatar: null,
  theme: "escuro",
  focus_sound: "chuva",
  enable_confetti: true
};

let csrfToken = null;
let reauthenticationInProgress = null;
let planCapabilities = {
  loaded: false,
  binaural: false,
  features: {}
};

const ROLE_ADMIN = "administrador";
const FEATURE_BINAURAL = "binaural";

// Mapa seção do menu → funcionalidade da matriz de planos (fonte única no
// backend). Seções ausentes aqui não dependem de plano (ex.: dashboard sempre
// disponível; settings/users/plans/dopamine são exclusivas do administrador).
const SECTION_FEATURE = Object.freeze({
  agenda: "agenda",
  reports: "reports"
});

// Verdade única de autorização por recurso no cliente: o administrador tem
// acesso integral; os demais dependem da matriz liberada pelo administrador.
function canUseFeature(featureKey) {
  if (currentUser && currentUser.role === ROLE_ADMIN) return true;
  if (!planCapabilities.loaded) return false;
  return Boolean(planCapabilities.features?.[featureKey]);
}

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function apiErrorMessage(payload, fallback = "Não foi possível concluir a operação.") {
  if (typeof payload?.error?.message === "string" && payload.error.message.trim()) {
    return payload.error.message;
  }
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  if (typeof payload?.error === "string" && payload.error.trim()) {
    return payload.error;
  }
  return fallback;
}

async function responsePayload(response) {
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) return null;
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function redirectToLogin() {
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

async function loadCsrfToken() {
  const response = await window.fetch("/api/auth/csrf", {
    method: "GET",
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" }
  });

  if (response.status === 401) {
    redirectToLogin();
    throw new Error("Sua sessão expirou. Entre novamente para continuar.");
  }

  const payload = await responsePayload(response);
  if (!response.ok || typeof payload?.csrfToken !== "string" || !payload.csrfToken) {
    throw new Error(apiErrorMessage(payload, "Não foi possível validar a segurança da sessão."));
  }

  csrfToken = payload.csrfToken;
  return csrfToken;
}

async function confirmRecentAuthentication() {
  if (reauthenticationInProgress) return reauthenticationInProgress;

  reauthenticationInProgress = (async () => {
    const dialog = await showAppDialog({
      title: "Confirmar sua senha",
      description: "Para proteger seus dados, confirme sua senha para continuar.",
      confirmText: "Confirmar",
      fields: [
        {
          name: "password",
          label: "Senha atual",
          type: "password",
          autocomplete: "current-password",
          required: true
        }
      ]
    });
    if (!dialog.confirmed || !dialog.values.password) {
      throw new Error("Operação cancelada: a confirmação da senha é obrigatória.");
    }
    const password = dialog.values.password;

    const token = csrfToken || (await loadCsrfToken());
    const response = await window.fetch("/api/auth/reauthenticate", {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-CSRF-Token": token
      },
      body: JSON.stringify({ password })
    });
    const payload = await responsePayload(response);

    if (response.status === 401) {
      throw new Error(apiErrorMessage(payload, "A senha informada não confere."));
    }
    if (!response.ok) {
      throw new Error(apiErrorMessage(payload, "Não foi possível confirmar sua identidade."));
    }
  })();

  try {
    await reauthenticationInProgress;
  } finally {
    reauthenticationInProgress = null;
  }
}

async function apiFetch(resource, options = {}, retry = { csrf: true, recentAuth: true }) {
  const method = String(options.method || "GET").toUpperCase();
  const headers = new Headers(options.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  if (MUTATION_METHODS.has(method)) {
    headers.set("X-CSRF-Token", csrfToken || (await loadCsrfToken()));
  }

  const response = await window.fetch(resource, {
    ...options,
    method,
    headers,
    credentials: "same-origin",
    cache: "no-store"
  });

  if (response.status === 401) {
    redirectToLogin();
    return response;
  }

  if (response.status === 403) {
    const payload = await responsePayload(response.clone());
    const code = payload?.error?.code;

    if (code === "CSRF_INVALIDO" && retry.csrf) {
      csrfToken = null;
      await loadCsrfToken();
      return apiFetch(resource, options, { ...retry, csrf: false });
    }

    if (code === "REAUTENTICACAO_NECESSARIA" && retry.recentAuth) {
      await confirmRecentAuthentication();
      return apiFetch(resource, options, { ...retry, recentAuth: false });
    }
  }

  return response;
}

// ============================================================
// UTILIDADES
// ============================================================

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = { success: "✓", error: "✕", warning: "!" };
  const icon = document.createElement("div");
  icon.className = "toast-icon";
  icon.textContent = icons[type] || "i";
  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = String(message);
  toast.append(icon, text);

  container.appendChild(toast);

  // Animar entrada
  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add("show"));
  });

  // Remover após 3.5s
  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// Correção do Bug de QA: parseLocalDate definido de forma nativa e robusta
function parseLocalDate(dateStr) {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatDatePtBr(dateStr) {
  const [year, month, day] = dateStr.split("-");
  return `${day}/${month}/${year}`;
}

function getDayName(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  const days = [
    "Domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado"
  ];
  return days[date.getDay()];
}

function getWeekDays() {
  const today = new Date();
  const currentDayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - currentDayOfWeek);

  const days = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(startOfWeek);
    day.setDate(startOfWeek.getDate() + i);
    days.push(day.toISOString().split("T")[0]);
  }
  return days;
}

function clearElement(element) {
  if (element) element.replaceChildren();
}

function appendChildren(element, children = []) {
  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    if (child instanceof Node) {
      element.appendChild(child);
      return;
    }
    element.appendChild(document.createTextNode(String(child)));
  });
  return element;
}

function createElement(
  tagName,
  { className = "", text = null, attributes = {}, dataset = {}, children = [] } = {}
) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  Object.entries(attributes).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (value === true) {
      element.setAttribute(key, "");
      return;
    }
    element.setAttribute(key, String(value));
  });
  Object.entries(dataset).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      element.dataset[key] = String(value);
    }
  });
  if (text !== null && text !== undefined) {
    element.textContent = String(text);
  }
  appendChildren(element, children);
  return element;
}

function createSvgElement(tagName, attributes = {}, children = []) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  Object.entries(attributes).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      element.setAttribute(key, String(value));
    }
  });
  children.flat().forEach((child) => {
    if (child) element.appendChild(child);
  });
  return element;
}

function createIcon(type, { width = 16, height = 16, strokeWidth = 2, fill = "none" } = {}) {
  const svg = createSvgElement("svg", {
    width,
    height,
    viewBox: "0 0 24 24",
    fill,
    stroke: "currentColor",
    "stroke-width": strokeWidth
  });

  const draw = (...children) => appendChildren(svg, children);

  switch (type) {
    case "ellipsis":
      draw(
        createSvgElement("circle", { cx: 5, cy: 12, r: 1.5, fill: "currentColor", stroke: "none" })
      );
      draw(
        createSvgElement("circle", { cx: 12, cy: 12, r: 1.5, fill: "currentColor", stroke: "none" })
      );
      draw(
        createSvgElement("circle", { cx: 19, cy: 12, r: 1.5, fill: "currentColor", stroke: "none" })
      );
      break;
    case "edit":
      draw(
        createSvgElement("path", {
          d: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
        })
      );
      draw(
        createSvgElement("path", { d: "M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" })
      );
      break;
    case "goal":
      draw(createSvgElement("circle", { cx: 12, cy: 12, r: 10 }));
      draw(createSvgElement("circle", { cx: 12, cy: 12, r: 6 }));
      draw(createSvgElement("circle", { cx: 12, cy: 12, r: 2 }));
      break;
    case "details":
      draw(createSvgElement("line", { x1: 18, y1: 20, x2: 18, y2: 10 }));
      draw(createSvgElement("line", { x1: 12, y1: 20, x2: 12, y2: 4 }));
      draw(createSvgElement("line", { x1: 6, y1: 20, x2: 6, y2: 14 }));
      break;
    case "delete":
      draw(createSvgElement("polyline", { points: "3 6 5 6 21 6" }));
      draw(
        createSvgElement("path", {
          d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
        })
      );
      break;
    case "focus":
      draw(createSvgElement("circle", { cx: 12, cy: 13, r: 8 }));
      draw(createSvgElement("path", { d: "M12 9v4l2 2" }));
      draw(createSvgElement("path", { d: "M5 3 2 6" }));
      draw(createSvgElement("path", { d: "m22 6-3-3" }));
      break;
    case "play":
      svg.setAttribute("fill", "currentColor");
      svg.removeAttribute("stroke");
      draw(createSvgElement("polygon", { points: "5 3 19 12 5 21 5 3" }));
      break;
    case "pause":
      svg.setAttribute("fill", "currentColor");
      svg.removeAttribute("stroke");
      draw(createSvgElement("rect", { x: 6, y: 4, width: 4, height: 16 }));
      draw(createSvgElement("rect", { x: 14, y: 4, width: 4, height: 16 }));
      break;
    case "reset":
      draw(createSvgElement("polyline", { points: "1 4 1 10 7 10" }));
      draw(createSvgElement("path", { d: "M3.51 15a9 9 0 1 0 2.13-9.36L1 10" }));
      break;
    case "lock":
      draw(createSvgElement("rect", { x: 3, y: 11, width: 18, height: 11, rx: 2, ry: 2 }));
      draw(createSvgElement("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }));
      break;
    default:
      break;
  }

  return svg;
}

function createActionButton({
  className,
  title,
  ariaLabel,
  attributes = {},
  dataset = {},
  icon,
  text = null
}) {
  const button = createElement("button", {
    className,
    attributes: {
      ...attributes,
      type: "button",
      title,
      "aria-label": ariaLabel || title
    },
    dataset
  });
  if (icon) button.appendChild(icon);
  if (text) button.appendChild(document.createTextNode(text));
  return button;
}

function createStateMessage(message, { tone = "neutral", compact = false } = {}) {
  const wrapper = createElement("div", {
    className: `agenda-empty-state${compact ? " agenda-empty-state-compact" : ""}`
  });
  if (tone !== "neutral") {
    wrapper.dataset.tone = tone;
  }
  wrapper.appendChild(createElement("p", { text: message }));
  return wrapper;
}

function createLoadingTableRow(message, tone = "neutral", colspan = 1) {
  const row = document.createElement("tr");
  const cell = createElement("td", {
    className: `table-status-cell${tone !== "neutral" ? ` table-status-${tone}` : ""}`,
    text: message,
    attributes: { colspan }
  });
  row.appendChild(cell);
  return row;
}

const DYNAMIC_CSS_VALUE_PATTERN = /^[#\w\s().,%+-]+$/;
let dynamicStyleSheet = null;
let dynamicStyleCounter = 0;

function sanitizeDynamicCssValue(value) {
  const text = String(value ?? "").trim();
  if (
    !text ||
    text.length > 240 ||
    /[{};<>]/.test(text) ||
    /(?:url|expression|@import)/i.test(text) ||
    !DYNAMIC_CSS_VALUE_PATTERN.test(text)
  ) {
    return "";
  }
  return text;
}

function ensureDynamicStyleSheet() {
  if (dynamicStyleSheet) return dynamicStyleSheet;
  if ("adoptedStyleSheets" in document && "CSSStyleSheet" in window) {
    dynamicStyleSheet = new CSSStyleSheet();
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, dynamicStyleSheet];
    return dynamicStyleSheet;
  }
  dynamicStyleSheet = Array.from(document.styleSheets).find(
    (sheet) => sheet.href && sheet.href.includes("/assets/css/app.css")
  );
  return dynamicStyleSheet;
}

function applyDynamicStyles(element, styles) {
  if (!element) return;
  const declarations = Object.entries(styles)
    .map(([property, value]) => {
      const safeValue = sanitizeDynamicCssValue(value);
      return safeValue ? `${property}:${safeValue}` : "";
    })
    .filter(Boolean)
    .join(";");
  if (!declarations) return;
  const sheet = ensureDynamicStyleSheet();
  if (!sheet || typeof sheet.insertRule !== "function") return;
  const className = `kairo-dyn-${++dynamicStyleCounter}`;
  sheet.insertRule(`.${className}{${declarations}}`, sheet.cssRules.length);
  element.classList.add(className);
}

function createDurationBadge(text, eventColor = null) {
  const badge = createElement("span", {
    className: "event-duration-badge",
    text
  });
  if (eventColor) {
    badge.dataset.eventColor = eventColor;
    badge.classList.add("event-duration-badge-custom");
    applyDynamicStyles(badge, { background: eventColor, color: "#fff" });
  }
  return badge;
}

function setFocusButtonContent(button, label, iconType) {
  if (!button) return;
  clearElement(button);
  button.append(
    createIcon(iconType, { width: 16, height: 16, fill: "currentColor" }),
    document.createTextNode(` ${label}`)
  );
}

function createSwitchButton({
  className = "app-switch",
  on = false,
  variant = "success",
  dataset = {},
  title = "",
  ariaLabel = ""
} = {}) {
  const switchClasses = new Set(String(className).split(/\s+/).filter(Boolean));
  switchClasses.add("app-switch");
  const button = createElement("button", {
    className: Array.from(switchClasses).join(" "),
    dataset: { ...dataset, variant },
    attributes: {
      type: "button",
      title,
      "aria-label": ariaLabel || title,
      "aria-pressed": on ? "true" : "false"
    }
  });
  button.dataset.on = on ? "1" : "0";
  const knob = createElement("span", { className: "app-switch-knob" });
  button.appendChild(knob);
  updateSwitchButton(button, on);
  return button;
}

function updateSwitchButton(button, on) {
  button.dataset.on = on ? "1" : "0";
  button.dataset.state = on ? "on" : "off";
  button.setAttribute("aria-pressed", on ? "true" : "false");
  button.classList.toggle("is-on", on);
}

function planFeatureToggleLabel(featureLabel, planLabel, enabled) {
  return `${featureLabel} no plano ${planLabel}: ${enabled ? "liberado" : "bloqueado"}`;
}

function toggleElementHidden(element, hidden) {
  if (!element) return;
  element.classList.toggle("hidden", Boolean(hidden));
}

function setComboVisibility(element, visible) {
  if (!element) return;
  element.classList.toggle("reward-hud-combo-visible", Boolean(visible));
}

function setGoogleStatusState(element, state) {
  if (!element) return;
  element.dataset.state = state;
}

function setInlineActionVisibility(element, visible) {
  if (!element) return;
  element.classList.toggle("hidden", !visible);
}

function canUseBinauralSound() {
  return planCapabilities.loaded && planCapabilities.binaural;
}

function applyBinauralCapabilityToControls() {
  const allowed = canUseBinauralSound();
  ["settings-sound", "focus-sound-select"].forEach((selectId) => {
    const select = document.getElementById(selectId);
    if (!select) return;
    const option = Array.from(select.options).find((item) => item.value === FEATURE_BINAURAL);
    if (!option) return;
    option.disabled = !allowed;
    option.hidden = !allowed;
    option.setAttribute("aria-disabled", allowed ? "false" : "true");
    option.title = allowed
      ? "Disponível no seu perfil atual."
      : "Seu plano atual não inclui ondas binaurais.";
    select.dataset.binauralAccess = allowed ? "allowed" : "denied";
    if (!allowed && select.value === FEATURE_BINAURAL) {
      select.value = "nenhum";
    }
  });
}

async function loadPlanCapabilities() {
  planCapabilities = { loaded: false, binaural: false, features: {} };
  applyBinauralCapabilityToControls();

  const response = await apiFetch("/api/plans");
  const payload = await responsePayload(response);
  if (!response.ok || !payload?.matrix || !currentUser) {
    throw new Error(apiErrorMessage(payload, "Não foi possível validar os recursos do seu plano."));
  }

  const planFeatures = payload.matrix[currentUser.plan] || {};
  planCapabilities = {
    loaded: true,
    binaural: currentUser.role === ROLE_ADMIN || Boolean(planFeatures[FEATURE_BINAURAL]),
    features: planFeatures
  };
  applyBinauralCapabilityToControls();
  applyPlanFeatureVisibility();
  return planCapabilities;
}

// Oculta no menu e na UI os recursos não liberados pelo plano do usuário.
// O administrador nunca é limitado pela matriz de planos (acesso integral).
function applyPlanFeatureVisibility() {
  if (!currentUser) return;
  const isAdmin = currentUser.role === ROLE_ADMIN;

  for (const [section, featureKey] of Object.entries(SECTION_FEATURE)) {
    const navItem = document.getElementById(`nav-${section}`);
    if (!navItem) continue;
    const liberado = isAdmin || canUseFeature(featureKey);
    toggleElementHidden(navItem, !liberado);
    // Se o usuário estava numa seção que deixou de ser liberada, retorna ao dashboard.
    if (!liberado && activeSection === section) switchSection("dashboard");
  }

  // Barra do Google Agenda: recurso google_calendar, dentro da página Agenda.
  const googleBar = document.getElementById("google-agenda-bar");
  if (googleBar) toggleElementHidden(googleBar, !(isAdmin || canUseFeature("google_calendar")));
}

async function saveProfilePreferences(preferences, successMessage) {
  if (preferences.focus_sound === FEATURE_BINAURAL && !canUseBinauralSound()) {
    throw new Error("Seu plano atual não inclui ondas binaurais.");
  }
  const response = await apiFetch("/api/profile/preferences", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences)
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    throw new Error(apiErrorMessage(payload, "Erro ao salvar preferências."));
  }

  userProfile = {
    ...userProfile,
    ...payload.profile
  };
  applyProfileData();
  applyBinauralCapabilityToControls();
  if (successMessage) showToast(successMessage, "success");
  return payload;
}

let activeDialogCleanup = null;
let appDialogSequence = 0;

function closeActiveDialog(result = { confirmed: false, values: {} }) {
  if (!activeDialogCleanup) return;
  const cleanup = activeDialogCleanup;
  activeDialogCleanup = null;
  cleanup(result);
}

function showAppDialog({
  title,
  description = "",
  fields = [],
  assistant = null,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  tone = "default"
}) {
  closeActiveDialog();

  return new Promise((resolve) => {
    appDialogSequence += 1;
    const titleId = `app-dialog-title-${appDialogSequence}`;
    const descriptionId = `app-dialog-description-${appDialogSequence}`;
    const overlay = createElement("div", {
      className: "modal-overlay open app-dialog-overlay"
    });
    const modal = createElement("div", {
      className: `modal app-dialog${tone !== "default" ? ` app-dialog-${tone}` : ""}`,
      attributes: {
        role: "dialog",
        "aria-modal": "true",
        "aria-labelledby": titleId,
        ...(description ? { "aria-describedby": descriptionId } : {})
      }
    });
    const header = createElement("div", { className: "modal-header" });
    header.append(
      createElement("h3", { text: title, attributes: { id: titleId } }),
      createActionButton({
        className: "modal-close app-dialog-close",
        title: "Fechar diálogo",
        text: "×"
      })
    );

    const body = createElement("div", { className: "modal-body" });
    if (description) {
      body.appendChild(
        createElement("p", {
          className: "app-dialog-description",
          text: description,
          attributes: { id: descriptionId }
        })
      );
    }
    const errorBox = createElement("p", {
      className: "app-dialog-error",
      attributes: { role: "alert", "aria-live": "assertive" }
    });
    body.appendChild(errorBox);

    const form = createElement("form", { className: "app-dialog-form" });
    form.appendChild(body);
    const fieldMap = new Map();

    fields.forEach((field) => {
      const fieldWrapper = createElement("label", { className: "app-dialog-field" });
      fieldWrapper.appendChild(
        createElement("span", { className: "app-dialog-label", text: field.label })
      );

      let input;
      if (field.type === "select") {
        input = createElement("select", {
          className: "app-dialog-input",
          attributes: { name: field.name }
        });
        (field.options || []).forEach((option) => {
          const optionNode = createElement("option", {
            text: option.label,
            attributes: { value: option.value }
          });
          if (option.value === field.value) optionNode.selected = true;
          input.appendChild(optionNode);
        });
      } else {
        input = createElement("input", {
          className: "app-dialog-input",
          attributes: {
            type: field.type || "text",
            name: field.name,
            value: field.value || "",
            placeholder: field.placeholder || "",
            autocomplete: field.autocomplete || "off",
            minlength: field.minlength,
            maxlength: field.maxlength,
            pattern: field.pattern,
            min: field.min,
            max: field.max,
            step: field.step
          }
        });
      }
      if (field.required) input.required = true;
      fieldMap.set(field.name, { config: field, input });
      fieldWrapper.appendChild(input);
      form.appendChild(fieldWrapper);
    });

    if (assistant && canUseFeature("ai_assistant")) {
      appendDialogAiAssistant(form, fieldMap, assistant);
    }

    const actions = createElement("div", { className: "modal-footer app-dialog-actions" });
    const cancelButton = createElement("button", {
      className: "btn btn-cancel",
      text: cancelText,
      attributes: { type: "button" }
    });
    const confirmButton = createElement("button", {
      className: `btn ${tone === "danger" ? "btn-danger" : "btn-primary"}`,
      text: confirmText,
      attributes: { type: "submit" }
    });
    actions.append(cancelButton, confirmButton);

    form.append(actions);
    modal.append(header, form);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.classList.add("app-dialog-open");

    const closeButton = header.querySelector(".app-dialog-close");
    const fieldInputs = Array.from(form.querySelectorAll("input, select, textarea"));
    const firstFocusable = fieldInputs[0] || confirmButton;
    const previousFocus = document.activeElement;

    const finish = (result) => {
      overlay.remove();
      document.body.classList.remove("app-dialog-open");
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
      resolve(result);
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeActiveDialog({ confirmed: false, values: {} });
        return;
      }
      if (event.key === "Tab") {
        const focusable = Array.from(
          modal.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        ).filter((element) => !element.hidden && element.getClientRects().length > 0);
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    activeDialogCleanup = finish;
    document.addEventListener("keydown", onKeyDown);

    closeButton.addEventListener("click", () =>
      closeActiveDialog({ confirmed: false, values: {} })
    );
    cancelButton.addEventListener("click", () =>
      closeActiveDialog({ confirmed: false, values: {} })
    );
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeActiveDialog({ confirmed: false, values: {} });
    });

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      errorBox.textContent = "";
      const values = {};

      for (const [name, entry] of fieldMap.entries()) {
        const rawValue = entry.input.value.trim();
        if (entry.config.required && !rawValue) {
          errorBox.textContent = `Preencha o campo "${entry.config.label}".`;
          entry.input.focus();
          return;
        }
        if (!entry.input.checkValidity()) {
          errorBox.textContent =
            entry.input.validationMessage || `Revise o campo "${entry.config.label}".`;
          entry.input.focus();
          return;
        }
        if (typeof entry.config.validate === "function") {
          const validationMessage = entry.config.validate(rawValue);
          if (validationMessage) {
            errorBox.textContent = validationMessage;
            entry.input.focus();
            return;
          }
        }
        values[name] = entry.config.transform ? entry.config.transform(rawValue) : rawValue;
      }

      closeActiveDialog({ confirmed: true, values });
    });

    requestAnimationFrame(() => firstFocusable.focus());
  });
}

const DIALOG_AI_OPTIONS = [
  ["correcao", "Correção ortográfica e gramatical"],
  ["clareza", "Melhorar descrição e clareza"],
  ["passos", "Executar mais rápido"],
  ["dicas", "Dicas práticas"],
  ["microtarefas", "Decompor em microtarefas"],
  ["estimativa", "Estimar duração em faixa"],
  ["dependencias", "Dependências, conflitos e alternativa"],
  ["prioridade", "Prioridade, carga e melhor período"],
  ["criterio", "Critério de conclusão verificável"]
];

function appendDialogAiAssistant(form, fieldMap, { fieldName = "title" } = {}) {
  const target = fieldMap.get(fieldName)?.input;
  if (!target) return;

  const section = createElement("section", {
    className: "agenda-ai app-dialog-ai",
    attributes: { "aria-label": "Copiloto opcional de IA" }
  });
  const trigger = createElement("button", {
    className: "btn btn-cancel agenda-ai-trigger",
    text: "Ajudar com IA",
    attributes: { type: "button", "aria-expanded": "false" }
  });
  const panel = createElement("div", {
    className: "agenda-ai-panel hidden",
    attributes: { "aria-busy": "false" }
  });
  const privacy = createElement("p", {
    className: "agenda-ai-privacy",
    text: "O texto só será enviado após sua ação.",
    attributes: { role: "status", "aria-live": "polite" }
  });
  const consent = createElement("input", { attributes: { type: "checkbox" } });
  const consentLabel = createElement("label", { className: "agenda-ai-consent hidden" });
  consentLabel.append(
    consent,
    createElement("span", {
      text: "Autorizo enviar este texto ao provedor remoto indicado acima."
    })
  );
  const kind = createElement("select", { className: "app-dialog-input" });
  for (const [value, label] of DIALOG_AI_OPTIONS) {
    kind.appendChild(createElement("option", { text: label, attributes: { value } }));
  }
  const kindLabel = createElement("label", { className: "agenda-ai-field" });
  kindLabel.append(createElement("span", { text: "Assistência" }), kind);
  const generate = createElement("button", {
    className: "btn btn-primary agenda-ai-generate",
    text: "Gerar sugestão",
    attributes: { type: "button" }
  });
  const original = createElement("textarea", {
    attributes: { rows: "4", readonly: "readonly", "aria-label": "Texto original preservado" }
  });
  const suggestion = createElement("textarea", {
    attributes: {
      rows: "4",
      readonly: "readonly",
      "aria-label": "Sugestão da IA; selecione um trecho para aplicação parcial"
    }
  });
  const comparison = createElement("div", { className: "agenda-ai-comparison hidden" });
  const originalLabel = createElement("label", { className: "agenda-ai-textarea" });
  originalLabel.append(createElement("span", { text: "Original preservado" }), original);
  const suggestionLabel = createElement("label", { className: "agenda-ai-textarea" });
  suggestionLabel.append(
    createElement("span", { text: "Sugestão — selecione um trecho para aplicar parcialmente" }),
    suggestion
  );
  comparison.append(originalLabel, suggestionLabel);
  const feedback = createElement("p", {
    className: "agenda-ai-feedback",
    attributes: { role: "status", "aria-live": "polite" }
  });
  const actions = createElement("div", { className: "agenda-ai-actions hidden" });
  const apply = createElement("button", {
    className: "btn btn-primary",
    text: "Aplicar",
    attributes: { type: "button" }
  });
  const applyPartial = createElement("button", {
    className: "btn btn-cancel",
    text: "Aplicar parcialmente",
    attributes: { type: "button" }
  });
  const retry = createElement("button", {
    className: "btn btn-cancel",
    text: "Tentar novamente",
    attributes: { type: "button" }
  });
  const discard = createElement("button", {
    className: "btn btn-cancel",
    text: "Descartar",
    attributes: { type: "button" }
  });
  actions.append(apply, applyPartial, retry, discard);
  panel.append(privacy, consentLabel, kindLabel, generate, comparison, feedback, actions);
  section.append(trigger, panel);
  form.appendChild(section);

  let source = "";
  let generated = "";
  const controls = [kind, generate, apply, applyPartial, retry, discard];
  const setBusy = (busy) => {
    panel.setAttribute("aria-busy", String(busy));
    controls.forEach((control) => {
      control.disabled = busy;
    });
  };
  const reset = ({ close = false } = {}) => {
    source = "";
    generated = "";
    original.value = "";
    suggestion.value = "";
    feedback.textContent = "";
    comparison.classList.add("hidden");
    actions.classList.add("hidden");
    if (close) {
      panel.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
    }
  };
  const refreshPrivacy = async () => {
    await carregarStatusAssistente();
    const status = assistenteEstado.status;
    if (!status?.connected) {
      privacy.textContent = "Nenhum modelo de IA está disponível.";
      consentLabel.classList.add("hidden");
      return false;
    }
    privacy.textContent = status.isLocal
      ? `Modelo local ${status.model || "conectado"}: o texto permanece no ambiente configurado.`
      : `Modelo remoto ${status.model || "conectado"}: confirme o envio antes de continuar.`;
    consentLabel.classList.toggle("hidden", status.isLocal);
    return true;
  };
  const run = async ({ reuseSource = false } = {}) => {
    const text = reuseSource ? source : target.value.trim();
    if (text.length < 2) {
      feedback.textContent = "Preencha o nome da categoria com pelo menos 2 caracteres.";
      target.focus();
      return;
    }
    if (!(await refreshPrivacy())) return;
    if (!assistenteEstado.status.isLocal && !consent.checked) {
      feedback.textContent = "Confirme o envio ao provedor remoto antes de gerar a sugestão.";
      consent.focus();
      return;
    }
    source = text;
    feedback.textContent = "Gerando sugestão sem alterar o formulário…";
    setBusy(true);
    try {
      const response = await apiFetch(`${ASSISTENTE_BASE}/copilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: kind.value,
          text,
          ...(!assistenteEstado.status.isLocal ? { remote_consent: true } : {})
        })
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "Não foi possível gerar a sugestão."));
      }
      generated = String(payload.suggestion || "").trim();
      if (!generated) throw new Error("O modelo não retornou uma sugestão utilizável.");
      original.value = source;
      suggestion.value = generated;
      comparison.classList.remove("hidden");
      actions.classList.remove("hidden");
      feedback.textContent = "Compare as versões. O original permanece intacto até você aplicar.";
    } catch (error) {
      feedback.textContent = `${error.message} O conteúdo original foi preservado.`;
    } finally {
      setBusy(false);
      consent.checked = false;
    }
  };
  const applyValue = (partial) => {
    let value = generated;
    if (partial) {
      value = suggestion.value.slice(suggestion.selectionStart, suggestion.selectionEnd).trim();
      if (!value) {
        feedback.textContent = "Selecione na sugestão o trecho que deseja aplicar parcialmente.";
        suggestion.focus();
        return;
      }
    }
    if (!value) return;
    target.value = value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    feedback.textContent = partial
      ? "Trecho selecionado aplicado. Revise antes de salvar."
      : "Sugestão aplicada. Revise antes de salvar.";
    target.focus();
  };

  trigger.addEventListener("click", async () => {
    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !opening);
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) await refreshPrivacy();
  });
  generate.addEventListener("click", () => run());
  retry.addEventListener("click", () => run({ reuseSource: true }));
  apply.addEventListener("click", () => applyValue(false));
  applyPartial.addEventListener("click", () => applyValue(true));
  discard.addEventListener("click", () => reset({ close: true }));
}

// Correção do Bug de QA: populateCategorySelect definido de forma nativa e robusta
function populateCategorySelect(selectId, selectedId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  clearElement(select);
  activitiesData.forEach((activity) => {
    const opt = document.createElement("option");
    opt.value = activity.id;
    opt.textContent = TITLE_PT[activity.title] || activity.title;
    if (activity.id === selectedId) opt.selected = true;
    select.appendChild(opt);
  });
}

// ============================================================
// CANVAS DE CONFETES DOPAMINÉRGICOS
// ============================================================

let confettiActive = false;
const confettiCanvas = document.getElementById("confetti-canvas");
const ctxConfetti = confettiCanvas.getContext("2d");
let confettiParticles = [];

function resizeConfettiCanvas() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeConfettiCanvas);
resizeConfettiCanvas();

class ConfettiParticle {
  constructor() {
    this.x = window.innerWidth / 2;
    this.y = window.innerHeight / 2 - 50;
    this.size = Math.random() * 8 + 5;
    this.color = `hsl(${Math.random() * 360}, 90%, 60%)`;
    this.angle = Math.random() * Math.PI * 2;
    this.speed = Math.random() * 8 + 4;
    this.friction = 0.97;
    this.gravity = 0.22;
    this.vx = Math.cos(this.angle) * this.speed;
    this.vy = Math.sin(this.angle) * this.speed - 3;
    this.opacity = 1;
    this.rotation = Math.random() * 360;
    this.rotationSpeed = Math.random() * 10 - 5;
  }
  update() {
    this.vx *= this.friction;
    this.vy *= this.friction;
    this.vy += this.gravity;
    this.x += this.vx;
    this.y += this.vy;
    this.opacity -= 0.012;
    this.rotation += this.rotationSpeed;
  }
  draw() {
    ctxConfetti.save();
    ctxConfetti.translate(this.x, this.y);
    ctxConfetti.rotate((this.rotation * Math.PI) / 180);
    ctxConfetti.fillStyle = this.color;
    ctxConfetti.globalAlpha = Math.max(0, this.opacity);
    ctxConfetti.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    ctxConfetti.restore();
  }
}

function triggerConfetti() {
  if (!userProfile.enable_confetti) return;
  confettiParticles = [];
  for (let i = 0; i < 150; i++) {
    confettiParticles.push(new ConfettiParticle());
  }
  if (!confettiActive) {
    confettiActive = true;
    animateConfetti();
  }
}

function animateConfetti() {
  ctxConfetti.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiParticles.forEach((p, idx) => {
    p.update();
    p.draw();
    if (p.opacity <= 0) confettiParticles.splice(idx, 1);
  });

  if (confettiParticles.length > 0) {
    requestAnimationFrame(animateConfetti);
  } else {
    confettiActive = false;
    ctxConfetti.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

// ============================================================
// WEB AUDIO API — SINTETIZADOR DE ÁUDIO DE FOCO NATIVO (TDAH/TEA)
// ============================================================

let audioCtx = null;
let soundSource = null;
let rainFilter = null;
let soundGain = null;
let waveLfo = null;
let isAudioPlaying = false;
// Osciladores dedicados às Ondas Binaurais 40Hz (Gamma)
let binauralOscLeft = null;
let binauralOscRight = null;

function initAudioContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Alguns navegadores iniciam o contexto suspenso até um gesto do usuário
  if (audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function startFocusSound(type) {
  stopFocusSound();

  if (type === "nenhum") return true;
  if (type === FEATURE_BINAURAL && !canUseBinauralSound()) {
    showToast("Seu plano atual não inclui ondas binaurais.", "warning");
    return false;
  }

  initAudioContext();

  // ----------------------------------------------------------------
  // ONDAS BINAURAIS 40Hz (GAMMA) — batida real por diferença de fase
  // Ex.: 200Hz no ouvido esquerdo + 240Hz no direito => batida de 40Hz.
  // Requer estéreo; usamos StereoPanner para isolar cada canal.
  // ----------------------------------------------------------------
  if (type === FEATURE_BINAURAL) {
    const baseFreq = 200; // portadora base (Hz)
    const beatFreq = 40; // frequência Gamma alvo (Hz)

    binauralOscLeft = audioCtx.createOscillator();
    binauralOscRight = audioCtx.createOscillator();
    binauralOscLeft.type = "sine";
    binauralOscRight.type = "sine";
    binauralOscLeft.frequency.setValueAtTime(baseFreq, audioCtx.currentTime);
    binauralOscRight.frequency.setValueAtTime(baseFreq + beatFreq, audioCtx.currentTime);

    const panLeft = audioCtx.createStereoPanner();
    const panRight = audioCtx.createStereoPanner();
    panLeft.pan.setValueAtTime(-1, audioCtx.currentTime);
    panRight.pan.setValueAtTime(1, audioCtx.currentTime);

    soundGain = audioCtx.createGain();
    soundGain.gain.setValueAtTime(0.12, audioCtx.currentTime);

    binauralOscLeft.connect(panLeft);
    binauralOscRight.connect(panRight);
    panLeft.connect(soundGain);
    panRight.connect(soundGain);
    soundGain.connect(audioCtx.destination);

    binauralOscLeft.start();
    binauralOscRight.start();
    isAudioPlaying = true;
    return true;
  }

  const bufferSize = audioCtx.sampleRate * 2; // 2 segundos
  const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);

  // Gerador de ruído
  let lastOut = 0.0;
  for (let i = 0; i < bufferSize; i++) {
    const white = Math.random() * 2 - 1;
    if (type === "chuva") {
      // Ruído Rosa filtrado para simular chuva
      output[i] = (lastOut + 0.02 * white) / 1.02;
      lastOut = output[i];
      output[i] *= 3.5; // Amplificar
    } else {
      // Ruído Branco padrão
      output[i] = white * 0.5;
    }
  }

  soundSource = audioCtx.createBufferSource();
  soundSource.buffer = noiseBuffer;
  soundSource.loop = true;

  soundGain = audioCtx.createGain();
  soundGain.gain.setValueAtTime(0.15, audioCtx.currentTime);

  if (type === "chuva") {
    // Filtro passa-baixa para chuva suave
    rainFilter = audioCtx.createBiquadFilter();
    rainFilter.type = "lowpass";
    rainFilter.frequency.setValueAtTime(800, audioCtx.currentTime);

    soundSource.connect(rainFilter);
    rainFilter.connect(soundGain);
  } else if (type === "ondas") {
    // Modulação de volume LFO para simular ondas do mar
    waveLfo = audioCtx.createOscillator();
    waveLfo.type = "sine";
    waveLfo.frequency.setValueAtTime(0.15, audioCtx.currentTime); // Cíclico a cada ~6 segundos

    const lfoGain = audioCtx.createGain();
    lfoGain.gain.setValueAtTime(0.12, audioCtx.currentTime);

    waveLfo.connect(lfoGain);
    lfoGain.connect(soundGain.gain); // Modular ganho principal

    soundSource.connect(soundGain);
    waveLfo.start();
  } else {
    // Ruído Branco puro
    soundSource.connect(soundGain);
  }

  soundGain.connect(audioCtx.destination);
  soundSource.start();
  isAudioPlaying = true;
  return true;
}

function stopFocusSound() {
  if (isAudioPlaying) {
    try {
      if (soundSource) soundSource.stop();
      if (waveLfo) waveLfo.stop();
      if (binauralOscLeft) binauralOscLeft.stop();
      if (binauralOscRight) binauralOscRight.stop();
    } catch (e) {
      // Ignorar erros se já parados
    }
    soundSource = null;
    waveLfo = null;
    binauralOscLeft = null;
    binauralOscRight = null;
    isAudioPlaying = false;
  }
}

// Sino sintético premium com reverberação espacial (recompensa ao concluir o ciclo)
function playCompletionBell() {
  try {
    initAudioContext();
    const now = audioCtx.currentTime;

    // Reverb por convolução com resposta ao impulso gerada proceduralmente
    const convolver = audioCtx.createConvolver();
    const irLen = audioCtx.sampleRate * 1.6;
    const irBuffer = audioCtx.createBuffer(2, irLen, audioCtx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = irBuffer.getChannelData(ch);
      for (let i = 0; i < irLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.4);
      }
    }
    convolver.buffer = irBuffer;

    const masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.connect(audioCtx.destination);
    convolver.connect(masterGain);

    // Acorde de sino (harmônicos) com envelope de decaimento natural
    const partials = [523.25, 659.25, 783.99, 1046.5]; // Dó maior (C5, E5, G5, C6)
    partials.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now);
      const peak = 0.22 / (idx + 1);
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(peak, now + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 1.8 + idx * 0.15);
      osc.connect(g);
      g.connect(masterGain); // via seco
      g.connect(convolver); // via reverb
      osc.start(now);
      osc.stop(now + 2.1 + idx * 0.15);
    });

    masterGain.gain.exponentialRampToValueAtTime(0.9, now + 0.03);
    masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);
  } catch (e) {
    // Silencioso: áudio é aprimoramento, nunca deve quebrar o fluxo
  }
}

// ============================================================
// TIMER POMODORO (Modo Foco Inclusivo)
// ============================================================

let pomodoroTimer = null;
let pomodoroTotalSeconds = 25 * 60; // Duração do ciclo atual (padrão: Pomodoro Clássico 25 min)
let pomodoroSecondsLeft = 25 * 60;
let pomodoroIsRunning = false;
let currentFocusEvent = null;

// Circunferência do anel SVG (r=45): 2 * PI * 45 ≈ 282.743
const POMODORO_RING_CIRCUMFERENCE = 2 * Math.PI * 45;

// Define o ciclo Pomodoro (Foco Rápido 15 / Clássico 25 / Profundo 50) de forma real
function setPomodoroCycle(minutes) {
  pomodoroTotalSeconds = minutes * 60;
  const selector = document.getElementById("focus-cycle-selector");
  if (selector) {
    selector.querySelectorAll(".layout-btn").forEach((b) => {
      b.classList.toggle("active", parseInt(b.dataset.cycle) === minutes);
    });
  }
  resetFocusTimer();
}

function openFocusMode(event) {
  currentFocusEvent = event;
  const container = document.getElementById("focus-mode-container");
  const title = document.getElementById("focus-mode-task-title");
  const category = document.getElementById("focus-mode-category");

  title.textContent = event.title;
  category.textContent = TITLE_PT[event.activity_title] || event.activity_title;
  applyDynamicStyles(category, {
    color: `var(--${TIMELINE_CLASSES[event.activity_title] || "work"}-color)`
  });

  // Carregar som do perfil
  const select = document.getElementById("focus-sound-select");
  applyBinauralCapabilityToControls();
  const preferredSound = userProfile.focus_sound || "chuva";
  select.value =
    preferredSound === FEATURE_BINAURAL && !canUseBinauralSound() ? "nenhum" : preferredSound;

  resetFocusTimer();
  container.classList.remove("hidden");
}

function closeFocusMode() {
  stopFocusTimer();
  stopFocusSound();
  document.getElementById("focus-mode-container").classList.add("hidden");
  currentFocusEvent = null;
}

function toggleFocusTimer() {
  const btn = document.getElementById("btn-focus-play-pause");
  const icon = document.getElementById("focus-play-icon");

  const container = document.getElementById("focus-mode-container");

  if (pomodoroIsRunning) {
    // Pausar
    stopFocusTimer();
    stopFocusSound();
    if (container) container.classList.remove("running");
    setFocusButtonContent(btn, "Retomar", "play");
  } else {
    // Iniciar
    pomodoroIsRunning = true;
    if (container) container.classList.add("running");
    setFocusButtonContent(btn, "Pausar", "pause");

    // Iniciar som sintético
    const soundType = document.getElementById("focus-sound-select").value;
    startFocusSound(soundType);

    pomodoroTimer = setInterval(() => {
      pomodoroSecondsLeft--;
      updateFocusTimerDisplay();

      if (pomodoroSecondsLeft <= 0) {
        clearInterval(pomodoroTimer);
        pomodoroIsRunning = false;
        stopFocusSound();
        // Motor de Recompensa ao concluir o ciclo de foco (carga alta = foco profundo)
        celebrarConclusao({ tipo: "ciclo_foco", cargaAlta: true });
        resetFocusTimer();
      }
    }, 1000);
  }
}

function stopFocusTimer() {
  if (pomodoroTimer) clearInterval(pomodoroTimer);
  pomodoroIsRunning = false;
  const container = document.getElementById("focus-mode-container");
  if (container) container.classList.remove("running");
}

function resetFocusTimer() {
  stopFocusTimer();
  stopFocusSound();
  pomodoroSecondsLeft = pomodoroTotalSeconds;
  updateFocusTimerDisplay();
  const btn = document.getElementById("btn-focus-play-pause");
  setFocusButtonContent(btn, "Iniciar", "play");
}

function updateFocusTimerDisplay() {
  const mins = String(Math.floor(pomodoroSecondsLeft / 60)).padStart(2, "0");
  const secs = String(pomodoroSecondsLeft % 60).padStart(2, "0");
  const display = document.getElementById("focus-timer-display");
  if (display) display.textContent = `${mins}:${secs}`;

  // Progresso radial no anel SVG (stroke-dashoffset) — causa raiz do bug: o HTML
  // migrou de barra linear (#focus-timer-progress) para anel (#focus-timer-ring).
  const ring = document.getElementById("focus-timer-ring");
  if (ring) {
    const ratioDecorrido =
      pomodoroTotalSeconds > 0
        ? (pomodoroTotalSeconds - pomodoroSecondsLeft) / pomodoroTotalSeconds
        : 0;
    const offset = POMODORO_RING_CIRCUMFERENCE * ratioDecorrido;
    ring.setAttribute("stroke-dasharray", String(POMODORO_RING_CIRCUMFERENCE));
    ring.setAttribute("stroke-dashoffset", String(offset));
  }
}

async function completeFocusTask() {
  if (!currentFocusEvent) return;
  // A celebração (Motor de Recompensa) acontece dentro de toggleEventCompletion
  await toggleEventCompletion(currentFocusEvent.id, currentFocusEvent.is_completed);
  closeFocusMode();
}

// ============================================================
// SIDEBAR — NAVEGAÇÃO E SEÇÕES
// ============================================================

// A navegação deixou de precisar de um botão de menu: em telas estreitas a
// barra rola horizontalmente e todas as seções continuam alcançáveis com um
// toque. Um controle a mais só acrescentaria um passo para chegar ao mesmo
// lugar, então ele foi removido junto com a gaveta e a sobreposição.
function initSidebar() {
  const navItems = document.querySelectorAll(".nav-item");

  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      switchSection(item.dataset.section);

      navItems.forEach((n) => n.classList.remove("active"));
      item.classList.add("active");
    });
  });
}

function openRequestedSection() {
  const requested = new URLSearchParams(window.location.search).get("secao");
  const allowed = new Set([
    "dashboard",
    "agenda",
    "reports",
    "myfeatures",
    "settings",
    "users",
    "plans",
    "dopamine",
    "ai",
    "smart"
  ]);
  if (!requested || !allowed.has(requested) || !canAccessSection(requested)) return;
  switchSection(requested);
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.section === requested);
  });
}

function switchSection(section) {
  // Controle de acesso por perfil: Configurações e Usuários só para administrador
  if (typeof canAccessSection === "function" && !canAccessSection(section)) {
    showToast("Acesso restrito ao administrador.", "error");
    section = "dashboard";
  }

  activeSection = section;
  document.getElementById("section-dashboard").classList.toggle("hidden", section !== "dashboard");
  document.getElementById("section-agenda").classList.toggle("hidden", section !== "agenda");
  document.getElementById("section-reports").classList.toggle("hidden", section !== "reports");
  document.getElementById("section-settings").classList.toggle("hidden", section !== "settings");
  const secUsers = document.getElementById("section-users");
  if (secUsers) secUsers.classList.toggle("hidden", section !== "users");
  const secPlans = document.getElementById("section-plans");
  if (secPlans) secPlans.classList.toggle("hidden", section !== "plans");
  const secDopa = document.getElementById("section-dopamine");
  if (secDopa) secDopa.classList.toggle("hidden", section !== "dopamine");
  const secIa = document.getElementById("section-ai");
  if (secIa) secIa.classList.toggle("hidden", section !== "ai");
  const secSmart = document.getElementById("section-smart");
  if (secSmart) secSmart.classList.toggle("hidden", section !== "smart");
  const secMyFeat = document.getElementById("section-myfeatures");
  if (secMyFeat) secMyFeat.classList.toggle("hidden", section !== "myfeatures");

  if (section === "dashboard") {
    carregarTermometroEnergia();
  } else if (section === "agenda") {
    fetchAndRenderAgenda();
  } else if (section === "reports") {
    renderReports();
    carregarGraficoTemporal();
    carregarMeusGraficos();
  } else if (section === "settings") {
    loadSettingsTab();
  } else if (section === "users") {
    renderUsersAdmin();
  } else if (section === "plans") {
    renderPlansAdmin();
  } else if (section === "dopamine") {
    renderDopamineAdmin();
  } else if (section === "ai") {
    carregarPaginaIA();
  } else if (section === "smart") {
    renderSmartAdmin();
  } else if (section === "myfeatures") {
    renderMyFeatures();
  }
}

// ============================================================
// SIDEBAR — BUSCA
// ============================================================

function initSearch() {
  const searchContainer = document.getElementById("search-container");
  const searchToggle = document.getElementById("search-toggle");
  const searchInput = document.getElementById("search-input");

  searchToggle.addEventListener("click", () => {
    const isExpanded = searchContainer.classList.toggle("expanded");
    if (isExpanded) {
      searchInput.focus();
    } else {
      searchInput.value = "";
      filterCards("");
    }
  });

  searchInput.addEventListener("input", (e) => {
    filterCards(e.target.value.toLowerCase().trim());
  });

  // Fechar busca ao pressionar Escape
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      searchContainer.classList.remove("expanded");
      searchInput.value = "";
      filterCards("");
    }
  });
}

function filterCards(query) {
  const cards = document.querySelectorAll(".card[data-title]");
  cards.forEach((card) => {
    const titlePt = (TITLE_PT[card.dataset.title] || card.dataset.title).toLowerCase();
    const titleEn = card.dataset.title.toLowerCase();
    const match = !query || titlePt.includes(query) || titleEn.includes(query);
    card.classList.toggle("hidden", !match);
  });
}

// ============================================================
// SIDEBAR — PERFIL E MENUS DROPDOWN (MEU PERFIL, PREFERENCIAS, SAIR)
// ============================================================

function initProfile() {
  const profileContainer = document.getElementById("profile-container");
  const profileToggle = document.getElementById("profile-toggle");

  profileToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    profileContainer.classList.toggle("open");
  });

  // Fechar ao clicar fora
  document.addEventListener("click", (e) => {
    if (!profileContainer.contains(e.target)) {
      profileContainer.classList.remove("open");
    }
  });

  // Ações do Dropdown
  document.getElementById("dropdown-profile-btn").addEventListener("click", () => {
    profileContainer.classList.remove("open");
    openProfileModal();
  });

  document.getElementById("dropdown-prefs-btn").addEventListener("click", () => {
    profileContainer.classList.remove("open");
    openPreferencesModal();
  });

  document.getElementById("dropdown-logout-btn").addEventListener("click", () => {
    profileContainer.classList.remove("open");
    // Sair do app (Tela de Bloqueio com blur)
    document.getElementById("lock-screen").classList.remove("hidden");
    document.getElementById("lock-screen").classList.add("open");
  });

  // Botão Desbloquear da Tela de Bloqueio
  document.getElementById("btn-unlock").addEventListener("click", () => {
    document.getElementById("lock-screen").classList.remove("open");
    document.getElementById("lock-screen").classList.add("hidden");
    showToast("Acesso restaurado!", "success");
  });
}

async function fetchProfileData() {
  try {
    const response = await apiFetch("/api/profile");
    if (!response.ok) return;
    const profile = await response.json();
    if (profile) {
      userProfile = profile;
      applyProfileData();
      applyBinauralCapabilityToControls();
    }
  } catch (error) {
    console.error("Erro ao carregar perfil:", error);
  }
}

function applyProfileData() {
  const av = userProfile.avatar || "/assets/images/kairo-logo.svg";
  const un = userProfile.username || currentUser?.name || "Usuário";
  const em = userProfile.email || currentUser?.email || "";

  // Cabeçalho e Sidebar
  document.getElementById("header-avatar").src = av;
  document.getElementById("header-username").textContent = un;
  document.getElementById("sidebar-avatar").src = av;
  document.getElementById("sidebar-username").textContent = un;

  // Telas internas e lock screen
  document.getElementById("lock-avatar").src = av;
  document.getElementById("lock-username").textContent = un;
  document.getElementById("profile-modal-avatar").src = av;

  // inputs do modal de perfil
  document.getElementById("profile-username").value = un;
  document.getElementById("profile-email").value = em;

  // Aplicar tema dinamicamente
  document.body.classList.toggle("light-theme", userProfile.theme === "claro");
}

function openProfileModal() {
  openModal("modal-profile-overlay");
}

function openPreferencesModal() {
  document.getElementById("pref-theme").value = userProfile.theme || "escuro";
  document.getElementById("pref-confetti").checked = Boolean(userProfile.enable_confetti);
  openModal("modal-preferences-overlay");
}

// Upload e Conversão de Foto do Perfil para Base64
document.getElementById("profile-avatar-input").addEventListener("change", function (e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (evt) {
    document.getElementById("profile-modal-avatar").src = evt.target.result;
    userProfile.avatar = evt.target.result; // Base64
  };
  reader.readAsDataURL(file);
});

async function saveProfileModal() {
  const username = document.getElementById("profile-username").value.trim();
  const email = document.getElementById("profile-email").value.trim();

  if (!username || !email) {
    showToast("Nome e E-mail são obrigatórios!", "warning");
    return;
  }

  const payload = {
    username,
    email,
    avatar: userProfile.avatar
  };

  try {
    const response = await apiFetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const res = await responsePayload(response);
    if (!response.ok) {
      throw new Error(apiErrorMessage(res, "Falha ao salvar perfil."));
    }
    userProfile = res.profile;
    applyProfileData();
    showToast("Dados do perfil atualizados!", "success");
    closeModal("modal-profile-overlay");
  } catch (error) {
    showToast(error.message || "Erro ao salvar perfil.", "error");
  }
}

// Troca de senha feita pelo próprio usuário. A senha atual é conferida no
// servidor; a nova segue a política de no mínimo 8 caracteres.
async function changeOwnPassword() {
  const campoAtual = document.getElementById("profile-current-password");
  const campoNova = document.getElementById("profile-new-password");
  const campoConfirmacao = document.getElementById("profile-confirm-password");
  const botao = document.getElementById("btn-change-password");

  const senhaAtual = campoAtual.value;
  const novaSenha = campoNova.value;
  const confirmacao = campoConfirmacao.value;

  if (!senhaAtual) {
    showToast("Informe a sua senha atual.", "warning");
    campoAtual.focus();
    return;
  }
  if (novaSenha.length < 8 || novaSenha.length > 128) {
    showToast("A nova senha deve ter de 8 a 128 caracteres.", "warning");
    campoNova.focus();
    return;
  }
  if (novaSenha !== confirmacao) {
    showToast("A confirmação não confere com a nova senha.", "warning");
    campoConfirmacao.focus();
    return;
  }

  botao.disabled = true;
  try {
    const response = await apiFetch("/api/profile/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: senhaAtual, newPassword: novaSenha })
    });

    const res = await responsePayload(response);
    if (!response.ok) {
      throw new Error(apiErrorMessage(res, "Não foi possível alterar a senha."));
    }

    campoAtual.value = "";
    campoNova.value = "";
    campoConfirmacao.value = "";
    const painel = document.getElementById("profile-password-panel");
    if (painel) painel.open = false;
    showToast("Senha alterada com sucesso!", "success");
  } catch (error) {
    showToast(error.message || "Erro ao alterar a senha.", "error");
  } finally {
    botao.disabled = false;
  }
}

// ============================================================
// GRÁFICO TEMPORAL COM FILTROS E DRILL-DOWN (Tarefa 20)
// ============================================================

const MESES_PT = [
  "Jan",
  "Fev",
  "Mar",
  "Abr",
  "Mai",
  "Jun",
  "Jul",
  "Ago",
  "Set",
  "Out",
  "Nov",
  "Dez"
];

const timeseries = {
  carregado: false,
  filtros: { years: [], months: [], days: [] },
  pontos: []
};

function valoresSelecionados(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return [];
  return Array.from(select.selectedOptions).map((opcao) => Number(opcao.value));
}

function preencherFiltro(selectId, valores, rotulos, selecionados) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const marcados = new Set(selecionados);
  clearElement(select);
  valores.forEach((valor) => {
    const opcao = createElement("option", {
      text: rotulos ? rotulos(valor) : String(valor),
      attributes: { value: String(valor) }
    });
    if (marcados.has(valor)) opcao.selected = true;
    select.appendChild(opcao);
  });
}

async function carregarGraficoTemporal() {
  const parametros = new URLSearchParams();
  timeseries.filtros.years.forEach((ano) => parametros.append("years", ano));
  timeseries.filtros.months.forEach((mes) => parametros.append("months", mes));
  timeseries.filtros.days.forEach((dia) => parametros.append("days", dia));

  try {
    const response = await apiFetch(`/api/analytics/timeseries?${parametros.toString()}`);
    if (!response.ok) throw new Error("Falha ao carregar a linha do tempo.");
    const dados = await response.json();
    timeseries.pontos = dados.points;
    timeseries.carregado = true;

    preencherFiltro("filter-years", dados.available.years, null, timeseries.filtros.years);
    preencherFiltro(
      "filter-months",
      dados.available.months,
      (mes) => MESES_PT[mes - 1],
      timeseries.filtros.months
    );
    preencherFiltro("filter-days", dados.available.days, null, timeseries.filtros.days);

    renderGraficoTemporal(dados.points);
  } catch (error) {
    console.error("Erro no gráfico temporal:", error);
    const container = document.getElementById("timeseries-chart");
    if (container) {
      clearElement(container);
      container.appendChild(
        createElement("span", {
          className: "chart-empty-state",
          text: "Não foi possível carregar."
        })
      );
    }
  }
}

// Desenha barras SVG proporcionais, clicáveis para abrir o drill-down real.
function renderGraficoTemporal(pontos) {
  const container = document.getElementById("timeseries-chart");
  if (!container) return;
  clearElement(container);

  if (!pontos || pontos.length === 0) {
    container.appendChild(
      createElement("span", {
        className: "chart-empty-state",
        text: "Sem dados no período selecionado."
      })
    );
    return;
  }

  const maxHoras = Math.max(...pontos.map((ponto) => ponto.total_hours), 1);
  const larguraBarra = 100 / pontos.length;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 100 60");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("timeseries-svg");

  pontos.forEach((ponto, indice) => {
    const altura = (ponto.total_hours / maxHoras) * 50;
    const x = indice * larguraBarra + larguraBarra * 0.15;
    const largura = larguraBarra * 0.7;
    const y = 55 - altura;

    const barra = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    barra.setAttribute("x", String(x));
    barra.setAttribute("y", String(y));
    barra.setAttribute("width", String(largura));
    barra.setAttribute("height", String(Math.max(altura, 0.5)));
    barra.setAttribute("rx", "0.6");
    barra.classList.add("timeseries-bar");
    barra.dataset.date = ponto.date;

    const titulo = document.createElementNS("http://www.w3.org/2000/svg", "title");
    titulo.textContent = `${formatDatePtBr(ponto.date)} — ${ponto.total_hours}h em ${ponto.events} compromisso(s)`;
    barra.appendChild(titulo);

    barra.addEventListener("click", () => abrirDrilldownTemporal(ponto.date));
    svg.appendChild(barra);
  });

  container.appendChild(svg);
}

// Drill-down: tabela editável dos compromissos reais do dia clicado.
async function abrirDrilldownTemporal(dateIso) {
  const painel = document.getElementById("timeseries-drilldown");
  const corpo = document.getElementById("timeseries-drilldown-body");
  const titulo = document.getElementById("timeseries-drilldown-title");
  if (!painel || !corpo) return;

  try {
    const response = await apiFetch(`/api/analytics/drilldown?date=${encodeURIComponent(dateIso)}`);
    if (!response.ok) throw new Error("Falha ao carregar os detalhes do dia.");
    const dados = await response.json();

    titulo.textContent = `Detalhes de ${formatDatePtBr(dateIso)}`;
    clearElement(corpo);

    if (dados.events.length === 0) {
      const linha = createElement("tr");
      linha.appendChild(
        createElement("td", { text: "Nenhum compromisso neste dia.", attributes: { colspan: "6" } })
      );
      corpo.appendChild(linha);
    } else {
      dados.events.forEach((evento) => {
        const linha = createElement("tr");
        linha.append(
          createElement("td", { text: evento.title }),
          createElement("td", { text: TITLE_PT[evento.activity_title] || evento.activity_title }),
          createElement("td", { text: evento.start_time }),
          createElement("td", { text: evento.end_time }),
          createElement("td", { text: `${evento.duration_hours}h` })
        );

        const acoes = createElement("td");
        const botoes = createElement("div", { className: "table-actions" });
        const editar = createActionButton({
          className: "btn-icon btn-edit",
          title: "Editar compromisso",
          ariaLabel: `Editar ${evento.title}`,
          icon: createIcon("edit", { width: 14, height: 14 })
        });
        editar.addEventListener("click", () => {
          openAgendaModal(evento.id);
        });
        const excluir = createActionButton({
          className: "btn-icon btn-delete",
          title: "Excluir compromisso",
          ariaLabel: `Excluir ${evento.title}`,
          icon: createIcon("delete", { width: 14, height: 14 })
        });
        excluir.addEventListener("click", () => deleteAgendaEvent(evento.id));
        botoes.append(editar, excluir);
        acoes.appendChild(botoes);
        linha.appendChild(acoes);
        corpo.appendChild(linha);
      });
    }

    painel.classList.remove("hidden");
    painel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } catch (error) {
    showToast(error.message || "Erro ao abrir os detalhes.", "error");
  }
}

// ============================================================
// CONSTRUTOR DE GRÁFICOS PERSONALIZADOS (Tarefa 21)
// ============================================================

const chartsBuilder = { catalog: null, charts: [] };
const CHART_TYPE_LABEL = {
  bars: "Barras",
  columns: "Colunas",
  donut: "Rosca",
  lines: "Linhas",
  kpi: "Indicador (KPI)",
  funnel: "Funil"
};
const CHART_PALETTE = [
  "#7c6fff",
  "#ff8b5a",
  "#3ddc84",
  "#38bdf8",
  "#f472b6",
  "#facc15",
  "#e5484d",
  "#a78bfa"
];

async function carregarCatalogoDeGraficos() {
  if (chartsBuilder.catalog) return chartsBuilder.catalog;
  const response = await apiFetch("/api/charts/catalog");
  if (!response.ok) throw new Error("Falha ao carregar o catálogo de gráficos.");
  chartsBuilder.catalog = await response.json();
  return chartsBuilder.catalog;
}

async function carregarMeusGraficos() {
  try {
    await carregarCatalogoDeGraficos();
    const response = await apiFetch("/api/charts");
    if (!response.ok) throw new Error("Falha ao carregar seus gráficos.");
    chartsBuilder.charts = await response.json();
    await renderizarMeusGraficos();
  } catch (error) {
    console.error("Erro nos gráficos personalizados:", error);
  }
}

async function renderizarMeusGraficos() {
  const grid = document.getElementById("charts-grid");
  if (!grid) return;
  clearElement(grid);

  if (chartsBuilder.charts.length === 0) {
    grid.appendChild(
      createElement("p", {
        className: "charts-empty-state",
        text: 'Nenhum gráfico ainda. Clique em "Novo gráfico" para criar o primeiro.'
      })
    );
    return;
  }

  for (const chart of chartsBuilder.charts) {
    const card = createElement("div", {
      className: "chart-card",
      attributes: { "data-id": chart.id }
    });
    const header = createElement("div", { className: "chart-card-header" });
    header.append(createElement("h5", { text: chart.title }));

    const acoes = createElement("div", { className: "chart-card-actions" });
    const editar = createActionButton({
      className: "btn-icon btn-edit",
      title: "Editar gráfico",
      ariaLabel: `Editar ${chart.title}`,
      icon: createIcon("edit", { width: 14, height: 14 })
    });
    editar.addEventListener("click", () => abrirConstrutorDeGrafico(chart));
    const duplicar = createActionButton({
      className: "btn-icon",
      title: "Duplicar gráfico",
      ariaLabel: `Duplicar ${chart.title}`,
      text: "⧉"
    });
    duplicar.addEventListener("click", () => duplicarGrafico(chart.id));
    const excluir = createActionButton({
      className: "btn-icon btn-delete",
      title: "Excluir gráfico",
      ariaLabel: `Excluir ${chart.title}`,
      icon: createIcon("delete", { width: 14, height: 14 })
    });
    excluir.addEventListener("click", () => excluirGrafico(chart.id, chart.title));
    acoes.append(editar, duplicar, excluir);
    header.appendChild(acoes);
    card.appendChild(header);

    const corpo = createElement("div", {
      className: "chart-card-body",
      attributes: { id: `chart-body-${chart.id}` }
    });
    card.appendChild(corpo);
    grid.appendChild(card);

    try {
      const response = await apiFetch(`/api/charts/${chart.id}/data`);
      if (!response.ok) throw new Error("Falha ao renderizar.");
      const payload = await response.json();
      desenharGrafico(corpo, chart.chart_type, payload.data);
    } catch {
      corpo.appendChild(
        createElement("span", {
          className: "chart-empty-state",
          text: "Não foi possível carregar."
        })
      );
    }
  }
}

// Renderizador único que cobre todos os tipos visuais com SVG/DOM nativo.
function desenharGrafico(container, tipo, dados) {
  clearElement(container);
  if (!dados || dados.length === 0) {
    container.appendChild(
      createElement("span", {
        className: "chart-empty-state",
        text: "Sem dados para este gráfico."
      })
    );
    return;
  }
  const maximo = Math.max(...dados.map((d) => d.value), 1);
  const total = dados.reduce((soma, d) => soma + d.value, 0) || 1;

  if (tipo === "kpi") {
    const kpi = createElement("div", { className: "chart-kpi" });
    kpi.append(
      createElement("span", {
        className: "chart-kpi-value",
        text: String(Math.round(total * 100) / 100)
      }),
      createElement("span", { className: "chart-kpi-label", text: `${dados.length} categoria(s)` })
    );
    container.appendChild(kpi);
    return;
  }

  if (tipo === "donut") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 42 42");
    svg.classList.add("chart-donut");
    let acumulado = 0;
    dados.forEach((d, i) => {
      const percent = (d.value / total) * 100;
      if (percent <= 0) return;
      const circulo = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circulo.setAttribute("cx", "21");
      circulo.setAttribute("cy", "21");
      circulo.setAttribute("r", "15.915");
      circulo.setAttribute("fill", "transparent");
      circulo.setAttribute("stroke", CHART_PALETTE[i % CHART_PALETTE.length]);
      circulo.setAttribute("stroke-width", "5");
      circulo.setAttribute("stroke-dasharray", `${percent} ${100 - percent}`);
      circulo.setAttribute("stroke-dashoffset", String(100 - acumulado + 25));
      const titulo = document.createElementNS("http://www.w3.org/2000/svg", "title");
      titulo.textContent = `${d.label}: ${d.value}`;
      circulo.appendChild(titulo);
      svg.appendChild(circulo);
      acumulado += percent;
    });
    container.appendChild(svg);
    montarLegenda(container, dados);
    return;
  }

  if (tipo === "lines") {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.classList.add("chart-lines");
    const passo = dados.length > 1 ? 100 / (dados.length - 1) : 0;
    const pontos = dados.map((d, i) => `${i * passo},${48 - (d.value / maximo) * 44}`).join(" ");
    const linha = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    linha.setAttribute("points", pontos);
    linha.setAttribute("fill", "none");
    linha.setAttribute("stroke", CHART_PALETTE[0]);
    linha.setAttribute("stroke-width", "1.5");
    svg.appendChild(linha);
    container.appendChild(svg);
    return;
  }

  // barras (horizontais), colunas (verticais) e funil compartilham a base.
  const wrapper = createElement("div", { className: `chart-${tipo}` });
  const ordenados = tipo === "funnel" ? [...dados].sort((a, b) => b.value - a.value) : dados;
  ordenados.forEach((d, i) => {
    const proporcao = Math.round((d.value / maximo) * 100);
    const item = createElement("div", { className: "chart-bar-item" });
    const rotulo = createElement("span", { className: "chart-bar-label", text: `${d.label}` });
    const trilho = createElement("div", { className: "chart-bar-track" });
    const preenchimento = createElement("div", { className: "chart-bar-fill" });
    // Colunas crescem na vertical (altura); barras/funil na horizontal (largura).
    const estilo =
      tipo === "columns"
        ? { height: `${proporcao}%`, background: CHART_PALETTE[i % CHART_PALETTE.length] }
        : { width: `${proporcao}%`, background: CHART_PALETTE[i % CHART_PALETTE.length] };
    applyDynamicStyles(preenchimento, estilo);
    preenchimento.appendChild(
      createElement("span", { className: "chart-bar-value", text: String(d.value) })
    );
    trilho.appendChild(preenchimento);
    item.append(rotulo, trilho);
    wrapper.appendChild(item);
  });
  container.appendChild(wrapper);
}

function montarLegenda(container, dados) {
  const legenda = createElement("div", { className: "chart-legend" });
  dados.forEach((d, i) => {
    const item = createElement("div", { className: "chart-legend-item" });
    const ponto = createElement("span", { className: "chart-legend-dot" });
    applyDynamicStyles(ponto, { background: CHART_PALETTE[i % CHART_PALETTE.length] });
    item.append(ponto, createElement("span", { text: `${d.label}: ${d.value}` }));
    legenda.appendChild(item);
  });
  container.appendChild(legenda);
}

function opcoesDoCatalogo(objeto, rotulo = "label") {
  return Object.entries(objeto).map(([value, meta]) => ({ value, label: meta[rotulo] || value }));
}

// Diálogo do construtor com prévia em tempo real das combinações.
async function abrirConstrutorDeGrafico(chartExistente = null) {
  const catalogo = await carregarCatalogoDeGraficos();
  const fonteChave = chartExistente?.source || Object.keys(catalogo.sources)[0];
  const fonte = catalogo.sources[fonteChave];

  const resultado = await showAppDialog({
    title: chartExistente ? "Editar gráfico" : "Novo gráfico",
    description:
      "Combine fonte, dimensão, métrica, agregação e visual. A prévia é calculada com seus dados reais.",
    confirmText: chartExistente ? "Salvar gráfico" : "Criar gráfico",
    fields: [
      {
        name: "title",
        label: "Título",
        type: "text",
        required: true,
        value: chartExistente?.title || "",
        minlength: 1,
        maxlength: 120,
        validate: (v) => (v.trim().length >= 1 ? "" : "Informe um título.")
      },
      {
        name: "dimension",
        label: "Dimensão (eixo)",
        type: "select",
        value: chartExistente?.dimension || Object.keys(fonte.dimensions)[0],
        options: opcoesDoCatalogo(fonte.dimensions)
      },
      {
        name: "metric",
        label: "Métrica",
        type: "select",
        value: chartExistente?.metric || Object.keys(fonte.metrics)[0],
        options: opcoesDoCatalogo(fonte.metrics)
      },
      {
        name: "aggregate",
        label: "Agregação",
        type: "select",
        value: chartExistente?.aggregate || "sum",
        options: [
          { value: "sum", label: "Soma" },
          { value: "avg", label: "Média" },
          { value: "count", label: "Contagem" },
          { value: "max", label: "Máximo" },
          { value: "min", label: "Mínimo" }
        ]
      },
      {
        name: "chart_type",
        label: "Tipo de gráfico",
        type: "select",
        value: chartExistente?.chart_type || "bars",
        options: (catalogo.chart_types || []).map((t) => ({
          value: t,
          label: CHART_TYPE_LABEL[t] || t
        }))
      }
    ]
  });
  if (!resultado.confirmed) return;

  const corpo = {
    title: String(resultado.values.title || "").trim(),
    source: fonteChave,
    dimension: resultado.values.dimension,
    metric: resultado.values.metric,
    aggregate: resultado.values.aggregate,
    chart_type: resultado.values.chart_type
  };

  try {
    let response;
    if (chartExistente) {
      response = await apiFetch(`/api/charts/${chartExistente.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
    } else {
      response = await apiFetch("/api/charts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
    }
    const payload = await responsePayload(response);
    if (!response.ok)
      throw new Error(apiErrorMessage(payload, "Não foi possível salvar o gráfico."));
    showToast(chartExistente ? "Gráfico atualizado!" : "Gráfico criado!", "success");
    await carregarMeusGraficos();
  } catch (error) {
    showToast(error.message || "Erro ao salvar o gráfico.", "error");
  }
}

async function duplicarGrafico(chartId) {
  try {
    const response = await apiFetch(`/api/charts/${chartId}/duplicate`, { method: "POST" });
    if (!response.ok) throw new Error("Não foi possível duplicar.");
    showToast("Gráfico duplicado!", "success");
    await carregarMeusGraficos();
  } catch (error) {
    showToast(error.message || "Erro ao duplicar.", "error");
  }
}

async function excluirGrafico(chartId, titulo) {
  const confirmado = await showAppDialog({
    title: "Excluir gráfico",
    description: `Remover "${titulo}"? Os dados-fonte não são afetados.`,
    confirmText: "Excluir",
    cancelText: "Cancelar",
    tone: "danger"
  });
  if (!confirmado.confirmed) return;
  try {
    const response = await apiFetch(`/api/charts/${chartId}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) throw new Error("Não foi possível excluir.");
    showToast("Gráfico excluído.", "success");
    await carregarMeusGraficos();
  } catch (error) {
    showToast(error.message || "Erro ao excluir.", "error");
  }
}

// ============================================================
// CRUD DE CATEGORIAS (Tarefa 19) — criar e editar com cor e ícone
// ============================================================

// Paleta premium de cores e ícones oferecida no diálogo de categoria.
const PALETA_DE_CATEGORIA = [
  { value: "", label: "Cor automática" },
  { value: "#7c6fff", label: "Roxo Kairo 🟣" },
  { value: "#ff8b5a", label: "Laranja Kairo 🟠" },
  { value: "#3ddc84", label: "Verde energia 🟢" },
  { value: "#38bdf8", label: "Azul céu 🔵" },
  { value: "#f472b6", label: "Rosa vibrante 🌸" },
  { value: "#facc15", label: "Amarelo sol 🟡" },
  { value: "#e5484d", label: "Vermelho intenso 🔴" },
  { value: "#a78bfa", label: "Lavanda ✨" }
];

const ICONES_DE_CATEGORIA = [
  { value: "", label: "Sem ícone" },
  { value: "💼", label: "💼 Trabalho" },
  { value: "📚", label: "📚 Estudos" },
  { value: "🏃", label: "🏃 Exercício" },
  { value: "🎮", label: "🎮 Lazer" },
  { value: "🧘", label: "🧘 Autocuidado" },
  { value: "👥", label: "👥 Social" },
  { value: "🎯", label: "🎯 Metas" },
  { value: "💡", label: "💡 Ideias" },
  { value: "🏠", label: "🏠 Casa" },
  { value: "❤️", label: "❤️ Saúde" }
];

// Cria ou edita uma categoria pelo diálogo acessível do app; persiste na API
// real e atualiza os cards sem recarregar a página.
async function abrirDialogoDeCategoria(activityId = null) {
  const editando = activityId !== null;
  const atual = editando
    ? activitiesData.find((atividade) => atividade.id === Number(activityId))
    : null;
  if (editando && !atual) {
    showToast("Categoria não encontrada.", "error");
    return;
  }

  const resultado = await showAppDialog({
    title: editando ? "Editar categoria" : "Nova categoria",
    description: editando
      ? "Ajuste o nome, a cor e o ícone desta categoria."
      : "Crie uma nova categoria para organizar suas horas de foco.",
    assistant: { fieldName: "title" },
    confirmText: editando ? "Salvar categoria" : "Criar categoria",
    fields: [
      {
        name: "title",
        label: "Nome da categoria",
        type: "text",
        required: true,
        value: atual ? TITLE_PT[atual.title] || atual.title : "",
        minlength: 2,
        maxlength: 80,
        validate: (valor) =>
          valor.trim().length >= 2 && valor.trim().length <= 80 ? "" : "Use de 2 a 80 caracteres."
      },
      {
        name: "color",
        label: "Cor do card",
        type: "select",
        value: atual?.color || "",
        options: PALETA_DE_CATEGORIA
      },
      {
        name: "icon",
        label: "Ícone",
        type: "select",
        value: atual?.icon || "",
        options: ICONES_DE_CATEGORIA
      }
    ]
  });
  if (!resultado.confirmed) return;

  const titulo = String(resultado.values.title || "").trim();
  const cor = resultado.values.color || null;
  const icone = resultado.values.icon || null;

  try {
    if (editando) {
      const response = await apiFetch(`/api/activities/${activityId}/meta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titulo, color: cor, icon: icone })
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "Não foi possível atualizar a categoria."));
      }
      showToast("Categoria atualizada!", "success");
    } else {
      const corpo = { title: titulo };
      if (cor) corpo.color = cor;
      if (icone) corpo.icon = icone;
      const response = await apiFetch("/api/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "Não foi possível criar a categoria."));
      }
      showToast("Categoria criada!", "success");
    }
    await refreshData();
  } catch (error) {
    showToast(error.message || "Erro ao salvar a categoria.", "error");
  }
}

// ============================================================
// ZONA DE PERIGO — EXCLUSÃO DEFINITIVA DA PRÓPRIA CONTA (LGPD)
// ============================================================

const FRASE_EXCLUSAO = "EXCLUIR MINHA CONTA";

// Habilita o botão vermelho somente com senha preenchida e frase exata.
function atualizarEstadoBotaoExclusao() {
  const senha = document.getElementById("danger-password");
  const confirmacao = document.getElementById("danger-confirmation");
  const botao = document.getElementById("btn-delete-account");
  if (!senha || !confirmacao || !botao) return;
  botao.disabled = !(senha.value.length > 0 && confirmacao.value === FRASE_EXCLUSAO);
}

async function excluirMinhaConta() {
  const senha = document.getElementById("danger-password").value;
  const confirmacao = document.getElementById("danger-confirmation").value;
  const botao = document.getElementById("btn-delete-account");

  const resultado = await showAppDialog({
    title: "Confirmação final de exclusão",
    description:
      "Esta é a última confirmação. Sua conta, agenda, atividades, metas, recompensas, preferências e a conexão com o Google serão eliminadas de forma definitiva e irreversível. Um comprovante da exclusão será gerado.",
    confirmText: "Excluir definitivamente",
    cancelText: "Manter minha conta",
    tone: "danger"
  });
  if (!resultado.confirmed) return;

  botao.disabled = true;
  try {
    const response = await apiFetch("/api/privacy/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: senha, confirmation: confirmacao })
    });
    const payload = await responsePayload(response);
    if (!response.ok) {
      throw new Error(apiErrorMessage(payload, "Não foi possível excluir a conta."));
    }
    showToast("Conta excluída. Até logo!", "success");
    window.setTimeout(() => {
      window.location.replace("/login");
    }, 900);
  } catch (error) {
    showToast(error.message || "Erro ao excluir a conta.", "error");
    botao.disabled = false;
  }
}

async function savePreferencesModal() {
  const theme = document.getElementById("pref-theme").value;
  const enableConfetti = document.getElementById("pref-confetti").checked;

  try {
    await saveProfilePreferences(
      {
        theme,
        focus_sound: userProfile.focus_sound || "chuva",
        enable_confetti: enableConfetti
      },
      "Preferências aplicadas!"
    );
    closeModal("modal-preferences-overlay");
  } catch (error) {
    showToast(error.message || "Erro ao salvar preferências.", "error");
  }
}

// ============================================================
// SIDEBAR — KPIs E RELÓGIO
// ============================================================

// Sinaliza que a página está saindo. Requisições em voo são canceladas pelo
// navegador nesse momento, e o cancelamento não deve ser confundido com falha.
let paginaSendoDescarregada = false;
window.addEventListener("pagehide", () => {
  paginaSendoDescarregada = true;
});
window.addEventListener("beforeunload", () => {
  paginaSendoDescarregada = true;
});

async function updateKPIs() {
  try {
    const response = await apiFetch("/api/dashboard/kpis");
    if (!response.ok) return;
    const kpis = await response.json();

    document.getElementById("kpi-daily-total").textContent = `${kpis.dailyTotal}hrs`;
    document.getElementById("kpi-weekly-percent").textContent = `${kpis.weeklyGoalPercent}%`;
    applyDynamicStyles(document.getElementById("kpi-weekly-bar"), {
      width: `${kpis.weeklyGoalPercent}%`
    });
    document.getElementById("kpi-activity-count").textContent = kpis.activityCount;
    aplicarFaixaDeDistribuicao(kpis);
  } catch (err) {
    // Sair da página cancela as requisições em voo, e o navegador reporta esse
    // cancelamento como TypeError: Failed to fetch. Não é falha do produto —
    // é a consequência esperada de trocar de tela — mas era registrada como
    // erro, poluindo o console e derrubando o teste que exige a página íntegra.
    //
    // Um cancelamento por navegação se reconhece por não haver mais conexão de
    // rede ou por o documento já estar sendo descarregado; qualquer outra falha
    // continua sendo reportada.
    const cancelado =
      err?.name === "AbortError" ||
      !navigator.onLine ||
      document.visibilityState === "hidden" ||
      paginaSendoDescarregada;
    if (!cancelado) console.error("Erro ao atualizar KPIs:", err);
  }
}

// Converte horas decimais na notação que as pessoas usam: 2.4 vira "2h24".
// O percentual sozinho não diz de quê; a hora absoluta ancora a leitura.
function formatarHoras(horas) {
  const total = Math.max(0, Number(horas) || 0);
  const h = Math.floor(total);
  const min = Math.round((total - h) * 60);
  if (min === 60) return `${h + 1}h`;
  if (min === 0) return `${h}h`;
  return `${h}h${String(min).padStart(2, "0")}`;
}

// Acende ao mesmo tempo a fatia, o item de legenda e o cartão de uma categoria.
// Sem isso, a barra e a grade parecem dois blocos independentes; o realce
// simultâneo mostra que falam do mesmo dado. Vale para o mouse e para o foco
// por teclado.
function realcarCategoria(id, ligado) {
  const alvos = document.querySelectorAll(
    `#grid-section .card[data-id="${id}"], [data-categoria-id="${id}"]`
  );
  alvos.forEach((alvo) => alvo.classList.toggle("categoria-realcada", ligado === true));
}

// Decide, medindo, quais fatias comportam o rótulo de horas. Uma fatia de 4%
// da largura não tem espaço para "23h": o texto sairia cortado ou forçaria a
// fatia a crescer, falseando justamente a proporção que ela representa. Onde
// não cabe, o rótulo é ocultado da vista e permanece na dica e no nome
// acessível — nenhuma informação se perde.
function ajustarRotulosDaFaixa(barra) {
  if (!barra) return;
  [...barra.children].forEach((fatia) => {
    const rotulo = fatia.querySelector(".distribuicao-fatia-horas");
    if (!rotulo) return;
    fatia.classList.remove("sem-rotulo");
    // scrollWidth do rótulo é a largura que ele precisaria; 12px cobrem o
    // respiro lateral mínimo para o texto não encostar na borda arredondada.
    if (rotulo.scrollWidth + 12 > fatia.clientWidth) fatia.classList.add("sem-rotulo");
  });
}

// A largura das fatias muda com a janela, então o que cabia pode deixar de
// caber. Reavalia depois que o navegador assenta o novo tamanho.
let reajusteDaFaixa = null;
window.addEventListener("resize", () => {
  clearTimeout(reajusteDaFaixa);
  reajusteDaFaixa = setTimeout(() => ajustarRotulosDaFaixa(document.getElementById("dist-barra")), 150);
});

// Faixa de distribuição do painel.
//
// A versão anterior desenhava pílulas de largura fixa: "Registrado 30%" não
// ocupava 30% de nada, e o hachurado tomava o resto por sobra de espaço. O olho
// lia aquilo como proporção e a conta não fechava. Agora cada segmento ocupa a
// largura correspondente às horas da sua categoria, então a barra passa a medir
// o que representa — e responde a uma pergunta que nenhum outro elemento do
// painel responde: para onde o tempo foi.
function aplicarFaixaDeDistribuicao(kpis) {
  const faixa = document.getElementById("painel-distribuicao");
  if (!faixa) return;

  const barra = document.getElementById("dist-barra");
  const legenda = document.getElementById("dist-legenda");
  const leitura = document.getElementById("dist-leitura");
  const alvoCategorias = document.getElementById("dist-categorias");
  const termoCategorias = document.getElementById("dist-categorias-termo");

  const lista = Array.isArray(activitiesData) ? activitiesData : [];
  const registradas = lista
    .map((atividade) => ({
      id: atividade.id,
      // Mesmo dicionário dos cartões: as categorias semeadas têm rótulo em
      // inglês no banco, e a faixa não pode exibir "Play" ao lado de um cartão
      // que diz "Lazer".
      titulo: TITLE_PT[atividade.title] || atividade.title,
      cor: atividade.color || null,
      horas: Number((atividade.timeframes?.[activeTimeframe] || {}).current) || 0
    }))
    .filter((item) => item.horas > 0)
    .sort((a, b) => b.horas - a.horas);

  const registrado = registradas.reduce((soma, item) => soma + item.horas, 0);
  const metaDoPeriodo = lista.reduce(
    (soma, atividade) =>
      soma + (Number((atividade.timeframes?.[activeTimeframe] || {}).goal) || 0),
    0
  );

  // Sem meta definida não existe "disponível" a calcular: a barra passa a
  // representar a divisão do que foi registrado, e o texto diz só isso.
  const temMeta = metaDoPeriodo > 0;
  const base = temMeta ? Math.max(metaDoPeriodo, registrado) : registrado;
  const disponivel = temMeta ? Math.max(0, metaDoPeriodo - registrado) : 0;

  const periodo =
    { daily: "hoje", weekly: "nesta semana", monthly: "neste mês" }[activeTimeframe] || "hoje";

  if (leitura) {
    if (registrado <= 0) {
      leitura.textContent = temMeta
        ? `Nenhuma hora registrada ${periodo} — a sua meta é de ${formatarHoras(metaDoPeriodo)}.`
        : `Nenhuma hora registrada ${periodo}.`;
    } else if (temMeta && disponivel > 0) {
      leitura.textContent = `Você registrou ${formatarHoras(registrado)} das ${formatarHoras(metaDoPeriodo)} ${periodo} — restam ${formatarHoras(disponivel)}.`;
    } else if (temMeta) {
      leitura.textContent = `Você registrou ${formatarHoras(registrado)} ${periodo} e alcançou a meta de ${formatarHoras(metaDoPeriodo)}.`;
    } else {
      leitura.textContent = `Você registrou ${formatarHoras(registrado)} ${periodo}, distribuídas em ${registradas.length} ${registradas.length === 1 ? "categoria" : "categorias"}.`;
    }
  }

  // Cor do rótulo escolhida pela luminância do fundo da fatia: as cores das
  // categorias são editáveis pelo usuário, então não dá para fixar branco nem
  // preto. Fórmula relativa da WCAG.
  const rotuloClaroSobre = (cor) => {
    const teste = document.createElement("span");
    teste.style.color = cor;
    document.body.appendChild(teste);
    const lido = getComputedStyle(teste).color.match(/[\d.]+/g);
    teste.remove();
    if (!lido) return true;
    const canal = (v) => {
      const n = Number(v) / 255;
      return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
    };
    const luz =
      0.2126 * canal(lido[0]) + 0.7152 * canal(lido[1]) + 0.0722 * canal(lido[2]);
    // Contraste contra branco menor que contra preto significa fundo claro.
    return (1.05 / (luz + 0.05)) >= ((luz + 0.05) / 0.05);
  };

  // Leva ao cartão da categoria, que já traz o detalhe completo. A faixa deixa
  // de ser só leitura e vira atalho para o dado.
  //
  // O painel é aberto pela própria função, e não por um clique sintético no
  // cartão: quem escuta o clique é o .inner-card, então disparar o evento no
  // .card não produzia efeito nenhum.
  const abrirCategoria = (id) => {
    const cartao = document.querySelector(`#grid-section .card[data-id="${id}"]`);
    if (!cartao) return;
    cartao.scrollIntoView({ behavior: "smooth", block: "center" });
    openInlineAgendaPanel(parseInt(cartao.dataset.id, 10), cartao.dataset.title);
  };

  const PALETA_APOIO = ["#2f302f", "#d8a13a", "#6c7f6a", "#8a6d8f", "#4a6d8c", "#b0714a"];

  if (barra) {
    barra.replaceChildren();
    barra.setAttribute("role", "group");
    barra.setAttribute(
      "aria-label",
      registrado > 0
        ? `Distribuição do tempo registrado ${periodo}. Selecione uma categoria para abrir o detalhe.`
        : `Nenhum tempo registrado ${periodo}.`
    );

    registradas.forEach((item, indice) => {
      const corDaFatia = item.cor || PALETA_APOIO[indice % PALETA_APOIO.length];
      // Botão de verdade: alcançável por Tab, acionável por Enter e Espaço.
      const fatia = createElement("button", {
        className: "distribuicao-fatia",
        attributes: {
          type: "button",
          title: `${item.titulo} — ${formatarHoras(item.horas)}`,
          "aria-label": `${item.titulo}, ${formatarHoras(item.horas)}. Abrir categoria.`
        },
        dataset: { categoriaId: item.id }
      });
      if (!rotuloClaroSobre(corDaFatia)) fatia.classList.add("distribuicao-fatia-escura");
      const largura = base > 0 ? (item.horas / base) * 100 : 0;
      applyDynamicStyles(fatia, { width: `${largura}%`, "--fatia-cor": corDaFatia });
      fatia.appendChild(
        createElement("span", {
          className: "distribuicao-fatia-horas",
          text: formatarHoras(item.horas)
        })
      );
      fatia.addEventListener("click", () => abrirCategoria(item.id));
      fatia.addEventListener("mouseenter", () => realcarCategoria(item.id, true));
      fatia.addEventListener("mouseleave", () => realcarCategoria(item.id, false));
      // Teclado percorre a faixa sem passar o mouse: o mesmo realce precisa
      // acompanhar o foco, senão quem navega por Tab não vê a correspondência.
      fatia.addEventListener("focus", () => realcarCategoria(item.id, true));
      fatia.addEventListener("blur", () => realcarCategoria(item.id, false));
      barra.appendChild(fatia);
    });

    if (disponivel > 0) {
      const livre = createElement("span", {
        className: "distribuicao-fatia distribuicao-fatia-livre",
        attributes: { title: `Disponível — ${formatarHoras(disponivel)}` }
      });
      applyDynamicStyles(livre, { width: `${(disponivel / base) * 100}%` });
      livre.appendChild(
        createElement("span", {
          className: "distribuicao-fatia-horas",
          text: formatarHoras(disponivel)
        })
      );
      barra.appendChild(livre);
    }

    // O rótulo só aparece onde cabe: numa fatia estreita ele sairia cortado ou
    // empurraria a largura, que é justamente a informação. Some da vista, mas
    // permanece na dica e no nome acessível.
    ajustarRotulosDaFaixa(barra);
  }

  if (legenda) {
    legenda.replaceChildren();
    registradas.forEach((item, indice) => {
      const corDaFatia = item.cor || PALETA_APOIO[indice % PALETA_APOIO.length];
      // As horas saem daqui: agora elas moram dentro da própria fatia, e
      // repeti-las na legenda só duplicaria a mesma informação.
      const botao = createElement("button", {
        className: "distribuicao-item",
        attributes: {
          type: "button",
          "aria-label": `${item.titulo}, ${formatarHoras(item.horas)}. Abrir categoria.`
        },
        dataset: { categoriaId: item.id }
      });
      const marca = createElement("i", { className: "distribuicao-marca" });
      applyDynamicStyles(marca, { "--fatia-cor": corDaFatia });
      botao.appendChild(marca);
      botao.appendChild(createElement("span", { text: item.titulo }));
      botao.addEventListener("click", () => abrirCategoria(item.id));
      botao.addEventListener("mouseenter", () => realcarCategoria(item.id, true));
      botao.addEventListener("mouseleave", () => realcarCategoria(item.id, false));
      botao.addEventListener("focus", () => realcarCategoria(item.id, true));
      botao.addEventListener("blur", () => realcarCategoria(item.id, false));
      const entrada = createElement("li");
      entrada.appendChild(botao);
      legenda.appendChild(entrada);
    });
    if (disponivel > 0) {
      const entrada = createElement("li", { className: "distribuicao-item-livre" });
      const marca = createElement("i", { className: "distribuicao-marca" });
      entrada.appendChild(marca);
      entrada.appendChild(createElement("span", { text: "Disponível" }));
      legenda.appendChild(entrada);
    }
  }

  // A contagem de categorias sai da barra: ela é um total, não uma proporção, e
  // na mesma linha das horas induzia a lê-la na mesma escala.
  const quantas = Number(kpis.activityCount) || 0;
  if (alvoCategorias) alvoCategorias.textContent = quantas;
  if (termoCategorias) {
    termoCategorias.textContent = quantas === 1 ? "categoria ativa" : "categorias ativas";
  }
}

function initClock() {
  function updateClock() {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    document.getElementById("kpi-clock").textContent = `${hours}:${minutes}`;
  }
  updateClock();
  setInterval(updateClock, 1000);
}

// ============================================================
// CARDS — RENDERIZAÇÃO E CLIQUE EXPANSÍVEL (DASHBOARD)
// ============================================================

function renderCards() {
  const gridSection = document.getElementById("grid-section");
  clearElement(gridSection);

  // Categoria em destaque: a que acumulou mais horas no período ativo. O
  // realce é derivado do dado real, e não de uma posição fixa na grade — se o
  // usuário mudar de ritmo, o destaque acompanha.
  const lideranca = activitiesData.reduce(
    (melhor, atual) => {
      const horas = (atual.timeframes?.[activeTimeframe] || {}).current || 0;
      return horas > melhor.horas ? { id: atual.id, horas } : melhor;
    },
    { id: null, horas: 0 }
  );

  // A grade segue as horas do período, da maior para a menor. Antes a ordem
  // vinha do cadastro, então o cartão em destaque podia aparecer depois de
  // outros com menos tempo — e a numeração 01, 02, 03 sugeria uma ordem de
  // importância que os números desmentiam. Ordenar aqui alinha os cartões à
  // faixa de distribuição, que já lê o mesmo período na mesma sequência.
  // Empate mantém a ordem de cadastro, para a grade não dançar sem motivo.
  const horasNoPeriodo = (atividade) =>
    Number((atividade.timeframes?.[activeTimeframe] || {}).current) || 0;
  const naOrdemDeExibicao = [...activitiesData].sort(
    (a, b) => horasNoPeriodo(b) - horasNoPeriodo(a)
  );

  naOrdemDeExibicao.forEach((activity) => {
    const color = CARD_COLORS[activity.title] || "orange";
    const titlePt = TITLE_PT[activity.title] || activity.title;
    const config = TIMEFRAMES_CONFIG[activeTimeframe];
    const tf = activity.timeframes[activeTimeframe] || { current: 0, previous: 0 };
    const goalHours =
      activity.goals && activity.goals[activeTimeframe] ? activity.goals[activeTimeframe] : 0;

    const emDestaque = lideranca.id === activity.id && lideranca.horas > 0;
    const card = createElement("div", {
      className:
        `card ${color}` +
        (activity.color ? " card-custom-color" : "") +
        (emDestaque ? " card-destaque" : ""),
      dataset: { title: activity.title, id: activity.id }
    });
    // Cor personalizada da categoria (Tarefa 19): aplicada por variável CSS
    // dinâmica, sem atributo style inline, respeitando a CSP endurecida.
    if (activity.color) applyDynamicStyles(card, { "--categoria-cor": activity.color });

    let progressPercent = 0;
    let progressClass = "";
    if (goalHours > 0) {
      progressPercent = Math.min(Math.round((tf.current / goalHours) * 100), 100);
      if (tf.current > goalHours) progressClass = "exceeded";
    }

    const innerCard = createElement("div", { className: "inner-card" });
    const topSection = createElement("div", { className: "top-section" });
    const tituloCard = createElement("p");
    if (activity.icon) {
      tituloCard.append(
        createElement("span", { className: "card-icon", text: activity.icon }),
        document.createTextNode(` ${titlePt}`)
      );
    } else {
      tituloCard.textContent = titlePt;
    }
    topSection.appendChild(tituloCard);

    const dropdownWrapper = createElement("div", { className: "card-dropdown-anchor" });
    const ellipsisButton = createActionButton({
      className: "ellipsis-btn",
      title: `Opções de ${titlePt}`,
      ariaLabel: `Opções de ${titlePt}`,
      dataset: { id: activity.id, title: activity.title },
      icon: createIcon("ellipsis", { width: 18, height: 18, fill: "currentColor" })
    });

    const dropdown = createElement("div", {
      className: "card-dropdown",
      attributes: { id: `dropdown-${activity.id}` }
    });

    const actions = [
      { action: "edit", label: "Editar Horas", icon: "edit", danger: false },
      { action: "goal", label: "Definir Meta", icon: "goal", danger: false },
      { action: "category", label: "Editar Categoria", icon: "edit", danger: false },
      { action: "details", label: "Ver Detalhes", icon: "details", danger: false },
      { action: "delete", label: "Excluir", icon: "delete", danger: true }
    ];

    actions.forEach((item, index) => {
      if (index === actions.length - 1) {
        dropdown.appendChild(createElement("div", { className: "dropdown-divider" }));
      }
      const actionButton = createActionButton({
        className: `dropdown-item${item.danger ? " danger" : ""}`,
        title: item.label,
        dataset: { action: item.action, id: activity.id, title: activity.title },
        icon: createIcon(item.icon, { width: 16, height: 16 }),
        text: item.label
      });
      dropdown.appendChild(actionButton);
    });

    dropdownWrapper.append(ellipsisButton, dropdown);
    topSection.appendChild(dropdownWrapper);

    const timeDuration = createElement("div", { className: "time-duration" });
    timeDuration.append(
      createElement("h1", { text: `${tf.current}hrs` }),
      createElement("small", { text: `${config.label} - ${tf.previous}hrs` })
    );

    const goalProgress = createElement("div", {
      className: `goal-progress${goalHours > 0 ? " visible" : ""}`,
      attributes: { id: `progress-${activity.id}` }
    });
    const goalLabel = createElement("div", { className: "goal-progress-label" });
    goalLabel.append(
      createElement("span", { text: `Meta: ${goalHours}hrs` }),
      createElement("span", { text: `${progressPercent}%` })
    );
    const goalTrack = createElement("div", { className: "goal-progress-track" });
    const goalFill = createElement("div", {
      className: `goal-progress-fill${progressClass ? ` ${progressClass}` : ""}`
    });
    applyDynamicStyles(goalFill, { width: `${progressPercent}%` });
    goalTrack.appendChild(goalFill);
    goalProgress.append(goalLabel, goalTrack);

    innerCard.append(topSection, timeDuration, goalProgress);
    card.appendChild(innerCard);

    gridSection.appendChild(card);
  });

  // Vincular eventos dos dropdowns
  initCardDropdowns();

  // Sentido inverso do realce: o cartão acende a sua fatia e o seu item de
  // legenda na faixa de distribuição.
  document.querySelectorAll("#grid-section .card").forEach((cartao) => {
    const id = cartao.dataset.id;
    if (!id) return;
    cartao.addEventListener("mouseenter", () => realcarCategoria(id, true));
    cartao.addEventListener("mouseleave", () => realcarCategoria(id, false));
  });

  // Vincular clique no corpo do card (abrir painel expansível de agenda inline)
  document.querySelectorAll(".inner-card").forEach((innerCard) => {
    innerCard.addEventListener("click", (e) => {
      if (e.target.closest(".ellipsis-btn") || e.target.closest(".card-dropdown")) {
        return;
      }
      const cardContainer = innerCard.closest(".card");
      const activityId = parseInt(cardContainer.dataset.id);
      const title = cardContainer.dataset.title;
      openInlineAgendaPanel(activityId, title);
    });
  });
}

function initCardDropdowns() {
  document.querySelectorAll(".ellipsis-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      closeAllDropdowns();
      const dropdown = document.getElementById(`dropdown-${id}`);
      dropdown.classList.toggle("open");
    });
  });

  document.querySelectorAll(".dropdown-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      const id = parseInt(item.dataset.id);
      const title = item.dataset.title;
      closeAllDropdowns();

      switch (action) {
        case "edit":
          openEditModal(id, title);
          break;
        case "goal":
          openGoalModal(id, title);
          break;
        case "category":
          abrirDialogoDeCategoria(id);
          break;
        case "details":
          openDetailsModal(id, title);
          break;
        case "delete":
          openDeleteModal(id, title);
          break;
      }
    });
  });
}

function closeAllDropdowns() {
  document.querySelectorAll(".card-dropdown.open").forEach((d) => d.classList.remove("open"));
}

document.addEventListener("click", () => closeAllDropdowns());

// ============================================================
// INTEGRACAO: PAINEL DE AGENDA INLINE (ABAIXO DOS CARDS)
// ============================================================

async function openInlineAgendaPanel(activityId, title) {
  activeInlineActivityId = activityId;
  const panel = document.getElementById("inline-agenda-panel");
  const titlePt = TITLE_PT[title] || title;
  const dot = document.getElementById("inline-agenda-dot");

  const colorHex = {
    Work: "var(--work-color)",
    Play: "var(--play-color)",
    Study: "var(--study-color)",
    Exercise: "var(--exercise-color)",
    Social: "var(--social-color)",
    "Self Care": "var(--care-color)"
  };
  applyDynamicStyles(dot, { background: colorHex[title] || "var(--single-section)" });

  document.getElementById("inline-agenda-title").textContent = `Compromissos — ${titlePt}`;

  await renderInlineAgendaTable(activityId);

  panel.classList.remove("hidden");
  setTimeout(() => {
    panel.classList.add("open");
  }, 10);

  // Sem rolagem automática: o painel nasce logo abaixo da grade, então mover a
  // viewport apenas empurrava os cards para fora da área visível e dava a
  // impressão de que a categoria selecionada havia sumido.
}

async function renderInlineAgendaTable(activityId) {
  const tableBody = document.getElementById("inline-agenda-table-body");
  const emptyState = document.getElementById("inline-agenda-empty");
  clearElement(tableBody);

  try {
    const response = await apiFetch(`/api/activities/${activityId}/agenda`);
    if (!response.ok) throw new Error("Falha ao buscar agenda");
    const events = await response.json();

    if (events.length === 0) {
      emptyState.classList.remove("hidden");
      document.querySelector(".agenda-table").classList.add("hidden");
    } else {
      emptyState.classList.add("hidden");
      document.querySelector(".agenda-table").classList.remove("hidden");

      events.forEach((ev) => {
        const tr = document.createElement("tr");
        const dateCell = createElement("td", { text: formatDatePtBr(ev.event_date) });
        const titleCell = document.createElement("td");
        titleCell.appendChild(createElement("strong", { text: ev.title }));
        const descriptionCell = createElement("td", { text: ev.description || "-" });
        const durationCell = document.createElement("td");
        durationCell.appendChild(
          createDurationBadge(
            `${ev.start_time} - ${ev.end_time} (${ev.duration_hours}h)`,
            ev.event_color || null
          )
        );
        const actionsCell = document.createElement("td");
        const actions = createElement("div", { className: "table-actions" });
        const editButton = createActionButton({
          className: "btn-icon btn-edit",
          title: "Editar evento",
          ariaLabel: "Editar evento",
          dataset: { id: ev.id },
          icon: createIcon("edit", { width: 14, height: 14 })
        });
        const deleteButton = createActionButton({
          className: "btn-icon btn-delete",
          title: "Excluir evento",
          ariaLabel: "Excluir evento",
          dataset: { id: ev.id },
          icon: createIcon("delete", { width: 14, height: 14 })
        });
        editButton.addEventListener("click", () => openAgendaModal(ev.id));
        deleteButton.addEventListener("click", () => deleteAgendaEvent(ev.id));
        actions.append(editButton, deleteButton);
        actionsCell.appendChild(actions);
        tr.append(dateCell, titleCell, descriptionCell, durationCell, actionsCell);
        tableBody.appendChild(tr);
      });
    }
  } catch (error) {
    console.error("Erro ao buscar agenda inline:", error);
    showToast("Erro ao carregar compromissos", "error");
  }
}

function closeInlineAgendaPanel() {
  const panel = document.getElementById("inline-agenda-panel");
  panel.classList.remove("open");
  setTimeout(() => {
    panel.classList.add("hidden");
  }, 300);
  activeInlineActivityId = null;
}

// ============================================================
// SELETOR DE LAYOUTS DE AGENDA (PAGINA DE AGENDA)
// ============================================================

function initLayoutSelector() {
  const btns = document.querySelectorAll(".layout-btn");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      btns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      activeAgendaLayout = btn.dataset.layout;
      renderAgenda();
    });
  });
}

async function fetchAndRenderAgenda() {
  try {
    const response = await apiFetch("/api/agenda");
    if (!response.ok) throw new Error("Erro ao carregar compromissos");
    agendaEvents = await response.json();
    renderAgenda();
  } catch (error) {
    console.error("Erro ao carregar a agenda:", error);
    showToast("Erro ao carregar compromissos", "error");
  }
}

function renderAgenda() {
  const container = document.getElementById("agenda-timeline");
  container.className = "agenda-timeline"; // reseta classe padrão
  clearElement(container);

  switch (activeAgendaLayout) {
    case "tdah":
      renderLayoutTdah(container);
      break;
    case "atual":
      renderLayoutAtual(container);
      break;
    case "google":
      renderLayoutGoogle(container);
      break;
    case "ticktick":
      renderLayoutTickTick(container);
      break;
    case "morgen":
      renderLayoutMorgen(container);
      break;
    case "todoist":
      renderLayoutTodoist(container);
      break;
    case "kanban":
      renderLayoutKanban(container);
      break;
    case "gantt":
      renderLayoutGantt(container);
      break;
    default:
      renderLayoutAtual(container);
  }
}

// ============================================================
// LAYOUT GANTT (Tarefa 22) — linha do tempo horizontal por hora,
// barras com início/fim reais, arrasto para mover/redimensionar
// com persistência transacional e alternativa acessível em lista.
// ============================================================

const GANTT_HORA_INICIO = 6; // 06:00
const GANTT_HORA_FIM = 24; // 24:00
let ganttZoom = "day"; // day | week | month

function horaParaMinutos(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}

function minutosParaHora(minutos) {
  const total = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutos)));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function renderLayoutGantt(container) {
  container.className = "agenda-timeline agenda-gantt";

  // Barra de controles: zoom e alternativa acessível em lista.
  const controles = createElement("div", { className: "gantt-controls" });
  const grupoZoom = createElement("div", {
    className: "gantt-zoom",
    attributes: { role: "group", "aria-label": "Zoom do Gantt" }
  });
  [
    { key: "day", label: "Dia" },
    { key: "week", label: "Semana" },
    { key: "month", label: "Mês" }
  ].forEach((op) => {
    const botao = createElement("button", {
      className: `gantt-zoom-btn${ganttZoom === op.key ? " active" : ""}`,
      text: op.label,
      attributes: { type: "button", "aria-pressed": ganttZoom === op.key ? "true" : "false" }
    });
    botao.addEventListener("click", () => {
      ganttZoom = op.key;
      renderAgenda();
    });
    grupoZoom.appendChild(botao);
  });
  controles.appendChild(grupoZoom);
  container.appendChild(controles);

  // Alternativa acessível em lista (sempre presente para leitores de tela).
  const listaAcessivel = createElement("div", {
    className: "gantt-a11y-list",
    attributes: { role: "list", "aria-label": "Compromissos em lista" }
  });

  const eventos = [...agendaEvents].sort((a, b) => {
    if (a.event_date !== b.event_date) return a.event_date < b.event_date ? -1 : 1;
    return horaParaMinutos(a.start_time) - horaParaMinutos(b.start_time);
  });

  if (eventos.length === 0) {
    container.appendChild(
      createElement("p", {
        className: "gantt-empty",
        text: "Nenhum compromisso para exibir no Gantt."
      })
    );
    return;
  }

  // Agrupa por data (zoom dia) ou mantém intervalo; agrupamento visual por categoria via cor.
  const porData = new Map();
  eventos.forEach((ev) => {
    if (!porData.has(ev.event_date)) porData.set(ev.event_date, []);
    porData.get(ev.event_date).push(ev);
  });

  const grade = createElement("div", { className: "gantt-grid" });

  // Cabeçalho fixo de horas.
  const cabecalho = createElement("div", { className: "gantt-header" });
  cabecalho.appendChild(
    createElement("div", { className: "gantt-header-label", text: "Data / Categoria" })
  );
  const escala = createElement("div", { className: "gantt-header-scale" });
  for (let h = GANTT_HORA_INICIO; h <= GANTT_HORA_FIM; h += 2) {
    escala.appendChild(
      createElement("span", {
        className: "gantt-hour",
        text: `${String(h % 24).padStart(2, "0")}h`
      })
    );
  }
  cabecalho.appendChild(escala);
  grade.appendChild(cabecalho);

  const totalMinutos = (GANTT_HORA_FIM - GANTT_HORA_INICIO) * 60;

  porData.forEach((eventosDoDia, data) => {
    const linha = createElement("div", { className: "gantt-row" });
    linha.appendChild(
      createElement("div", { className: "gantt-row-label", text: formatDatePtBr(data) })
    );

    const trilha = createElement("div", { className: "gantt-track" });
    eventosDoDia.forEach((ev) => {
      const inicioMin = horaParaMinutos(ev.start_time);
      let fimMin = horaParaMinutos(ev.end_time);
      // Evento que atravessa a meia-noite: limita visualmente ao fim da grade.
      if (fimMin <= inicioMin) fimMin = GANTT_HORA_FIM * 60;

      const esquerda = Math.max(0, ((inicioMin - GANTT_HORA_INICIO * 60) / totalMinutos) * 100);
      const largura = Math.max(2, ((fimMin - inicioMin) / totalMinutos) * 100);
      const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";

      const barra = createElement("button", {
        className: `gantt-bar gantt-bar-${evClass}`,
        attributes: {
          type: "button",
          "data-id": ev.id,
          title: `${ev.title} (${ev.start_time}–${ev.end_time})`,
          "aria-label": `${ev.title}, de ${ev.start_time} a ${ev.end_time}. Clique para editar.`
        }
      });
      const estiloBarra = { left: `${esquerda}%`, width: `${largura}%` };
      if (ev.event_color) estiloBarra["background"] = ev.event_color;
      applyDynamicStyles(barra, estiloBarra);
      barra.appendChild(createElement("span", { className: "gantt-bar-title", text: ev.title }));

      // Alça de redimensionamento (fim do evento).
      const alca = createElement("span", {
        className: "gantt-resize-handle",
        attributes: { "aria-hidden": "true" }
      });
      barra.appendChild(alca);

      // Clique abre a edição (a menos que tenha sido um arrasto).
      barra.addEventListener("click", (e) => {
        if (barra.dataset.dragged === "true") {
          barra.dataset.dragged = "false";
          return;
        }
        e.stopPropagation();
        openAgendaModal(ev.id);
      });

      habilitarArrastoGantt(barra, alca, ev, trilha, totalMinutos);
      trilha.appendChild(barra);
    });

    // Marcador do instante atual: só aparece na linha de hoje e apenas quando
    // o horário corrente está dentro da faixa desenhada na grade.
    const hoje = new Date();
    const dataDeHoje = [
      hoje.getFullYear(),
      String(hoje.getMonth() + 1).padStart(2, "0"),
      String(hoje.getDate()).padStart(2, "0")
    ].join("-");

    if (data === dataDeHoje) {
      const minutosAgora = hoje.getHours() * 60 + hoje.getMinutes();
      const inicioGrade = GANTT_HORA_INICIO * 60;
      if (minutosAgora >= inicioGrade && minutosAgora <= GANTT_HORA_FIM * 60) {
        const marcador = createElement("div", {
          className: "gantt-agora",
          attributes: {
            "aria-hidden": "true",
            title: `Agora: ${String(hoje.getHours()).padStart(2, "0")}:${String(hoje.getMinutes()).padStart(2, "0")}`
          }
        });
        const posicao = ((minutosAgora - inicioGrade) / totalMinutos) * 100;
        applyDynamicStyles(marcador, { left: `${posicao}%` });
        trilha.appendChild(marcador);
      }
    }

    linha.appendChild(trilha);
    grade.appendChild(linha);

    // Item acessível em lista.
    eventosDoDia.forEach((ev) => {
      const item = createElement("div", {
        className: "gantt-a11y-item",
        attributes: { role: "listitem" }
      });
      item.textContent = `${formatDatePtBr(data)} — ${ev.title}: ${ev.start_time} às ${ev.end_time}`;
      listaAcessivel.appendChild(item);
    });
  });

  container.append(grade, listaAcessivel);
}

// Arrasto para mover (corpo) e redimensionar (alça), com persistência real e
// reversão visual em caso de falha da API.
function habilitarArrastoGantt(barra, alca, ev, trilha, totalMinutos) {
  let modo = null; // "move" | "resize"
  let xInicial = 0;
  let esquerdaInicial = 0;
  let larguraInicial = 0;

  function larguraDaTrilha() {
    return trilha.getBoundingClientRect().width || 1;
  }

  function iniciar(e, tipo) {
    modo = tipo;
    xInicial = e.clientX;
    const estilo = barra.getBoundingClientRect();
    const trilhaBox = trilha.getBoundingClientRect();
    esquerdaInicial = ((estilo.left - trilhaBox.left) / trilhaBox.width) * 100;
    larguraInicial = (estilo.width / trilhaBox.width) * 100;
    barra.dataset.dragged = "false";
    document.addEventListener("pointermove", mover);
    document.addEventListener("pointerup", soltar, { once: true });
    e.preventDefault();
    e.stopPropagation();
  }

  function mover(e) {
    if (!modo) return;
    const deltaPercent = ((e.clientX - xInicial) / larguraDaTrilha()) * 100;
    if (Math.abs(e.clientX - xInicial) > 3) barra.dataset.dragged = "true";
    if (modo === "move") {
      const nova = Math.max(0, Math.min(100 - larguraInicial, esquerdaInicial + deltaPercent));
      applyDynamicStyles(barra, { left: `${nova}%`, width: `${larguraInicial}%` });
    } else {
      const nova = Math.max(2, Math.min(100 - esquerdaInicial, larguraInicial + deltaPercent));
      applyDynamicStyles(barra, { left: `${esquerdaInicial}%`, width: `${nova}%` });
    }
  }

  async function soltar() {
    document.removeEventListener("pointermove", mover);
    if (!modo || barra.dataset.dragged !== "true") {
      modo = null;
      return;
    }
    modo = null;

    // Converte a posição visual final em novos horários reais.
    const box = barra.getBoundingClientRect();
    const trilhaBox = trilha.getBoundingClientRect();
    const esquerdaPercent = ((box.left - trilhaBox.left) / trilhaBox.width) * 100;
    const larguraPercent = (box.width / trilhaBox.width) * 100;

    const inicioMin = GANTT_HORA_INICIO * 60 + (esquerdaPercent / 100) * totalMinutos;
    const fimMin = inicioMin + (larguraPercent / 100) * totalMinutos;
    // Alinha em blocos de 5 minutos.
    const novoInicio = minutosParaHora(Math.round(inicioMin / 5) * 5);
    const novoFim = minutosParaHora(Math.round(fimMin / 5) * 5);

    if (novoInicio === ev.start_time && novoFim === ev.end_time) {
      renderAgenda();
      return;
    }

    // Guard client-side: término deve ser posterior ao início no mesmo dia
    // (mesma regra do backend). Evita requisição que seria rejeitada com 422.
    if (horaParaMinutos(novoFim) <= horaParaMinutos(novoInicio)) {
      showToast("O término precisa ser depois do início.", "warning");
      renderAgenda();
      return;
    }

    try {
      const response = await apiFetch(`/api/agenda/${ev.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: ev.title,
          description: ev.description || "",
          event_date: ev.event_date,
          start_time: novoInicio,
          end_time: novoFim,
          activity_id: ev.activity_id,
          priority: ev.priority || "media",
          cognitive_load: ev.cognitive_load || 1,
          event_color: ev.event_color || null
        })
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        throw new Error(apiErrorMessage(payload, "Não foi possível mover o compromisso."));
      }
      showToast("Compromisso atualizado no Gantt.", "success");
      await fetchAndRenderAgenda();
      await refreshData();
    } catch (error) {
      showToast(error.message || "Erro ao mover o compromisso.", "error");
      renderAgenda(); // reverte visualmente para o estado real do banco
    }
  }

  barra.addEventListener("pointerdown", (e) => {
    if (e.target === alca) return;
    iniciar(e, "move");
  });
  alca.addEventListener("pointerdown", (e) => iniciar(e, "resize"));
}

// Injeta botões rápidos (lápis e lixeira) de exclusão e edição direto no card de todos os layouts
function createQuickActionsNode(eventId) {
  const container = createElement("div", { className: "quick-actions-container" });
  container.append(
    createActionButton({
      className: "quick-btn quick-focus",
      title: "Iniciar Modo Foco (Pomodoro)",
      dataset: { id: eventId },
      icon: createIcon("focus", { width: 12, height: 12, strokeWidth: 2.5 })
    }),
    createActionButton({
      className: "quick-btn quick-edit",
      title: "Editar compromisso",
      dataset: { id: eventId },
      icon: createIcon("edit", { width: 12, height: 12, strokeWidth: 2.5 })
    }),
    createActionButton({
      className: "quick-btn quick-delete",
      title: "Excluir compromisso",
      dataset: { id: eventId },
      icon: createIcon("delete", { width: 12, height: 12, strokeWidth: 2.5 })
    })
  );
  return container;
}

function bindQuickActions(element) {
  element.querySelectorAll(".quick-focus").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ev = agendaEvents.find((item) => item.id === parseInt(btn.dataset.id));
      if (ev) openFocusMode(ev);
    });
  });

  element.querySelectorAll(".quick-edit").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openAgendaModal(parseInt(btn.dataset.id));
    });
  });

  element.querySelectorAll(".quick-delete").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteAgendaEvent(parseInt(btn.dataset.id));
    });
  });
}

// ============================================================
// LAYOUT 0: FOCO TEA/TDAH (Visual Clean Inclusivo)
// ============================================================

function renderLayoutTdah(container) {
  container.classList.remove("agenda-timeline");

  const todayStr = new Date().toISOString().split("T")[0];
  const todayEvents = agendaEvents.filter((ev) => ev.event_date === todayStr);

  // Calcular carga cognitiva total de hoje
  let totalCognitiveLoad = 0;
  todayEvents.forEach((ev) => {
    if (!ev.is_completed) {
      totalCognitiveLoad += ev.cognitive_load || 1;
    }
  });

  // Recomendações TDAH/TEA baseadas em carga mental
  let batteryPercent = 100;
  let batteryColor = "var(--success-color)";
  let advice = "Sua bateria mental está ótima! Dia excelente para realizar novas tarefas.";

  if (totalCognitiveLoad >= 3 && totalCognitiveLoad <= 5) {
    batteryPercent = 70;
    batteryColor = "var(--care-color)";
    advice = "Bateria boa. Equilibre o ritmo e planeje pequenos descansos entre as atividades.";
  } else if (totalCognitiveLoad >= 6 && totalCognitiveLoad <= 8) {
    batteryPercent = 40;
    batteryColor = "var(--work-color)";
    advice = "Bateria mental em nível moderado. Dê preferência a atividades leves.";
  } else if (totalCognitiveLoad > 8) {
    batteryPercent = 15;
    batteryColor = "var(--danger-color)";
    advice =
      "Bateria esgotada! Altamente recomendado focar em relaxamento e pausas para evitar sobrecarga.";
  }

  const tdahContainer = document.createElement("div");
  tdahContainer.className = "tdah-layout-container";

  // Card da Bateria Mental
  const batteryCard = createElement("div", { className: "mental-battery-card" });
  const batteryContent = createElement("div", { className: "mental-battery-copy" });
  batteryContent.append(
    createElement("h4", { className: "mental-battery-title", text: "Bateria Mental para Hoje" }),
    createElement("p", { className: "mental-battery-advice", text: advice })
  );
  const batteryGraphic = createElement("div", { className: "mental-battery-graphic" });
  const batterySvg = createSvgElement("svg", {
    width: 80,
    height: 80,
    viewBox: "0 0 36 36",
    class: "mental-battery-ring"
  });
  batterySvg.append(
    createSvgElement("path", {
      d: "M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831",
      fill: "none",
      stroke: "rgba(255,255,255,0.06)",
      "stroke-width": 3
    }),
    createSvgElement("path", {
      d: "M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831",
      fill: "none",
      stroke: batteryColor,
      "stroke-width": 3.5,
      "stroke-dasharray": `${batteryPercent}, 100`,
      "stroke-linecap": "round",
      class: "mental-battery-ring-progress"
    })
  );
  batteryGraphic.append(
    batterySvg,
    createElement("span", { className: "mental-battery-percent-text", text: `${batteryPercent}%` })
  );
  batteryCard.append(batteryContent, batteryGraphic);
  tdahContainer.appendChild(batteryCard);

  // Grid de Cartões estilo PECS
  const pecsGrid = document.createElement("div");
  pecsGrid.className = "tdah-pecs-grid";

  if (todayEvents.length === 0) {
    const emptyState = createStateMessage(
      "Nenhuma atividade agendada para hoje. Aproveite para relaxar!"
    );
    emptyState.classList.add("agenda-empty-state-featured");
    pecsGrid.appendChild(emptyState);
  } else {
    todayEvents.forEach((ev) => {
      const card = document.createElement("div");
      const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
      const titlePt = TITLE_PT[ev.activity_title] || ev.activity_title;
      const emoji = CATEGORY_PICTOGRAMS[ev.activity_title] || "📋";
      const effort = "⚡".repeat(ev.cognitive_load || 1);

      card.className = `tdah-pecs-card ${ev.is_completed ? "completed" : ""}`;
      applyDynamicStyles(card, {
        opacity: ev.is_completed ? "0.5" : "1",
        "border-left": `5px solid ${ev.event_color || `var(--${evClass}-color)`}`
      });

      const badgeRow = createElement("div", { className: "tdah-card-badge-row" });
      badgeRow.append(
        createElement("span", {
          className: `tdah-prio-badge ${ev.priority}`,
          text: ev.priority.toUpperCase()
        }),
        createElement("span", {
          className: "tdah-effort-indicator",
          text: effort,
          attributes: { title: "Carga Cognitiva" }
        })
      );

      const bodyRow = createElement("div", { className: "tdah-card-body-row" });
      const iconContainer = createElement("div", {
        className: "tdah-card-icon-container",
        text: emoji
      });
      applyDynamicStyles(iconContainer, {
        background: "rgba(255,255,255,0.04)",
        border: `1.5px solid ${ev.event_color || `var(--${evClass}-color)`}`
      });
      const content = createElement("div", { className: "tdah-card-body-copy" });
      const titleNode = createElement("div", { className: "tdah-card-title", text: ev.title });
      if (ev.is_completed) applyDynamicStyles(titleNode, { "text-decoration": "line-through" });
      content.append(
        titleNode,
        createElement("div", {
          className: "tdah-card-desc",
          text: ev.description || "Sem descrição adicional"
        })
      );
      bodyRow.append(iconContainer, content);

      const footer = createElement("div", { className: "tdah-card-footer" });
      const actionRow = createElement("div", { className: "tdah-card-actions" });
      actionRow.appendChild(createQuickActionsNode(ev.id));
      if (!ev.is_completed) {
        actionRow.appendChild(
          createElement("button", {
            className: "btn-focus",
            text: "🎯 Focar",
            attributes: { type: "button" }
          })
        );
      }
      const badge = createDurationBadge(`${ev.start_time} - ${ev.end_time}`);
      badge.classList.add("event-duration-badge-inline");
      footer.append(badge, actionRow);

      card.append(badgeRow, bodyRow, footer);

      // Eventos de clique
      if (!ev.is_completed) {
        card.querySelector(`.btn-focus`).addEventListener("click", (e) => {
          e.stopPropagation();
          openFocusMode(ev);
        });
      }
      card.addEventListener("click", () => openAgendaModal(ev.id));
      pecsGrid.appendChild(card);
    });
  }

  tdahContainer.appendChild(pecsGrid);
  container.appendChild(tdahContainer);
  bindQuickActions(container);
}

// ============================================================
// LAYOUT 1: TIMELINE VERTICAL (ATUAL)
// ============================================================

function renderLayoutAtual(container) {
  if (agendaEvents.length === 0) {
    container.appendChild(createStateMessage("Nenhum compromisso agendado."));
    return;
  }

  const grouped = {};
  agendaEvents.forEach((ev) => {
    if (!grouped[ev.event_date]) grouped[ev.event_date] = [];
    grouped[ev.event_date].push(ev);
  });

  const sortedDates = Object.keys(grouped).sort();

  sortedDates.forEach((dateStr) => {
    const groupDiv = document.createElement("div");
    groupDiv.className = "timeline-group";

    const dateHeader = document.createElement("div");
    dateHeader.className = "timeline-date-header";
    dateHeader.textContent = formatDatePtBr(dateStr);
    groupDiv.appendChild(dateHeader);

    const containerEvents = document.createElement("div");
    containerEvents.className = "timeline-events-container";

    grouped[dateStr].forEach((ev) => {
      const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
      const titlePt = TITLE_PT[ev.activity_title] || ev.activity_title;
      const effort = "⚡".repeat(ev.cognitive_load || 1);

      const card = document.createElement("div");
      card.className = `timeline-event-card ${evClass} ${ev.is_completed ? "completed" : ""}`;
      if (ev.event_color) {
        applyDynamicStyles(card, { "border-left-color": ev.event_color });
      }

      const timeInfo = createElement("div", { className: "event-time-info" });
      timeInfo.appendChild(
        createDurationBadge(`${ev.start_time} - ${ev.end_time}`, ev.event_color || null)
      );

      const details = createElement("div", { className: "event-details" });
      if (ev.is_completed) {
        applyDynamicStyles(details, { "text-decoration": "line-through", opacity: "0.5" });
      }
      const titleRow = createElement("div", { className: "event-title event-title-row" });
      titleRow.append(
        document.createTextNode(ev.title),
        createElement("span", {
          className: `tdah-prio-badge ${ev.priority} tdah-prio-badge-inline`,
          text: ev.priority
        }),
        createElement("span", { className: "event-effort-text", text: effort })
      );
      const description = createElement("div", {
        className: "event-desc",
        text: `${titlePt}${ev.description ? ` • ${ev.description}` : ""}`
      });
      details.append(titleRow, description);

      const actionWrap = createElement("div", { className: "timeline-event-actions" });
      actionWrap.appendChild(createQuickActionsNode(ev.id));
      card.append(timeInfo, details, actionWrap);

      card.addEventListener("click", () => openAgendaModal(ev.id));
      containerEvents.appendChild(card);
    });

    groupDiv.appendChild(containerEvents);
    container.appendChild(groupDiv);
  });

  bindQuickActions(container);
}

// ============================================================
// LAYOUT 2: GOOGLE AGENDA (Grade Semanal)
// ============================================================

// Chave de persistência das larguras das colunas do Google Agenda
const GOOGLE_COLS_KEY = "kairo_google_col_widths";
const GOOGLE_COL_MIN = 90; // px
const GOOGLE_COL_MAX = 600; // px

// Lê as larguras salvas (array de 7 números em px) ou null se não personalizadas
function getGoogleColWidths() {
  try {
    const raw = localStorage.getItem(GOOGLE_COLS_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length === 7 && arr.every((n) => typeof n === "number")) {
      return arr;
    }
  } catch (e) {
    /* ignora dados corrompidos */
  }
  return null;
}

function saveGoogleColWidths(arr) {
  localStorage.setItem(GOOGLE_COLS_KEY, JSON.stringify(arr));
}

// Monta o grid-template-columns: 1ª coluna (Horário) fixa; dias em px ou minmax/1fr
function applyGoogleGridTemplate(grid, widths) {
  if (widths) {
    applyDynamicStyles(grid, {
      "grid-template-columns": `80px ${widths.map((w) => `${w}px`).join(" ")}`,
      width: "max-content"
    });
  } else {
    applyDynamicStyles(grid, {
      "grid-template-columns": "80px repeat(7, minmax(140px, 1fr))",
      width: "100%"
    });
  }
}

function renderLayoutGoogle(container) {
  container.classList.remove("agenda-timeline");

  const weekDays = getWeekDays();
  const dayNamesShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  // Wrapper com rolagem horizontal (permite colunas maiores que a viewport)
  const scrollWrap = document.createElement("div");
  scrollWrap.className = "google-calendar-scroll";

  const grid = document.createElement("div");
  grid.className = "google-calendar-grid";

  // Cabeçalho "Horário" com botão de reset das larguras personalizadas
  const timeHeader = createElement("div", { className: "google-time-header", text: "Horário" });
  timeHeader.appendChild(
    createActionButton({
      className: "google-cols-reset",
      title: "Restaurar largura padrão das colunas",
      icon: createIcon("reset", { width: 10, height: 10, strokeWidth: 2.5 }),
      text: "Redefinir",
      attributes: { id: "google-cols-reset" }
    })
  );
  grid.appendChild(timeHeader);

  weekDays.forEach((dayStr, idx) => {
    const d = new Date(dayStr + "T00:00:00");
    const dayLabel = `${dayNamesShort[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
    const header = createElement("div", {
      className: "google-day-header",
      text: dayLabel,
      dataset: { colIndex: idx }
    });
    header.appendChild(
      createElement("span", {
        className: "google-col-resizer",
        dataset: { colIndex: idx },
        attributes: { title: "Arraste para redimensionar (duplo-clique para redefinir)" }
      })
    );
    grid.appendChild(header);
  });

  const timeSlots = ["07:00", "09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"];

  timeSlots.forEach((time) => {
    grid.appendChild(createElement("div", { className: "google-time-cell", text: time }));

    weekDays.forEach((dayStr) => {
      const cell = document.createElement("div");
      cell.className = "google-day-cell";

      const hourVal = parseInt(time.split(":")[0]);
      const dayEvents = agendaEvents.filter((ev) => {
        if (ev.event_date !== dayStr) return false;
        const evStartHour = parseInt(ev.start_time.split(":")[0]);
        return evStartHour >= hourVal && evStartHour < hourVal + 2;
      });

      dayEvents.forEach((ev) => {
        const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
        const block = document.createElement("div");
        block.className = `google-event-block ${evClass}`;
        applyDynamicStyles(block, {
          opacity: ev.is_completed ? "0.5" : "1",
          "text-decoration": ev.is_completed ? "line-through" : "none"
        });

        if (ev.event_color) {
          applyDynamicStyles(block, {
            background: `${ev.event_color}25`,
            color: ev.event_color,
            "border-left-color": ev.event_color
          });
        }

        const label = createElement("span", { className: "google-event-label" });
        label.append(
          createElement("strong", { text: ev.start_time }),
          document.createTextNode(` ${ev.title}`)
        );
        block.append(label, createQuickActionsNode(ev.id));
        block.addEventListener("click", () => openAgendaModal(ev.id));
        cell.appendChild(block);
      });

      grid.appendChild(cell);
    });
  });

  // Aplica larguras persistidas (se houver)
  applyGoogleGridTemplate(grid, getGoogleColWidths());

  scrollWrap.appendChild(grid);
  container.appendChild(scrollWrap);

  bindQuickActions(container);
  bindGoogleColumnResizers(grid);
}

// Habilita o redimensionamento por arrasto das colunas superiores (mouse + touch)
function bindGoogleColumnResizers(grid) {
  const headers = Array.from(grid.querySelectorAll(".google-day-header"));

  // Retorna as larguras atuais das 7 colunas de dia em px (renderizadas)
  function currentWidths() {
    return headers.map((h) => Math.round(h.getBoundingClientRect().width));
  }

  headers.forEach((header, idx) => {
    const resizer = header.querySelector(".google-col-resizer");
    if (!resizer) return;

    const startDrag = (clientX) => {
      // Fixa TODAS as colunas em px na 1ª interação (comportamento previsível estilo Excel)
      let widths = getGoogleColWidths() || currentWidths();
      const startX = clientX;
      const startWidth = widths[idx];

      resizer.classList.add("resizing");
      document.body.classList.add("is-col-resizing");

      const onMove = (moveX) => {
        const delta = moveX - startX;
        const newWidth = Math.max(GOOGLE_COL_MIN, Math.min(GOOGLE_COL_MAX, startWidth + delta));
        widths[idx] = Math.round(newWidth);
        applyGoogleGridTemplate(grid, widths);
      };

      const onMouseMove = (e) => onMove(e.clientX);
      const onTouchMove = (e) => {
        if (e.touches[0]) onMove(e.touches[0].clientX);
      };

      const endDrag = () => {
        resizer.classList.remove("resizing");
        document.body.classList.remove("is-col-resizing");
        saveGoogleColWidths(widths);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", endDrag);
        document.removeEventListener("touchmove", onTouchMove);
        document.removeEventListener("touchend", endDrag);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", endDrag);
      document.addEventListener("touchmove", onTouchMove, { passive: false });
      document.addEventListener("touchend", endDrag);
    };

    resizer.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startDrag(e.clientX);
    });

    resizer.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches[0]) return;
        e.preventDefault();
        e.stopPropagation();
        startDrag(e.touches[0].clientX);
      },
      { passive: false }
    );

    // Duplo-clique no handle redefine apenas aquela coluna para o padrão
    resizer.addEventListener("dblclick", (e) => {
      e.preventDefault();
      e.stopPropagation();
      let widths = getGoogleColWidths() || currentWidths();
      widths[idx] = 160; // largura padrão confortável
      saveGoogleColWidths(widths);
      applyGoogleGridTemplate(grid, widths);
    });
  });

  // Botão global de reset das larguras
  const resetBtn = grid.querySelector("#google-cols-reset");
  if (resetBtn) {
    resetBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      localStorage.removeItem(GOOGLE_COLS_KEY);
      applyGoogleGridTemplate(grid, null);
      showToast("Larguras das colunas redefinidas", "success");
    });
  }
}

// ============================================================
// LAYOUT 3: TICKTICK (Kanban de Tarefas)
// ============================================================

function renderLayoutTickTick(container) {
  container.classList.remove("agenda-timeline");

  const weekDays = getWeekDays();
  const daysShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const kanban = document.createElement("div");
  kanban.className = "ticktick-kanban";

  weekDays.forEach((dayStr) => {
    const col = document.createElement("div");
    col.className = "ticktick-column";

    const d = new Date(dayStr + "T00:00:00");
    col.appendChild(
      createElement("div", {
        className: "ticktick-column-title",
        text: `${daysShort[d.getDay()]} — ${d.getDate()}/${d.getMonth() + 1}`
      })
    );

    const dayEvents = agendaEvents.filter((ev) => ev.event_date === dayStr);

    if (dayEvents.length === 0) {
      col.appendChild(createStateMessage("Sem compromissos", { compact: true }));
    } else {
      const listContainer = document.createElement("div");
      listContainer.className = "timeline-events-container";

      dayEvents.forEach((ev) => {
        const card = document.createElement("div");
        card.className = `ticktick-task-card ${ev.is_completed ? "completed" : ""}`;
        if (ev.event_color) {
          applyDynamicStyles(card, { "border-left": `3px solid ${ev.event_color}` });
        }
        const checkboxContainer = createElement("div", {
          className: "ticktick-checkbox-container"
        });
        checkboxContainer.appendChild(
          createElement("span", {
            className: "ticktick-checkbox",
            attributes: { id: `check-${ev.id}` }
          })
        );
        const taskContent = createElement("div", { className: "ticktick-task-content" });
        taskContent.append(
          createElement("div", { className: "ticktick-task-title", text: ev.title }),
          createElement("div", {
            className: "ticktick-task-time",
            text: `${ev.start_time} - ${ev.end_time}`
          })
        );
        card.append(checkboxContainer, taskContent, createQuickActionsNode(ev.id));

        // Checkbox interativo real do TickTick
        const checkbox = card.querySelector(`.ticktick-checkbox`);
        if (ev.is_completed) {
          applyDynamicStyles(checkbox, {
            background: "var(--success-color)",
            "border-color": "var(--success-color)"
          });
        }

        checkbox.addEventListener("click", async (e) => {
          e.stopPropagation();
          await toggleEventCompletion(ev.id, ev.is_completed);
        });

        card.addEventListener("click", () => openAgendaModal(ev.id));
        listContainer.appendChild(card);
      });
      col.appendChild(listContainer);
    }

    kanban.appendChild(col);
  });

  container.appendChild(kanban);
  bindQuickActions(container);
}

// ============================================================
// LAYOUT 4: MORGEN (Time-Blocking Diário)
// ============================================================

function renderLayoutMorgen(container) {
  container.classList.remove("agenda-timeline");

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const header = document.createElement("div");
  applyDynamicStyles(header, { "text-align": "center", "margin-bottom": "1rem" });
  header.appendChild(
    createElement("h4", {
      className: "morgen-heading",
      text: `Time-Blocking de Hoje (${formatDatePtBr(todayStr)})`
    })
  );
  container.appendChild(header);

  const timeblocking = document.createElement("div");
  timeblocking.className = "morgen-timeblocking";

  const hoursCol = document.createElement("div");
  hoursCol.className = "morgen-hours-col";
  for (let h = 7; h <= 22; h++) {
    const label = document.createElement("div");
    label.className = "morgen-hour-label";
    label.textContent = `${String(h).padStart(2, "0")}:00`;
    hoursCol.appendChild(label);
  }
  timeblocking.appendChild(hoursCol);

  const eventsCol = document.createElement("div");
  eventsCol.className = "morgen-events-col";

  for (let i = 0; i <= 15; i++) {
    const line = document.createElement("div");
    line.className = "morgen-grid-line";
    applyDynamicStyles(line, { top: `${i * 60}px` });
    eventsCol.appendChild(line);
  }

  const todayEvents = agendaEvents.filter((ev) => ev.event_date === todayStr);

  todayEvents.forEach((ev) => {
    const [startH, startM] = ev.start_time.split(":").map(Number);
    const [endH, endM] = ev.end_time.split(":").map(Number);

    const startMinutes = (startH - 7) * 60 + startM;
    const endMinutes = (endH - 7) * 60 + endM;

    if (startMinutes < 0) return;

    const topPx = startMinutes;
    const heightPx = Math.max(35, endMinutes - startMinutes);

    const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
    const slot = document.createElement("div");
    slot.className = `morgen-event-slot ${evClass}`;
    applyDynamicStyles(slot, {
      top: `${topPx}px`,
      height: `${heightPx}px`,
      opacity: ev.is_completed ? "0.5" : "1",
      "text-decoration": ev.is_completed ? "line-through" : "none"
    });

    if (ev.event_color) {
      applyDynamicStyles(slot, {
        background: `${ev.event_color}25`,
        color: ev.event_color,
        "border-left-color": ev.event_color
      });
    }

    const slotContent = createElement("div", { className: "morgen-event-copy" });
    slotContent.append(
      createElement("div", { className: "morgen-event-title", text: ev.title }),
      createElement("div", {
        className: "morgen-event-time",
        text: `${ev.start_time} - ${ev.end_time}`
      })
    );
    slot.append(slotContent, createQuickActionsNode(ev.id));

    slot.addEventListener("click", () => openAgendaModal(ev.id));
    eventsCol.appendChild(slot);
  });

  const currentHour = today.getHours();
  const currentMinute = today.getMinutes();
  if (currentHour >= 7 && currentHour <= 22) {
    const currentPos = (currentHour - 7) * 60 + currentMinute;
    const indicator = document.createElement("div");
    indicator.className = "morgen-time-indicator";
    applyDynamicStyles(indicator, { top: `${currentPos}px` });
    eventsCol.appendChild(indicator);
  }

  timeblocking.appendChild(eventsCol);
  container.appendChild(timeblocking);
  bindQuickActions(container);
}

// ============================================================
// LAYOUT 5: TODOIST (Lista por Categoria)
// ============================================================

function renderLayoutTodoist(container) {
  container.classList.remove("agenda-timeline");

  if (agendaEvents.length === 0) {
    container.appendChild(createStateMessage("Sua lista de tarefas está limpa."));
    return;
  }

  const grouped = {};
  agendaEvents.forEach((ev) => {
    if (!grouped[ev.activity_title]) grouped[ev.activity_title] = [];
    grouped[ev.activity_title].push(ev);
  });

  const todoistList = document.createElement("div");
  todoistList.className = "todoist-list";

  const colorHex = {
    Work: "var(--work-color)",
    Play: "var(--play-color)",
    Study: "var(--study-color)",
    Exercise: "var(--exercise-color)",
    Social: "var(--social-color)",
    "Self Care": "var(--care-color)"
  };

  Object.entries(grouped).forEach(([title, events]) => {
    const groupCard = document.createElement("div");
    groupCard.className = "todoist-project-group";

    const titlePt = TITLE_PT[title] || title;
    const color = colorHex[title] || "var(--pale-blue)";

    const groupHeader = createElement("div", { className: "todoist-project-header" });
    const colorDot = createElement("span", { className: "color-dot" });
    applyDynamicStyles(colorDot, { background: color });
    groupHeader.append(colorDot, document.createTextNode(titlePt));
    groupCard.appendChild(groupHeader);

    const list = document.createElement("div");
    list.className = "todoist-task-list";

    events.forEach((ev) => {
      const task = document.createElement("div");
      task.className = `todoist-task-item ${ev.is_completed ? "completed" : ""}`;
      applyDynamicStyles(task, {
        opacity: ev.is_completed ? "0.5" : "1",
        "text-decoration": ev.is_completed ? "line-through" : "none"
      });

      if (ev.event_color) {
        applyDynamicStyles(task, {
          "border-left": `3px solid ${ev.event_color}`,
          "padding-left": "0.75rem"
        });
      }

      const info = document.createElement("div");
      info.append(
        createElement("div", { className: "todoist-task-name", text: ev.title }),
        createElement("div", {
          className: "todoist-task-desc",
          text: ev.description || "Sem descrição"
        })
      );
      const meta = createElement("div", { className: "todoist-task-meta" });
      meta.append(
        createElement("div", {
          className: "todoist-task-date",
          text: formatDatePtBr(ev.event_date)
        }),
        createElement("span", {
          className: "todoist-task-time-badge",
          text: `${ev.start_time} - ${ev.end_time}`
        }),
        createQuickActionsNode(ev.id)
      );
      task.append(info, meta);

      task.addEventListener("click", () => openAgendaModal(ev.id));
      list.appendChild(task);
    });

    groupCard.appendChild(list);
    todoistList.appendChild(groupCard);
  });

  container.appendChild(todoistList);
  bindQuickActions(container);
}

// ============================================================
// LAYOUT 6: BENTO KANBAN (Tendência 2026/2027)
// ============================================================

function renderLayoutKanban(container) {
  container.classList.remove("agenda-timeline");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const columns = [
    { id: "planejado", title: "Planejado", events: [] },
    { id: "hoje", title: "Em Andamento (Hoje)", events: [] },
    { id: "concluido", title: "Concluído", events: [] }
  ];

  // Distribuir eventos nas colunas dinamicamente
  agendaEvents.forEach((ev) => {
    if (ev.is_completed) {
      columns[2].events.push(ev);
    } else {
      const evDate = parseLocalDate(ev.event_date);
      evDate.setHours(0, 0, 0, 0);
      if (evDate.getTime() > today.getTime()) {
        columns[0].events.push(ev);
      } else {
        columns[1].events.push(ev);
      }
    }
  });

  const bentoGrid = document.createElement("div");
  bentoGrid.className = "bento-kanban";

  columns.forEach((col) => {
    const colDiv = document.createElement("div");
    colDiv.className = "kanban-column";
    const colTitle = createElement("div", { className: "kanban-column-title" });
    colTitle.append(
      createElement("span", { text: col.title }),
      createElement("span", { className: "kanban-count-badge", text: String(col.events.length) })
    );
    colDiv.appendChild(colTitle);

    const eventsList = document.createElement("div");
    eventsList.className = "timeline-events-container";

    if (col.events.length === 0) {
      eventsList.appendChild(
        createStateMessage("Nenhum compromisso nesta coluna", { compact: true })
      );
    } else {
      col.events.forEach((ev) => {
        const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
        const titlePt = TITLE_PT[ev.activity_title] || ev.activity_title;
        const effort = "⚡".repeat(ev.cognitive_load || 1);

        const card = document.createElement("div");
        card.className = `kanban-event-card ${evClass} ${ev.is_completed ? "completed" : ""}`;

        if (ev.event_color) {
          applyDynamicStyles(card, { "border-left-color": ev.event_color });
        }

        const cardHeader = createElement("div", { className: "kanban-event-header" });
        cardHeader.appendChild(
          createElement("span", {
            className: "kanban-event-time",
            text: `${ev.start_time} - ${ev.end_time}`
          })
        );
        const checkboxWrap = createElement("div", {
          className: "ticktick-checkbox-container ticktick-checkbox-container-inline"
        });
        checkboxWrap.appendChild(
          createElement("span", {
            className: "ticktick-checkbox",
            attributes: { id: `kanban-check-${ev.id}` }
          })
        );
        cardHeader.appendChild(checkboxWrap);

        const titleNode = createElement("div", { className: "kanban-event-title", text: ev.title });
        const descNode = createElement("div", {
          className: "kanban-event-desc",
          text: ev.description || "Sem descrição"
        });
        if (ev.is_completed) {
          applyDynamicStyles(titleNode, { "text-decoration": "line-through", opacity: "0.6" });
          applyDynamicStyles(descNode, { opacity: "0.4" });
        }

        const footer = createElement("div", { className: "kanban-card-footer" });
        const categoryBadge = createElement("span", {
          className: "kanban-category-badge",
          text: titlePt
        });
        applyDynamicStyles(categoryBadge, { color: ev.event_color || `var(--${evClass}-color)` });
        const effortNode = createElement("span", { className: "event-effort-text", text: effort });
        const badge = createDurationBadge(
          `${formatDatePtBr(ev.event_date)} (${ev.duration_hours}h)`
        );
        badge.classList.add("event-duration-badge-inline");
        footer.append(categoryBadge, effortNode, badge);

        const actionRow = createElement("div", { className: "kanban-action-row" });
        actionRow.appendChild(createQuickActionsNode(ev.id));

        card.append(cardHeader, titleNode, descNode, footer, actionRow);

        // Checkbox de conclusão rápida do card Kanban
        const checkbox = card.querySelector(".ticktick-checkbox");
        if (ev.is_completed) {
          applyDynamicStyles(checkbox, {
            background: "var(--success-color)",
            "border-color": "var(--success-color)"
          });
        }

        checkbox.addEventListener("click", async (e) => {
          e.stopPropagation();
          await toggleEventCompletion(ev.id, ev.is_completed);
        });

        // Clique no card abre modal de edição
        card.addEventListener("click", () => openAgendaModal(ev.id));
        eventsList.appendChild(card);
      });
    }

    colDiv.appendChild(eventsList);
    bentoGrid.appendChild(colDiv);
  });

  container.appendChild(bentoGrid);
  bindQuickActions(container);
}

// ============================================================
// CONEXAO PERSISTENTE: ALTERAR CONCLUSAO DE COMPROMISSO
// ============================================================

async function toggleEventCompletion(eventId, currentState) {
  const newState = !currentState;
  try {
    const response = await apiFetch(`/api/agenda/${eventId}/completion`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_completed: newState })
    });

    if (!response.ok) {
      const errorPayload = await responsePayload(response);
      throw new Error(
        apiErrorMessage(errorPayload, "Não foi possível alterar a conclusão do compromisso.")
      );
    }

    // Motor de Recompensa Dopaminérgica ao concluir
    if (newState) {
      const ev = agendaEvents.find((e) => e.id === eventId);
      await celebrarConclusao({ tipo: "compromisso", cargaAlta: ev && ev.cognitive_load >= 3 });
    } else {
      showToast("Compromisso reaberto!", "success");
    }

    // Atualizar dados gerais e view
    await refreshData();

    if (activeInlineActivityId !== null) {
      await renderInlineAgendaTable(activeInlineActivityId);
    }

    if (activeSection === "agenda") {
      await fetchAndRenderAgenda();
    }
  } catch (error) {
    showToast(`Erro ao atualizar compromisso: ${error.message}`, "error");
  }
}

// ============================================================
// CRUD DA AGENDA — MODAL E OPERAÇÕES
// ============================================================

let currentAgendaEventId = null;

function openAgendaModal(eventId = null) {
  currentAgendaEventId = eventId;
  resetarCopilotoAgenda();
  const modal = document.getElementById("modal-agenda-overlay");
  const saveButton = document.getElementById("modal-agenda-save");

  if (eventId) {
    fetchEventDetailsAndOpenModal(eventId);
  } else {
    document.getElementById("modal-agenda-title").textContent = "Novo Compromisso";
    if (saveButton) saveButton.textContent = "Agendar";
    document.getElementById("agenda-title").value = "";
    document.getElementById("agenda-desc").value = "";
    document.getElementById("agenda-date").value = new Date().toISOString().split("T")[0];
    document.getElementById("agenda-start").value = "09:00";
    document.getElementById("agenda-end").value = "10:00";
    document.getElementById("agenda-priority").value = "media";
    document.getElementById("agenda-load").value = "2";
    document.getElementById("agenda-color").value = "#7c6fff";

    populateCategorySelect("agenda-activity", activeInlineActivityId);
    modal.classList.add("open");
  }
}

async function fetchEventDetailsAndOpenModal(eventId) {
  try {
    const response = await apiFetch("/api/agenda");
    const events = await responsePayload(response);
    if (!response.ok)
      throw new Error(apiErrorMessage(events, "Não foi possível carregar o compromisso."));
    const ev = events.find((e) => e.id === eventId);
    if (!ev) return;

    document.getElementById("modal-agenda-title").textContent = "Editar Compromisso";
    const saveButton = document.getElementById("modal-agenda-save");
    if (saveButton) saveButton.textContent = "Salvar alterações";
    populateCategorySelect("agenda-activity", ev.activity_id);
    document.getElementById("agenda-title").value = ev.title;
    document.getElementById("agenda-desc").value = ev.description;
    document.getElementById("agenda-date").value = ev.event_date;
    document.getElementById("agenda-start").value = ev.start_time;
    document.getElementById("agenda-end").value = ev.end_time;
    document.getElementById("agenda-priority").value = ev.priority || "media";
    document.getElementById("agenda-load").value =
      ev.cognitive_load !== undefined ? String(ev.cognitive_load) : "2";
    document.getElementById("agenda-color").value = ev.event_color || "#7c6fff";
    resetarCopilotoAgenda();

    document.getElementById("modal-agenda-overlay").classList.add("open");
  } catch (error) {
    showToast("Erro ao carregar dados do evento", "error");
  }
}

async function saveAgendaModal() {
  const activity_id = parseInt(document.getElementById("agenda-activity").value);
  const title = document.getElementById("agenda-title").value.trim();
  const description = document.getElementById("agenda-desc").value.trim();
  const event_date = document.getElementById("agenda-date").value;
  const start_time = document.getElementById("agenda-start").value;
  const end_time = document.getElementById("agenda-end").value;
  const priority = document.getElementById("agenda-priority").value;
  const cognitive_load = parseInt(document.getElementById("agenda-load").value);
  const event_color = document.getElementById("agenda-color").value;

  if (!title || !event_date || !start_time || !end_time) {
    showToast("Todos os campos obrigatórios devem ser preenchidos!", "warning");
    return;
  }

  const [startH, startM] = start_time.split(":").map(Number);
  const [endH, endM] = end_time.split(":").map(Number);
  if (endH * 60 + endM <= startH * 60 + startM) {
    showToast("A hora de término deve ser posterior à hora de início!", "warning");
    return;
  }

  const payload = {
    activity_id,
    title,
    description,
    event_date,
    start_time,
    end_time,
    priority,
    cognitive_load,
    event_color
  };
  const method = currentAgendaEventId ? "PUT" : "POST";
  const url = currentAgendaEventId ? `/api/agenda/${currentAgendaEventId}` : "/api/agenda";

  try {
    const response = await apiFetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorPayload = await responsePayload(response);
      throw new Error(apiErrorMessage(errorPayload, "Não foi possível salvar o compromisso."));
    }

    showToast(
      currentAgendaEventId ? "Compromisso atualizado!" : "Compromisso agendado com sucesso!",
      "success"
    );
    document.getElementById("modal-agenda-overlay").classList.remove("open");
    currentAgendaEventId = null;

    await refreshData();

    if (activeInlineActivityId !== null) {
      await renderInlineAgendaTable(activeInlineActivityId);
    }

    if (activeSection === "agenda") {
      await fetchAndRenderAgenda();
    }
  } catch (error) {
    showToast(`Erro ao salvar: ${error.message}`, "error");
  }
}

// ID do compromisso aguardando confirmação de exclusão (modal premium)
let pendingDeleteEventId = null;

// Abre o modal premium e acessível de confirmação.
function deleteAgendaEvent(eventId) {
  pendingDeleteEventId = eventId;
  const ev = agendaEvents.find((e) => e.id === eventId);
  const titleEl = document.getElementById("confirm-delete-event-title");
  if (titleEl) titleEl.textContent = ev ? ev.title : "este compromisso";
  document.getElementById("modal-confirm-delete-overlay").classList.add("open");
}

// Executa de fato a exclusão após confirmação do usuário
async function performDeleteAgendaEvent() {
  if (pendingDeleteEventId === null) return;
  const eventId = pendingDeleteEventId;
  pendingDeleteEventId = null;
  document.getElementById("modal-confirm-delete-overlay").classList.remove("open");

  try {
    const response = await apiFetch(`/api/agenda/${eventId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const errorPayload = await responsePayload(response);
      throw new Error(apiErrorMessage(errorPayload, "Não foi possível remover o compromisso."));
    }

    showToast("Compromisso removido da agenda", "success");

    await refreshData();

    if (activeInlineActivityId !== null) {
      await renderInlineAgendaTable(activeInlineActivityId);
    }

    if (activeSection === "agenda") {
      await fetchAndRenderAgenda();
    }
  } catch (error) {
    showToast(`Erro ao remover: ${error.message}`, "error");
  }
}

// Liga os botões do modal premium de exclusão de compromisso
function initConfirmDeleteModal() {
  const overlay = document.getElementById("modal-confirm-delete-overlay");
  const close = () => {
    pendingDeleteEventId = null;
    overlay.classList.remove("open");
  };
  document.getElementById("modal-confirm-delete-close").addEventListener("click", close);
  document.getElementById("modal-confirm-delete-cancel").addEventListener("click", close);
  document
    .getElementById("modal-confirm-delete-btn")
    .addEventListener("click", performDeleteAgendaEvent);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}

function initAgendaModals() {
  const closeAgendaModal = () => {
    currentAgendaEventId = null;
    document.getElementById("modal-agenda-overlay").classList.remove("open");
    const saveButton = document.getElementById("modal-agenda-save");
    if (saveButton) saveButton.textContent = "Agendar";
  };
  document.getElementById("modal-agenda-close").addEventListener("click", () => {
    closeAgendaModal();
  });
  document.getElementById("modal-agenda-cancel").addEventListener("click", () => {
    closeAgendaModal();
  });
  document.getElementById("modal-agenda-save").addEventListener("click", saveAgendaModal);
  document.getElementById("agenda-color-reset").addEventListener("click", () => {
    document.getElementById("agenda-color").value = "#7c6fff";
  });
}

// ============================================================
// TIMEFRAME — CONTROLE DE PERÍODO (DASHBOARD)
// ============================================================

function initTimeframeControls() {
  const dailyBtn = document.getElementById("daily");
  const weeklyBtn = document.getElementById("weekly");
  const monthlyBtn = document.getElementById("monthly");
  const buttons = [dailyBtn, weeklyBtn, monthlyBtn];

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      activeTimeframe = btn.id;
      buttons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderCards();
      // A faixa de distribuição lê as horas do período ativo. Sem recalcular
      // aqui, trocar para Semanal ou Mensal mudava os cartões mas mantinha a
      // faixa falando de "hoje", com os números do dia.
      updateKPIs();
    });
  });
}

// ============================================================
// MODAIS CARD — EDIÇÃO DE HORAS ACUMULADAS
// ============================================================

let currentEditId = null;

function openEditModal(id, title) {
  currentEditId = id;
  const activity = activitiesData.find((a) => a.id === id);
  if (!activity) return;

  const tf = activity.timeframes[activeTimeframe] || { current: 0, previous: 0 };
  const titlePt = TITLE_PT[title] || title;
  const periodName = TIMEFRAMES_CONFIG[activeTimeframe].name;

  document.getElementById("modal-edit-title").textContent =
    `Editar Horas — ${titlePt} (${periodName})`;
  document.getElementById("edit-current").value = tf.current;
  document.getElementById("edit-previous").value = tf.previous;
  openModal("modal-edit-overlay");
}

async function saveEditModal() {
  if (currentEditId === null) return;

  const currentValue = document.getElementById("edit-current").value.trim().replace(",", ".");
  const previousValue = document.getElementById("edit-previous").value.trim().replace(",", ".");
  const current = currentValue === "" ? 0 : Number(currentValue);
  const previous = previousValue === "" ? 0 : Number(previousValue);

  if (!Number.isFinite(current) || !Number.isFinite(previous) || current < 0 || previous < 0) {
    showToast("Informe horas válidas com zero ou mais, usando inteiro ou decimal.", "warning");
    return;
  }

  try {
    const response = await apiFetch(`/api/activities/${currentEditId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeframe: activeTimeframe, current, previous })
    });

    if (!response.ok) {
      const errorPayload = await responsePayload(response);
      throw new Error(apiErrorMessage(errorPayload, "Não foi possível atualizar as horas."));
    }

    showToast("Horas atualizadas com sucesso!", "success");
    closeModal("modal-edit-overlay");
    await refreshData();
  } catch (error) {
    showToast(`Erro ao salvar: ${error.message}`, "error");
  }
}

// ============================================================
// MODAIS CARD — DEFINIÇÃO DE META
// ============================================================

let currentGoalId = null;

function openGoalModal(id, title) {
  currentGoalId = id;
  const activity = activitiesData.find((a) => a.id === id);
  if (!activity) return;

  const titlePt = TITLE_PT[title] || title;
  const periodName = TIMEFRAMES_CONFIG[activeTimeframe].name;
  const currentGoal =
    activity.goals && activity.goals[activeTimeframe] ? activity.goals[activeTimeframe] : 0;

  document.getElementById("modal-goal-title").textContent = `Definir Meta — ${titlePt}`;
  document.getElementById("goal-timeframe-label").textContent = periodName;
  document.getElementById("goal-target").value = currentGoal || "";
  openModal("modal-goal-overlay");
}

async function saveGoalModal() {
  if (currentGoalId === null) return;

  const targetValue = document.getElementById("goal-target").value.trim().replace(",", ".");
  const targetHours = targetValue === "" ? 0 : Number(targetValue);

  if (!Number.isFinite(targetHours) || targetHours < 0) {
    showToast("Informe uma meta válida com zero ou mais, usando inteiro ou decimal.", "warning");
    return;
  }

  try {
    const response = await apiFetch(`/api/activities/${currentGoalId}/goals`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeframe: activeTimeframe, target_hours: targetHours })
    });

    if (!response.ok) {
      const errorPayload = await responsePayload(response);
      throw new Error(apiErrorMessage(errorPayload, "Não foi possível definir a meta."));
    }

    showToast("Meta definida com sucesso!", "success");
    closeModal("modal-goal-overlay");
    await refreshData();
  } catch (error) {
    showToast(`Erro ao definir meta: ${error.message}`, "error");
  }
}

// ============================================================
// MODAIS CARD — VER DETALHES
// ============================================================

async function openDetailsModal(id, title) {
  const titlePt = TITLE_PT[title] || title;
  document.getElementById("modal-details-title").textContent = `Detalhes — ${titlePt}`;

  try {
    const response = await apiFetch(`/api/activities/${id}/details`);
    if (!response.ok) throw new Error("Erro ao buscar detalhes");
    const data = await response.json();

    const detailsGrid = document.getElementById("details-grid");
    clearElement(detailsGrid);

    const periods = [
      { key: "daily", label: "Diário", prevLabel: "Ontem" },
      { key: "weekly", label: "Semanal", prevLabel: "Última semana" },
      { key: "monthly", label: "Mensal", prevLabel: "Último mês" }
    ];

    periods.forEach((p) => {
      const tf = data.timeframes[p.key] || { current: 0, previous: 0 };
      const goalH = data.goals && data.goals[p.key] ? data.goals[p.key] : 0;

      const card = document.createElement("div");
      card.className = "details-card";
      card.append(
        createElement("div", { className: "details-card-label", text: p.label }),
        createElement("div", { className: "details-card-value", text: `${tf.current}hrs` }),
        createElement("div", {
          className: "details-card-prev",
          text: `${p.prevLabel}: ${tf.previous}hrs`
        })
      );
      if (goalH > 0) {
        card.appendChild(
          createElement("div", { className: "details-card-prev", text: `Meta: ${goalH}hrs` })
        );
      }
      detailsGrid.appendChild(card);
    });

    openModal("modal-details-overlay");
  } catch (error) {
    showToast("Erro ao carregar detalhes", "error");
  }
}

// ============================================================
// MODAIS CARD — EXCLUSÃO DA CATEGORIA
// ============================================================

let currentDeleteId = null;

function openDeleteModal(id, title) {
  currentDeleteId = id;
  const titlePt = TITLE_PT[title] || title;
  document.getElementById("delete-activity-name").textContent = titlePt;
  openModal("modal-delete-overlay");
}

async function confirmDelete() {
  if (currentDeleteId === null) return;

  try {
    const response = await apiFetch(`/api/activities/${currentDeleteId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const errorPayload = await responsePayload(response);
      throw new Error(apiErrorMessage(errorPayload, "Não foi possível excluir a atividade."));
    }

    showToast("Atividade excluída com sucesso!", "success");
    closeModal("modal-delete-overlay");
    closeInlineAgendaPanel();
    await refreshData();
  } catch (error) {
    showToast(`Erro ao excluir: ${error.message}`, "error");
  }
}

// ============================================================
// MODAIS CARD — UTILITÁRIOS
// ============================================================

function openModal(overlayId) {
  document.getElementById(overlayId).classList.add("open");
}

function closeModal(overlayId) {
  document.getElementById(overlayId).classList.remove("open");
}

function closeAllModals() {
  document.querySelectorAll(".modal-overlay.open").forEach((m) => m.classList.remove("open"));
}

function initCardModals() {
  document
    .getElementById("modal-edit-close")
    .addEventListener("click", () => closeModal("modal-edit-overlay"));
  document.getElementById("modal-edit-save").addEventListener("click", saveEditModal);

  document
    .getElementById("modal-goal-close")
    .addEventListener("click", () => closeModal("modal-goal-overlay"));
  document
    .getElementById("modal-goal-cancel")
    .addEventListener("click", () => closeModal("modal-goal-overlay"));
  document.getElementById("modal-goal-save").addEventListener("click", saveGoalModal);

  document
    .getElementById("modal-delete-close")
    .addEventListener("click", () => closeModal("modal-delete-overlay"));
  document
    .getElementById("modal-delete-cancel")
    .addEventListener("click", () => closeModal("modal-delete-overlay"));
  document.getElementById("modal-delete-confirm").addEventListener("click", confirmDelete);

  document
    .getElementById("modal-details-close")
    .addEventListener("click", () => closeModal("modal-details-overlay"));

  // Perfil e Preferências
  document
    .getElementById("modal-profile-close")
    .addEventListener("click", () => closeModal("modal-profile-overlay"));
  document
    .getElementById("modal-profile-cancel")
    .addEventListener("click", () => closeModal("modal-profile-overlay"));
  document.getElementById("modal-profile-save").addEventListener("click", saveProfileModal);
  document.getElementById("btn-change-password").addEventListener("click", changeOwnPassword);
  document
    .getElementById("danger-password")
    .addEventListener("input", atualizarEstadoBotaoExclusao);
  document
    .getElementById("danger-confirmation")
    .addEventListener("input", atualizarEstadoBotaoExclusao);
  document.getElementById("btn-delete-account").addEventListener("click", excluirMinhaConta);
  document
    .getElementById("btn-add-activity")
    .addEventListener("click", () => abrirDialogoDeCategoria());

  // Relatórios — seletor de período e gráfico temporal (Tarefa 20).
  document.querySelectorAll("#reports-period-switch .reports-period-btn").forEach((botao) => {
    botao.addEventListener("click", () => definirPeriodoDeRelatorios(botao.dataset.period));
  });
  ["filter-years", "filter-months", "filter-days"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      timeseries.filtros = {
        years: valoresSelecionados("filter-years"),
        months: valoresSelecionados("filter-months"),
        days: valoresSelecionados("filter-days")
      };
      carregarGraficoTemporal();
    });
  });
  document.getElementById("timeseries-clear").addEventListener("click", () => {
    timeseries.filtros = { years: [], months: [], days: [] };
    carregarGraficoTemporal();
    document.getElementById("timeseries-drilldown").classList.add("hidden");
  });
  document.getElementById("timeseries-drilldown-close").addEventListener("click", () => {
    document.getElementById("timeseries-drilldown").classList.add("hidden");
  });
  document
    .getElementById("btn-new-chart")
    .addEventListener("click", () => abrirConstrutorDeGrafico());

  document
    .getElementById("modal-preferences-close")
    .addEventListener("click", () => closeModal("modal-preferences-overlay"));
  document
    .getElementById("modal-preferences-cancel")
    .addEventListener("click", () => closeModal("modal-preferences-overlay"));
  document.getElementById("modal-preferences-save").addEventListener("click", savePreferencesModal);

  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || document.body.classList.contains("app-dialog-open")) return;
    const openModalOverlay = Array.from(document.querySelectorAll(".modal-overlay.open")).pop();
    if (openModalOverlay) {
      event.preventDefault();
      openModalOverlay.classList.remove("open");
    }
  });
}

// ============================================================
// RELATÓRIOS (Com Gráfico Radial SVG dinâmico)
// ============================================================

function renderReports() {
  // 1. Fichas de categorias
  const grid = document.getElementById("reports-grid");
  clearElement(grid);

  const colorHex = {
    Work: "var(--work-color)",
    Play: "var(--play-color)",
    Study: "var(--study-color)",
    Exercise: "var(--exercise-color)",
    Social: "var(--social-color)",
    "Self Care": "var(--care-color)"
  };

  let topActivityTitle = "-";
  let maxHours = -1;
  let totalHours = 0;
  let totalCognitiveLoad = 0;
  let goalsCompleted = 0;
  let totalGoalsCount = 0;

  activitiesData.forEach((activity) => {
    const titlePt = TITLE_PT[activity.title] || activity.title;
    const color = colorHex[activity.title] || "var(--pale-blue)";
    // Usa o período selecionado nos Relatórios (corrige o achado de QA de
    // KPIs/gráfico fixos em "semanal").
    const tf = activity.timeframes[reportsPeriod] || { current: 0, previous: 0 };
    const goalH =
      activity.goals && activity.goals[reportsPeriod] ? activity.goals[reportsPeriod] : 0;

    totalHours += tf.current;

    if (tf.current > maxHours && tf.current > 0) {
      maxHours = tf.current;
      topActivityTitle = titlePt;
    }

    if (goalH > 0) {
      totalGoalsCount++;
      if (tf.current >= goalH) {
        goalsCompleted++;
      }
    }

    const card = document.createElement("div");
    card.className = "report-card";

    const periods = [
      { key: "daily", label: "Diário" },
      { key: "weekly", label: "Semanal" },
      { key: "monthly", label: "Mensal" }
    ];
    const titleRow = createElement("div", { className: "report-card-title" });
    const colorDot = createElement("span", { className: "color-dot" });
    applyDynamicStyles(colorDot, { background: color });
    titleRow.append(colorDot, document.createTextNode(titlePt));
    card.appendChild(titleRow);

    periods.forEach((p) => {
      const tfVal = activity.timeframes[p.key] || { current: 0, previous: 0 };
      const target = activity.goals && activity.goals[p.key] ? activity.goals[p.key] : null;
      const row = createElement("div", { className: "report-row" });
      row.append(
        createElement("span", { className: "report-row-label", text: p.label }),
        createElement("span", {
          className: "report-row-value",
          text: `${tfVal.current}h / ${tfVal.previous}h${target ? ` (Meta: ${target}h)` : ""}`
        })
      );
      card.appendChild(row);
    });
    grid.appendChild(card);
  });

  // Somar esforço cognitivo acumulado da agenda de compromissos
  agendaEvents.forEach((ev) => {
    totalCognitiveLoad += ev.cognitive_load || 1;
  });

  // Atualizar KPIs superiores dos Relatórios
  document.getElementById("report-kpi-top-activity").textContent = topActivityTitle;
  document.getElementById("report-kpi-mental-load").textContent = `${totalCognitiveLoad} ⚡`;

  const goalsRatio = totalGoalsCount > 0 ? Math.round((goalsCompleted / totalGoalsCount) * 100) : 0;
  document.getElementById("report-kpi-goals-ratio").textContent = `${goalsRatio}%`;

  // Rótulo explícito do período ativo (corrige o achado de QA).
  const periodoLabel = REPORTS_PERIOD_LABEL[reportsPeriod];
  const hint = document.getElementById("reports-period-hint");
  if (hint) {
    clearElement(hint);
    hint.append(
      document.createTextNode("Exibindo o período "),
      createElement("strong", { text: periodoLabel }),
      document.createTextNode(".")
    );
  }
  const tituloRadial = document.getElementById("reports-chart-title");
  if (tituloRadial) {
    tituloRadial.textContent = `Distribuição de Tempo por Categoria — período ${periodoLabel}`;
  }
  const cargaLabel = document
    .querySelector("#report-kpi-mental-load")
    ?.closest(".reports-kpi-card")
    ?.querySelector(".details-card-label");
  if (cargaLabel) cargaLabel.textContent = "Carga Mental Acumulada";

  // 2. Gráfico Radial SVG dinâmico
  renderRadialChart(totalHours, colorHex);
}

// Alterna o período dos Relatórios sem afetar o Dashboard.
function definirPeriodoDeRelatorios(periodo) {
  if (!REPORTS_PERIOD_LABEL[periodo]) return;
  reportsPeriod = periodo;
  document.querySelectorAll("#reports-period-switch .reports-period-btn").forEach((botao) => {
    const ativo = botao.dataset.period === periodo;
    botao.classList.toggle("active", ativo);
    botao.setAttribute("aria-selected", ativo ? "true" : "false");
  });
  renderReports();
}

function renderRadialChart(totalHours, colorHex) {
  const chartContainer = document.getElementById("reports-chart-radial");
  const legendContainer = document.getElementById("reports-chart-legend");
  clearElement(chartContainer);
  clearElement(legendContainer);

  if (totalHours === 0) {
    chartContainer.appendChild(
      createElement("span", {
        className: "chart-empty-state",
        text: "Sem dados para gerar gráfico"
      })
    );
    return;
  }

  // Desenhar SVG do Donut
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("viewBox", "0 0 42 42");

  let accumulatedPercent = 0;

  activitiesData.forEach((activity) => {
    const titlePt = TITLE_PT[activity.title] || activity.title;
    const color = colorHex[activity.title] || "var(--pale-blue)";
    const tf = activity.timeframes[reportsPeriod] || { current: 0, previous: 0 };

    if (tf.current === 0) return;

    const percent = (tf.current / totalHours) * 100;
    const strokeDash = percent;
    const strokeOffset = 100 - accumulatedPercent + 25; // 25 adicionado para iniciar no topo (12h)

    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", "21");
    circle.setAttribute("cy", "21");
    circle.setAttribute("r", "15.91549430918954");
    circle.setAttribute("fill", "transparent");
    circle.setAttribute("stroke", color);
    circle.setAttribute("stroke-width", "4.5");
    circle.setAttribute("stroke-dasharray", `${strokeDash} ${100 - strokeDash}`);
    circle.setAttribute("stroke-dashoffset", String(strokeOffset));
    circle.classList.add("radial-chart-segment");
    svg.appendChild(circle);

    accumulatedPercent += percent;

    // Adicionar legenda
    const legendItem = document.createElement("div");
    legendItem.className = "legend-item";
    const label = createElement("div", { className: "legend-color-label" });
    const dot = createElement("span", { className: "legend-color-dot" });
    applyDynamicStyles(dot, { background: color });
    label.append(dot, createElement("span", { text: titlePt }));
    legendItem.append(
      label,
      createElement("strong", {
        className: "legend-strong",
        text: `${tf.current}h (${Math.round(percent)}%)`
      })
    );
    legendContainer.appendChild(legendItem);
  });

  // Furo do Donut (Texto no centro)
  const hole = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  hole.setAttribute("cx", "21");
  hole.setAttribute("cy", "21");
  hole.setAttribute("r", "13");
  hole.setAttribute("fill", "var(--single-section-bg)");
  svg.appendChild(hole);

  chartContainer.appendChild(svg);

  // Injetar texto de total no meio
  const totalLabel = document.createElement("div");
  applyDynamicStyles(totalLabel, { position: "absolute", "text-align": "center" });
  totalLabel.append(
    createElement("div", { className: "radial-total-label", text: "Total" }),
    createElement("div", { className: "radial-total-value", text: `${totalHours}h` })
  );
  chartContainer.appendChild(totalLabel);
}

// ============================================================
// CONFIGURAÇÕES (Abas, Tema Claro e Restauração)
// ============================================================

function loadSettingsTab() {
  document.getElementById("settings-theme").value = userProfile.theme || "escuro";
  document.getElementById("settings-confetti").checked = Boolean(userProfile.enable_confetti);
  document.getElementById("settings-live-interval").value = String(
    userProfile.live_refresh_seconds || 20
  );
  const soundSelect = document.getElementById("settings-sound");
  const preferredSound = userProfile.focus_sound || "chuva";
  soundSelect.value =
    preferredSound === FEATURE_BINAURAL && !canUseBinauralSound() ? "nenhum" : preferredSound;
  applyBinauralCapabilityToControls();
}

async function saveSettingsFromTab() {
  const theme = document.getElementById("settings-theme").value;
  const enableConfetti = document.getElementById("settings-confetti").checked;
  const focusSound = document.getElementById("settings-sound").value;
  const liveInterval = Number(document.getElementById("settings-live-interval").value);

  try {
    await saveProfilePreferences(
      {
        theme,
        focus_sound: focusSound,
        enable_confetti: enableConfetti,
        live_refresh_seconds: liveInterval
      },
      "Configurações salvas!"
    );
    iniciarAoVivo(liveInterval);
  } catch (error) {
    showToast(error.message || "Erro ao salvar configurações.", "error");
    loadSettingsTab();
  }
}

function resetDatabase() {
  document.getElementById("modal-confirm-reset-overlay").classList.add("open");
}

async function performResetDatabase() {
  document.getElementById("modal-confirm-reset-overlay").classList.remove("open");
  try {
    const response = await apiFetch("/api/settings/reset", { method: "POST" });
    if (!response.ok) throw new Error("Falha ao redefinir banco");
    showToast("Banco de dados restaurado com sucesso!", "success");
    await refreshData();
    switchSection("dashboard");
    document.querySelectorAll(".nav-item").forEach((n) => n.classList.remove("active"));
    document.getElementById("nav-dashboard").classList.add("active");
  } catch (error) {
    showToast("Erro ao restaurar banco", "error");
  }
}

function initConfirmResetModal() {
  const overlay = document.getElementById("modal-confirm-reset-overlay");
  const close = () => overlay.classList.remove("open");
  document.getElementById("modal-confirm-reset-close").addEventListener("click", close);
  document.getElementById("modal-confirm-reset-cancel").addEventListener("click", close);
  document
    .getElementById("modal-confirm-reset-btn")
    .addEventListener("click", performResetDatabase);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
}

// ============================================================
// DADOS — FETCH E REFRESH
// ============================================================

async function fetchActivities() {
  try {
    const response = await apiFetch("/api/activities");
    if (!response.ok) throw new Error(`Erro: ${response.statusText}`);
    activitiesData = await response.json();
    renderCards();
    renderCategoriesTable();
  } catch (error) {
    console.error("Falha ao buscar atividades:", error);
    showToast("Erro ao carregar atividades", "error");
  }
}

// Tabela administrável de categorias, em Configurações. Lê a mesma fonte
// dos cards do painel e reaproveita os fluxos reais de criação, edição e
// exclusão — nenhum estado paralelo é mantido aqui.
function renderCategoriesTable() {
  const corpo = document.getElementById("categories-table-body");
  if (!corpo) return;

  const vazio = document.getElementById("categories-empty");
  const tabela = corpo.closest(".categories-table-scroll");
  clearElement(corpo);

  const categorias = Array.isArray(activitiesData) ? activitiesData : [];
  const semCategorias = categorias.length === 0;
  if (vazio) vazio.classList.toggle("hidden", !semCategorias);
  if (tabela) tabela.classList.toggle("hidden", semCategorias);
  if (semCategorias) return;

  for (const categoria of categorias) {
    const nome = TITLE_PT[categoria.title] || categoria.title;
    const linha = document.createElement("tr");

    const celulaNome = createElement("td", { className: "categories-cell-name" });
    celulaNome.appendChild(createElement("strong", { text: nome }));
    linha.appendChild(celulaNome);

    const celulaCor = createElement("td");
    const amostra = createElement("span", { className: "categories-swatch" });
    if (categoria.color) {
      applyDynamicStyles(amostra, { background: categoria.color });
      amostra.title = categoria.color;
    } else {
      amostra.classList.add("categories-swatch-empty");
      amostra.title = "Sem cor personalizada";
    }
    celulaCor.appendChild(amostra);
    linha.appendChild(celulaCor);

    const celulaIcone = createElement("td", {
      className: "categories-cell-icon",
      text: categoria.icon || "—"
    });
    linha.appendChild(celulaIcone);

    const celulaAcoes = createElement("td", { className: "categories-col-actions" });
    const acoes = createElement("div", { className: "categories-actions" });

    const editar = createElement("button", {
      className: "btn-icon",
      text: "✏️",
      attributes: { type: "button", "aria-label": `Editar categoria ${nome}` }
    });
    editar.addEventListener("click", () => abrirDialogoDeCategoria(categoria.id));

    const excluir = createElement("button", {
      className: "btn-icon btn-delete",
      text: "🗑️",
      attributes: { type: "button", "aria-label": `Excluir categoria ${nome}` }
    });
    excluir.addEventListener("click", () => openDeleteModal(categoria.id, categoria.title));

    acoes.appendChild(editar);
    acoes.appendChild(excluir);
    celulaAcoes.appendChild(acoes);
    linha.appendChild(celulaAcoes);

    corpo.appendChild(linha);
  }
}

async function refreshData() {
  await fetchProfileData();
  await fetchActivities();
  await updateKPIs();
}

// ============================================================
// DASHBOARD EM TEMPO REAL (Tarefa 18)
// ============================================================
//
// Polling configurável (15/20/30 s), pausa automática com a aba oculta,
// retomada com atualização imediata, trava anti-sobreposição com
// AbortController e atualização suave: os cards só são reconstruídos quando
// os dados realmente mudaram e nenhum modal/menu está aberto.

const aoVivo = {
  timerId: null,
  intervaloSegundos: 20,
  emExecucao: false,
  abortController: null,
  assinaturaAtividades: "",
  ultimaAtualizacao: null,
  falhasSeguidas: 0
};

function assinaturaDe(dados) {
  try {
    return JSON.stringify(dados);
  } catch {
    return String(Date.now());
  }
}

function interacaoAbertaNoDashboard() {
  if (document.querySelector(".modal-overlay.open")) return true;
  if (document.querySelector(".card-dropdown.open, [id^='dropdown-'].open")) return true;
  if (document.getElementById("profile-container")?.classList.contains("open")) return true;
  return false;
}

function atualizarIndicadorAoVivo(estado) {
  const dot = document.getElementById("live-dot");
  const texto = document.getElementById("live-status-text");
  const atualizado = document.getElementById("live-updated-at");
  if (!dot || !texto || !atualizado) return;

  dot.classList.remove("live-dot-ok", "live-dot-erro", "live-dot-pausado");
  if (estado === "ok") {
    dot.classList.add("live-dot-ok");
    texto.textContent = "Ao vivo";
  } else if (estado === "erro") {
    dot.classList.add("live-dot-erro");
    texto.textContent = "Reconectando…";
  } else {
    dot.classList.add("live-dot-pausado");
    texto.textContent = "Pausado";
  }

  atualizado.textContent = aoVivo.ultimaAtualizacao
    ? `· atualizado às ${aoVivo.ultimaAtualizacao.toLocaleTimeString("pt-BR")}`
    : "";
}

// Um ciclo de atualização: nunca sobrepõe outro em andamento e nunca apaga
// dados válidos já exibidos quando a rede falha temporariamente.
async function cicloAoVivo() {
  if (aoVivo.emExecucao || document.hidden) return;
  aoVivo.emExecucao = true;
  aoVivo.abortController = new AbortController();
  const { signal } = aoVivo.abortController;

  try {
    const [respostaAtividades, respostaKpis] = await Promise.all([
      apiFetch("/api/activities", { signal }),
      apiFetch("/api/dashboard/kpis", { signal })
    ]);
    if (!respostaAtividades.ok || !respostaKpis.ok) {
      throw new Error("Resposta inválida do servidor.");
    }

    const atividades = await respostaAtividades.json();
    const kpis = await respostaKpis.json();

    const novaAssinatura = assinaturaDe(atividades);
    if (novaAssinatura !== aoVivo.assinaturaAtividades && !interacaoAbertaNoDashboard()) {
      activitiesData = atividades;
      aoVivo.assinaturaAtividades = novaAssinatura;
      renderCards();
      const secaoRelatorios = document.getElementById("section-reports");
      if (secaoRelatorios && !secaoRelatorios.classList.contains("hidden")) renderReports();
    }

    aplicarKpisAoVivo(kpis);
    aoVivo.ultimaAtualizacao = new Date();
    aoVivo.falhasSeguidas = 0;
    atualizarIndicadorAoVivo("ok");
  } catch (error) {
    if (error?.name !== "AbortError") {
      aoVivo.falhasSeguidas += 1;
      atualizarIndicadorAoVivo("erro");
    }
  } finally {
    aoVivo.emExecucao = false;
    aoVivo.abortController = null;
  }
}

// Atualização suave dos KPIs sem reconstruir a tela.
function aplicarKpisAoVivo(kpis) {
  const alvoDiario = document.getElementById("kpi-daily-total");
  const alvoSemanal = document.getElementById("kpi-weekly-percent");
  const barraSemanal = document.getElementById("kpi-weekly-bar");
  if (alvoDiario) alvoDiario.textContent = `${kpis.dailyTotal}hrs`;
  if (alvoSemanal) alvoSemanal.textContent = `${kpis.weeklyGoalPercent}%`;
  if (barraSemanal) applyDynamicStyles(barraSemanal, { width: `${kpis.weeklyGoalPercent}%` });
}

function pararAoVivo() {
  if (aoVivo.timerId) {
    clearInterval(aoVivo.timerId);
    aoVivo.timerId = null;
  }
  if (aoVivo.abortController) aoVivo.abortController.abort();
}

function iniciarAoVivo(intervaloSegundos) {
  pararAoVivo();
  const permitido = [15, 20, 30];
  aoVivo.intervaloSegundos = permitido.includes(Number(intervaloSegundos))
    ? Number(intervaloSegundos)
    : 20;
  aoVivo.assinaturaAtividades = assinaturaDe(activitiesData);
  aoVivo.timerId = setInterval(cicloAoVivo, aoVivo.intervaloSegundos * 1000);
  atualizarIndicadorAoVivo(document.hidden ? "pausado" : "ok");
}

// Pausa na aba oculta e retomada ao voltar. A retomada respeita o intervalo
// configurado: alternar janelas repetidamente (Alt+Tab, trocar de aba) chamava
// o ciclo a cada evento e transformava o motor em uma sucessão contínua de
// requisições, dando a impressão de que a página recarregava sem parar.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    atualizarIndicadorAoVivo("pausado");
    if (aoVivo.abortController) aoVivo.abortController.abort();
    return;
  }

  atualizarIndicadorAoVivo("ok");

  const ultima = aoVivo.ultimaAtualizacao ? aoVivo.ultimaAtualizacao.getTime() : 0;
  const decorridoMs = Date.now() - ultima;
  if (decorridoMs < aoVivo.intervaloSegundos * 1000) return;

  cicloAoVivo();
});

// Sem vazamento de timers: o motor é encerrado ao descarregar a página.
window.addEventListener("pagehide", pararAoVivo);

// ============================================================
// MOTOR DE RECOMPENSA DOPAMINÉRGICA (Frontend / celebração)
// ============================================================

// Som de recompensa variável (varia por tier — reforço de razão variável)
function playRewardSound(tier) {
  try {
    initAudioContext();
    const now = audioCtx.currentTime;
    const master = audioCtx.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.connect(audioCtx.destination);
    // Notas por tier (mais alto/rico = melhor recompensa)
    const escalas = {
      normal: [523.25, 659.25],
      grande: [523.25, 659.25, 783.99],
      bau: [587.33, 739.99, 880.0],
      jackpot: [523.25, 659.25, 783.99, 1046.5, 1318.5]
    };
    const notas = escalas[tier] || escalas.normal;
    notas.forEach((f, i) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(f, now + i * 0.08);
      g.gain.setValueAtTime(0.0001, now + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.2 / (i + 1), now + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.6);
      o.connect(g);
      g.connect(master);
      o.start(now + i * 0.08);
      o.stop(now + i * 0.08 + 0.7);
    });
    master.gain.exponentialRampToValueAtTime(0.9, now + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
  } catch (e) {}
}

// Vibração háptica (multissensorial — só mobile com suporte)
function vibrarHaptico(tier) {
  if (!navigator.vibrate) return;
  const padroes = {
    normal: [30],
    grande: [40, 30, 40],
    bau: [50, 40, 80],
    jackpot: [80, 40, 80, 40, 120]
  };
  navigator.vibrate(padroes[tier] || [30]);
}

// GANCHO CENTRAL: toda conclusão passa por aqui
async function celebrarConclusao(context = {}) {
  let reward = null;
  try {
    const res = await apiFetch("/api/rewards/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context)
    });
    if (res.ok) reward = await res.json();
  } catch (e) {
    /* segue com celebração básica */
  }

  // Fallback: se o motor não respondeu, mantém a celebração básica
  if (!reward) {
    triggerConfetti();
    return;
  }

  // 1) Confete (intensidade variável por tier)
  if (userProfile.enable_confetti) triggerConfetti();

  // 2) Multissensorial: som + háptico (se ligado)
  if (reward.multissensorial) {
    playRewardSound(reward.tier);
    vibrarHaptico(reward.tier);
  } else {
    playCompletionBell();
  }

  // 3) Atualiza o HUD de moedas/streak
  atualizarHudRecompensa(reward);

  // 4) Mensagem RPE
  if (reward.message) showToast(reward.message, "success");

  // 5) Revela o presente (baú/jackpot ganham modal; normal só toast)
  if (reward.chest || reward.jackpot) {
    mostrarModalRecompensa(reward);
  } else {
    // Pede avaliação do presente mesmo em recompensa simples (CSAT), sem interromper o fluxo
    setTimeout(() => pedirAvaliacaoPresente(reward.event_id, reward), 900);
  }

  // 6) Dopamenu: oferece uma recompensa do cardápio (tarefa difícil / aleatório)
  if (reward.dopamenu) {
    setTimeout(
      () => showToast(`🍽️ Dopamenu: que tal "${reward.dopamenu.label}"?`, "success"),
      1600
    );
  }

  // 7) Surpresa (timing imprevisível)
  if (reward.surpresa)
    setTimeout(() => showToast(`🎉 Surpresa! ${reward.surpresa}`, "success"), 2400);
}

function atualizarHudRecompensa(reward) {
  const coins = document.getElementById("hud-coins");
  const streak = document.getElementById("hud-streak");
  const combo = document.getElementById("hud-combo");
  if (coins) coins.textContent = reward.coins_total;
  if (streak) streak.textContent = reward.streak;
  if (combo) {
    if (reward.combo > 1) {
      combo.textContent = `x${reward.combo} 🔥`;
      setComboVisibility(combo, true);
    } else {
      setComboVisibility(combo, false);
    }
  }
}

function mostrarModalRecompensa(reward) {
  const overlay = document.getElementById("modal-reward-overlay");
  if (!overlay) {
    pedirAvaliacaoPresente(reward.event_id, reward);
    return;
  }
  document.getElementById("reward-title").textContent = reward.jackpot
    ? "🎰 JACKPOT!"
    : "🎁 Baú de Recompensa!";
  document.getElementById("reward-coins").textContent = `+${reward.coins} moedas`;
  document.getElementById("reward-collectible").textContent = reward.collectible
    ? `Você ganhou: ${reward.collectible}`
    : "";
  document.getElementById("reward-message").textContent = reward.message || "";
  const anima = document.getElementById("reward-emoji");
  if (anima) anima.textContent = reward.jackpot ? "🎰" : "🎁";
  overlay.classList.add("open");
  overlay._eventId = reward.event_id;
  overlay._reward = reward;
}

// Avaliação do presente — CSAT 1 a 5 (salvo na memória do usuário para a IA)
function pedirAvaliacaoPresente(eventId, reward) {
  const overlay = document.getElementById("modal-rating-overlay");
  if (!overlay || !eventId) return;
  document.getElementById("rating-context").textContent =
    reward && reward.collectible ? reward.collectible : "sua recompensa";
  overlay._eventId = eventId;
  overlay.querySelectorAll(".rating-star").forEach((s) => s.classList.remove("sel"));
  overlay.classList.add("open");
}

async function enviarAvaliacao(eventId, rating) {
  try {
    await apiFetch("/api/rewards/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, rating })
    });
    showToast("Obrigado pela avaliação! 🧡", "success");
  } catch (e) {}
}

function initRewardModals() {
  const rewardOverlay = document.getElementById("modal-reward-overlay");
  if (rewardOverlay) {
    const fechar = () => {
      const eid = rewardOverlay._eventId,
        rw = rewardOverlay._reward;
      rewardOverlay.classList.remove("open");
      if (eid) setTimeout(() => pedirAvaliacaoPresente(eid, rw), 300);
    };
    const btn = document.getElementById("reward-close");
    if (btn) btn.addEventListener("click", fechar);
    rewardOverlay.addEventListener("click", (e) => {
      if (e.target === rewardOverlay) fechar();
    });
  }
  const ratingOverlay = document.getElementById("modal-rating-overlay");
  if (ratingOverlay) {
    ratingOverlay.querySelectorAll(".rating-star").forEach((star) => {
      star.addEventListener("click", async () => {
        const val = parseInt(star.dataset.val);
        ratingOverlay
          .querySelectorAll(".rating-star")
          .forEach((s) => s.classList.toggle("sel", parseInt(s.dataset.val) <= val));
        await enviarAvaliacao(ratingOverlay._eventId, val);
        setTimeout(() => ratingOverlay.classList.remove("open"), 500);
      });
    });
    const skip = document.getElementById("rating-skip");
    if (skip) skip.addEventListener("click", () => ratingOverlay.classList.remove("open"));
  }
  // Carrega o HUD inicial
  carregarHudInicial();
}

async function carregarHudInicial() {
  try {
    const res = await apiFetch("/api/rewards/state");
    if (!res.ok) return;
    const st = await res.json();
    const coins = document.getElementById("hud-coins");
    const streak = document.getElementById("hud-streak");
    if (coins) coins.textContent = st.coins;
    if (streak) streak.textContent = st.current_streak;
  } catch (e) {}
}

// ============================================================
// GESTÃO DE DOPAMINA (Administrador)
// ============================================================

const DOPAMINE_LABELS = {
  recompensa_variavel: "Recompensa Variável + Jackpot",
  bau_loot: "Baú / Loot Colecionável",
  combo: "Combo / Momentum",
  micro_conclusoes: "Micro-conclusões",
  antecipacao: "Antecipação Visível",
  mensagens_rpe: 'Mensagens "melhor que o esperado"',
  multissensorial: "Celebração Multissensorial",
  dopamenu: "Dopamenu (cardápio pessoal)",
  surpresa: "Recompensa em Momento Surpresa"
};

async function renderDopamineAdmin() {
  await renderDopamineToggles();
  await renderDopamineDashboard();
}

async function renderDopamineToggles() {
  const box = document.getElementById("dopamine-toggles");
  if (!box) return;
  box.textContent = "Carregando…";
  try {
    const res = await apiFetch("/api/rewards/config");
    if (!res.ok) throw new Error("Sem permissão.");
    const { generators, ai } = await res.json();
    clearElement(box);
    Object.entries(generators).forEach(([key, g]) => {
      const row = document.createElement("div");
      row.className = "admin-toggle-row";
      row.appendChild(
        createElement("span", {
          className: "admin-toggle-label",
          text: DOPAMINE_LABELS[key] || g.label
        })
      );
      const btn = createSwitchButton({
        className: "dopa-toggle",
        on: Boolean(g.enabled),
        variant: "success",
        dataset: { key },
        title: DOPAMINE_LABELS[key] || g.label
      });
      btn.addEventListener("click", async () => {
        const enabled = btn.dataset.on !== "1";
        try {
          const r = await apiFetch("/api/rewards/config", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key, enabled })
          });
          if (!r.ok)
            throw new Error(
              apiErrorMessage(await responsePayload(r), "Não foi possível atualizar o gerador.")
            );
          updateSwitchButton(btn, enabled);
          showToast(`${DOPAMINE_LABELS[key]}: ${enabled ? "ativado" : "desativado"}`, "success");
        } catch (e) {
          showToast(e.message, "error");
        }
      });
      row.appendChild(btn);
      box.appendChild(row);
    });

    // Flags de IA (não repetir / aprender preferências)
    const aiBox = document.getElementById("dopamine-ai");
    if (aiBox) {
      clearElement(aiBox);
      const flags = [
        { key: "nao_repetir", label: "IA nunca repete o mesmo prêmio" },
        { key: "aprender_preferencias", label: "IA aprende as preferências do usuário" }
      ];
      flags.forEach((f) => {
        const on = ai[f.key];
        const row = document.createElement("div");
        row.className = "admin-toggle-row";
        row.appendChild(
          createElement("span", {
            className: "admin-toggle-label",
            text: `🤖 ${f.label}`
          })
        );
        const btn = createSwitchButton({
          className: "dopa-toggle dopa-toggle-ai",
          on: Boolean(on),
          variant: "brand",
          title: f.label
        });
        btn.addEventListener("click", async () => {
          const value = btn.dataset.on !== "1";
          try {
            const r = await apiFetch("/api/rewards/ai", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ key: f.key, value })
            });
            if (!r.ok)
              throw new Error(
                apiErrorMessage(
                  await responsePayload(r),
                  "Não foi possível atualizar a configuração de IA."
                )
              );
            updateSwitchButton(btn, value);
            showToast(`${f.label}: ${value ? "ativado" : "desativado"}`, "success");
          } catch (e) {
            showToast(e.message, "error");
          }
        });
        row.appendChild(btn);
        aiBox.appendChild(row);
      });
    }
  } catch (e) {
    clearElement(box);
    box.appendChild(createElement("span", { className: "table-status-error", text: e.message }));
  }
}

async function renderDopamineDashboard() {
  const el = document.getElementById("dopamine-dashboard");
  if (!el) return;
  el.textContent = "Carregando dashboard executivo…";
  try {
    const res = await apiFetch("/api/rewards/dashboard");
    if (!res.ok) throw new Error("Sem permissão.");
    const d = await res.json();
    const money = (n) => (n || 0).toLocaleString("pt-BR");
    const createAdminCard = (title, children = []) => {
      const card = createElement("div", { className: "kanban-column admin-metric-card" });
      card.append(
        createElement("h4", { className: "admin-metric-card-title", text: title }),
        ...children
      );
      return card;
    };
    const createResponsiveTableContainer = (table) => {
      const container = createElement("div", { className: "table-responsive admin-table-scroll" });
      container.appendChild(table);
      return container;
    };

    clearElement(el);
    const topGrid = createElement("div", { className: "admin-metric-grid admin-metric-grid-top" });
    const bottomGrid = createElement("div", {
      className: "admin-metric-grid admin-metric-grid-bottom"
    });

    const top10Card = createAdminCard("🏆 Top 10 Usuários (premiar)");
    if (d.top10.length) {
      const table = createElement("table", { className: "agenda-table" });
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["#", "Usuário", "Conclusões", "Moedas", "Streak"].forEach((label) =>
        headRow.appendChild(createElement("th", { text: label }))
      );
      thead.appendChild(headRow);
      const tbody = document.createElement("tbody");
      d.top10.forEach((user, index) => {
        const row = document.createElement("tr");
        const userCell = document.createElement("td");
        userCell.append(
          document.createTextNode(user.name),
          createElement("br"),
          createElement("span", { className: "admin-inline-help", text: user.email })
        );
        row.append(
          createElement("td", { text: String(index + 1) }),
          userCell,
          createElement("td", { text: String(user.total_completions) }),
          createElement("td", { text: money(user.coins) }),
          createElement("td", { text: `${user.current_streak}🔥` })
        );
        tbody.appendChild(row);
      });
      table.append(thead, tbody);
      top10Card.appendChild(createResponsiveTableContainer(table));
    } else {
      top10Card.appendChild(
        createElement("span", { className: "admin-inline-help", text: "Ainda sem dados de uso." })
      );
    }

    const effectivenessCard = createAdminCard("🎯 Eficácia das 9 dopaminas");
    if (d.generators.length) {
      d.generators.forEach((item) => {
        const row = createElement("div", { className: "admin-metric-row" });
        row.append(
          createElement("span", {
            className: "admin-metric-row-title",
            text: DOPAMINE_LABELS[item.generator] || item.generator || "—"
          }),
          createElement("span", {
            className: "admin-inline-help",
            text: `${item.usos} usos · ⭐${(item.satisfacao_media || 0).toFixed(1)}`
          })
        );
        effectivenessCard.appendChild(row);
      });
    } else {
      effectivenessCard.appendChild(
        createElement("span", { className: "admin-inline-help", text: "Sem eventos ainda." })
      );
    }
    topGrid.append(top10Card, effectivenessCard);

    const metrics = d.metricas;
    const retentionCard = createAdminCard("📈 Retenção por Coorte");
    const retentionGrid = createElement("div", { className: "admin-retention-grid" });
    [
      ["D1", metrics.retencao.d1, "accent"],
      ["D7", metrics.retencao.d7, "accent"],
      ["D30", metrics.retencao.d30, "accent"],
      ["Total", metrics.retencao.total, "default"]
    ].forEach(([label, value, tone]) => {
      const item = createElement("div", { className: "admin-retention-item" });
      item.append(
        createElement("div", {
          className: `admin-retention-value admin-retention-${tone}`,
          text: String(value)
        }),
        createElement("div", { className: "admin-inline-help", text: label })
      );
      retentionGrid.appendChild(item);
    });
    retentionCard.appendChild(retentionGrid);

    const stickCard = createAdminCard("🧲 Stickiness (DAU/MAU)");
    stickCard.append(
      createElement("div", {
        className: "grad-nums admin-stickiness-value",
        text: `${metrics.stickiness.indice}%`
      }),
      createElement("div", {
        className: "admin-inline-help",
        text: `DAU ${metrics.stickiness.dau} / MAU ${metrics.stickiness.mau}`
      })
    );

    const abCard = createAdminCard("🧪 A/B Testing (recompensas)");
    if (metrics.ab_testing.length) {
      metrics.ab_testing.forEach((test) => {
        const row = createElement("div", { className: "admin-metric-row" });
        row.append(
          createElement("span", {
            className: "admin-metric-row-title admin-text-capitalize",
            text: test.tier
          }),
          createElement("span", {
            className: "admin-inline-help",
            text: `${test.ocorrencias}x · ⭐${test.satisfacao}`
          })
        );
        abCard.appendChild(row);
      });
    } else {
      abCard.appendChild(createElement("span", { className: "admin-inline-help", text: "—" }));
    }

    const rfmCard = createAdminCard("💎 RFM + LTV");
    if (metrics.rfm.length) {
      const table = createElement("table", { className: "agenda-table" });
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["Usuário", "R(dias)", "F", "V(moedas)"].forEach((label) =>
        headRow.appendChild(createElement("th", { text: label }))
      );
      thead.appendChild(headRow);
      const tbody = document.createElement("tbody");
      metrics.rfm.forEach((item) => {
        const row = document.createElement("tr");
        row.append(
          createElement("td", { text: item.name }),
          createElement("td", { text: String(item.recencia_dias) }),
          createElement("td", { text: String(item.frequencia) }),
          createElement("td", { text: money(item.valor_moedas) })
        );
        tbody.appendChild(row);
      });
      table.append(thead, tbody);
      rfmCard.appendChild(createResponsiveTableContainer(table));
    } else {
      rfmCard.appendChild(createElement("span", { className: "admin-inline-help", text: "—" }));
    }

    const churnCard = createAdminCard("⚠️ Churn / Usuários em risco");
    if (metrics.churn.length) {
      metrics.churn.forEach((user) => {
        churnCard.appendChild(
          createElement("div", {
            className: "admin-inline-help admin-warning-text",
            text: `⚠️ ${user.name} — ${user.ultima_atividade ? `inativo desde ${String(user.ultima_atividade).slice(0, 10)}` : "nunca ativo"}`
          })
        );
      });
    } else {
      churnCard.appendChild(
        createElement("span", {
          className: "admin-inline-help admin-success-text",
          text: "Nenhum usuário em risco 🎉"
        })
      );
    }

    const totalsCard = createAdminCard("📊 Totais");
    [
      ["Recompensas", d.totais.total_recompensas],
      ["Moedas geradas", money(d.totais.total_moedas)],
      ["Jackpots", d.totais.total_jackpots],
      ["Satisfação geral", `⭐${d.totais.satisfacao_geral}`]
    ].forEach(([label, value]) => {
      const row = createElement("div", { className: "admin-metric-total-row" });
      row.append(
        createElement("span", { className: "admin-inline-help", text: `${label}: ` }),
        createElement("strong", { className: "legend-strong", text: String(value) })
      );
      totalsCard.appendChild(row);
    });

    bottomGrid.append(retentionCard, stickCard, abCard, rfmCard, churnCard, totalsCard);
    el.append(topGrid, bottomGrid);
  } catch (e) {
    clearElement(el);
    el.appendChild(createElement("span", { className: "table-status-error", text: e.message }));
  }
}

// ============================================================
// GESTÃO DE PLANOS E FEATURE FLAGS (Administrador)
// ============================================================

const PLAN_LABELS = { administrador: "Administrador", free: "Free", plus: "Plus", pro: "Pro" };

function paymentConfigurationPayload() {
  const prices = {};
  document.querySelectorAll("[data-payment-plan-price]").forEach((input) => {
    const value = input.value.trim();
    if (value) prices[input.dataset.paymentPlanPrice] = value;
  });
  const payload = {
    enabled: Boolean(document.getElementById("payment-enabled")?.checked),
    mode: document.getElementById("payment-mode")?.value || "test",
    public_base_url: document.getElementById("payment-public-url")?.value.trim() || undefined,
    prices,
    remove_secrets: Boolean(document.getElementById("payment-remove-secrets")?.checked)
  };
  const secretKey = document.getElementById("payment-secret-key")?.value.trim();
  const webhookSecret = document.getElementById("payment-webhook-secret")?.value.trim();
  if (secretKey) payload.secret_key = secretKey;
  if (webhookSecret) payload.webhook_secret = webhookSecret;
  return payload;
}

function renderPaymentMetrics(container, metrics) {
  clearElement(container);
  const subscriptions = (metrics.subscriptions || []).reduce((total, item) => total + Number(item.total || 0), 0);
  const active = (metrics.subscriptions || [])
    .filter((item) => ["active", "past_due"].includes(item.status))
    .reduce((total, item) => total + Number(item.total || 0), 0);
  const values = [
    ["Assinaturas", subscriptions],
    ["Com acesso", active],
    ["Recebido", `R$ ${(Number(metrics.revenue?.amount_paid_cents || 0) / 100).toFixed(2).replace(".", ",")}`],
    ["Webhooks com falha", Number(metrics.webhooks?.failed || 0)]
  ];
  values.forEach(([label, value]) => {
    const card = createElement("div", { className: "payment-metric" });
    card.append(
      createElement("span", { className: "payment-metric-label", text: label }),
      createElement("strong", { className: "payment-metric-value", text: String(value) })
    );
    container.appendChild(card);
  });
}

async function renderPaymentsAdmin() {
  const form = document.getElementById("payment-config-form");
  const status = document.getElementById("payment-provider-status");
  const map = document.getElementById("payment-price-map");
  const metricsBox = document.getElementById("payment-admin-metrics");
  if (!form || !status || !map || !metricsBox) return;
  status.textContent = "Carregando…";
  status.className = "payment-status-badge";
  try {
    const [configuration, metrics] = await Promise.all([
      smartGet("/api/payments/admin/provider"),
      smartGet("/api/payments/admin/metrics")
    ]);
    document.getElementById("payment-enabled").checked = Boolean(configuration.enabled);
    document.getElementById("payment-mode").value = configuration.mode || "test";
    document.getElementById("payment-public-url").value = configuration.public_base_url || "";
    document.getElementById("payment-secret-key").value = "";
    document.getElementById("payment-webhook-secret").value = "";
    document.getElementById("payment-remove-secrets").checked = false;
    document.getElementById("payment-secret-state").textContent = configuration.has_secret_key
      ? "Configurada e criptografada"
      : "Não configurada";
    document.getElementById("payment-webhook-state").textContent = configuration.has_webhook_secret
      ? "Configurado e criptografado"
      : "Não configurado";
    document.getElementById("payment-webhook-path").textContent = configuration.webhook_path;
    status.textContent = configuration.configured && configuration.enabled ? "Operacional" : "Configuração pendente";
    status.className = configuration.configured && configuration.enabled
      ? "payment-status-badge is-ready"
      : "payment-status-badge is-pending";

    clearElement(map);
    (configuration.prices || []).forEach((price) => {
      const field = createElement("label", { className: "payment-field" });
      field.appendChild(
        createElement("span", {
          text: `${price.plan_name} · ${price.price_label}/mês`
        })
      );
      field.appendChild(
        createElement("input", {
          attributes: {
            type: "text",
            value: price.external_price_id || "",
            placeholder: "price_...",
            maxlength: "200",
            autocomplete: "off",
            "aria-label": `Price ID Stripe do plano ${price.plan_name}`
          },
          dataset: { paymentPlanPrice: price.plan_key }
        })
      );
      map.appendChild(field);
    });
    renderPaymentMetrics(metricsBox, metrics);

    if (!form.dataset.bound) {
      form.dataset.bound = "1";
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const button = document.getElementById("payment-save-button");
        button.disabled = true;
        try {
          const payload = paymentConfigurationPayload();
          await smartSend("/api/payments/admin/provider", payload, "PUT");
          showToast(
            payload.enabled
              ? "Configuração Stripe validada, criptografada e ativada."
              : payload.remove_secrets
                ? "Stripe desativado e credenciais removidas."
                : "Configuração Stripe salva com o provedor desativado.",
            "success"
          );
          await renderPaymentsAdmin();
        } catch (error) {
          showToast(error.message, "error");
        } finally {
          button.disabled = false;
        }
      });

      document.getElementById("payment-test-button").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const payload = paymentConfigurationPayload();
          delete payload.enabled;
          const result = await smartSend("/api/payments/admin/provider/test", payload);
          showToast(`Stripe confirmado no modo ${result.mode === "live" ? "produção" : "teste"}.`, "success");
        } catch (error) {
          showToast(error.message, "error");
        } finally {
          button.disabled = false;
        }
      });

      document.getElementById("payment-reconcile-button").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          const result = await smartSend("/api/payments/admin/reconcile", {});
          showToast(`${result.users} conta(s) reconciliada(s) com o Stripe.`, "success");
          await renderPaymentsAdmin();
        } catch (error) {
          showToast(error.message, "error");
        } finally {
          button.disabled = false;
        }
      });
    }
  } catch (error) {
    status.textContent = "Indisponível";
    status.className = "payment-status-badge is-error";
    clearElement(metricsBox);
    metricsBox.appendChild(createElement("p", { className: "table-status-error", text: error.message }));
  }
}

async function renderPlansAdmin() {
  const head = document.getElementById("plans-matrix-head");
  const body = document.getElementById("plans-matrix-body");
  if (!head || !body) return;
  renderPaymentsAdmin();
  clearElement(head);
  body.replaceChildren(createLoadingTableRow("Carregando…", "neutral", 8));
  try {
    const res = await apiFetch("/api/plans");
    if (!res.ok) throw new Error("Sem permissão.");
    const { plans, features, matrix } = await res.json();

    const headRow = document.createElement("tr");
    headRow.appendChild(createElement("th", { className: "text-left", text: "Funcionalidade" }));
    plans.forEach((plan) => {
      const th = createElement("th", { className: "text-center" });
      th.appendChild(document.createTextNode(PLAN_LABELS[plan.key] || plan.name));
      if (plan.price > 0) {
        th.appendChild(document.createTextNode(" "));
        th.appendChild(
          createElement("span", {
            className: "admin-inline-help",
            text: `R$${(plan.price / 100).toFixed(0)}`
          })
        );
      }
      if (!["free", "plus", "pro"].includes(plan.key)) {
        const planLabel = PLAN_LABELS[plan.key] || plan.name;
        th.appendChild(
          createActionButton({
            className: "plan-del admin-inline-delete",
            title: `Excluir plano ${planLabel}`,
            ariaLabel: `Excluir plano ${planLabel}`,
            dataset: { plan: plan.key },
            text: "×"
          })
        );
      }
      headRow.appendChild(th);
    });
    head.appendChild(headRow);

    clearElement(body);
    features.forEach((f) => {
      const tr = document.createElement("tr");
      const featureCell = createElement("td", { className: "text-left" });
      const featureLabel = f.label;
      featureCell.append(
        document.createTextNode(featureLabel),
        createActionButton({
          className: "feat-del admin-inline-delete",
          title: `Excluir funcionalidade ${featureLabel}`,
          ariaLabel: `Excluir funcionalidade ${featureLabel}`,
          dataset: { feat: f.key, featureLabel },
          text: "×"
        })
      );
      tr.appendChild(featureCell);
      plans.forEach((plan) => {
        const on = Boolean(matrix[plan.key] && matrix[plan.key][f.key]);
        const planLabel = PLAN_LABELS[plan.key] || plan.name;
        const label = planFeatureToggleLabel(featureLabel, planLabel, on);
        const cell = createElement("td", { className: "text-center" });
        cell.appendChild(
          createSwitchButton({
            className: "feat-toggle admin-plan-toggle",
            on,
            knobOn: "14px",
            knobOff: "2px",
            dataset: { plan: plan.key, feat: f.key, planLabel, featureLabel },
            title: label,
            ariaLabel: label
          })
        );
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });

    body.querySelectorAll(".feat-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const enabled = btn.dataset.on === "1" ? false : true;
        try {
          const r = await apiFetch("/api/plans/toggle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              plan_key: btn.dataset.plan,
              feature_key: btn.dataset.feat,
              enabled
            })
          });
          const d = await responsePayload(r);
          if (!r.ok)
            throw new Error(apiErrorMessage(d, "Não foi possível alterar a funcionalidade."));
          updateSwitchButton(btn, enabled);
          const label = planFeatureToggleLabel(btn.dataset.featureLabel, btn.dataset.planLabel, enabled);
          btn.title = label;
          btn.setAttribute("aria-label", label);
        } catch (e) {
          showToast(e.message, "error");
        }
      });
    });

    head.querySelectorAll(".plan-del").forEach((b) =>
      b.addEventListener("click", async () => {
        const dialog = await showAppDialog({
          title: "Excluir plano",
          description:
            "Deseja excluir permanentemente este plano? A operação só será permitida se nenhum usuário estiver vinculado a ele.",
          confirmText: "Excluir plano",
          tone: "danger"
        });
        if (!dialog.confirmed) return;
        try {
          const r = await apiFetch(`/api/plans/${b.dataset.plan}`, { method: "DELETE" });
          const d = await responsePayload(r);
          if (!r.ok) throw new Error(apiErrorMessage(d, "Não foi possível excluir o plano."));
          showToast("Plano excluído.", "success");
          renderPlansAdmin();
        } catch (e) {
          showToast(e.message, "error");
        }
      })
    );
    body.querySelectorAll(".feat-del").forEach((b) =>
      b.addEventListener("click", async () => {
        const dialog = await showAppDialog({
          title: "Excluir funcionalidade",
          description: "Excluir esta funcionalidade de todos os planos?",
          confirmText: "Excluir funcionalidade",
          tone: "danger"
        });
        if (!dialog.confirmed) return;
        try {
          const r = await apiFetch(`/api/features/${b.dataset.feat}`, { method: "DELETE" });
          const d = await responsePayload(r);
          if (!r.ok)
            throw new Error(apiErrorMessage(d, "Não foi possível excluir a funcionalidade."));
          showToast("Funcionalidade excluída.", "success");
          renderPlansAdmin();
        } catch (e) {
          showToast(e.message, "error");
        }
      })
    );
  } catch (e) {
    body.replaceChildren(createLoadingTableRow(e.message, "error", 8));
  }
}

function initPlansAdmin() {
  const btnPlan = document.getElementById("btn-add-plan");
  const btnFeat = document.getElementById("btn-add-feature");
  if (btnPlan)
    btnPlan.addEventListener("click", async () => {
      const dialog = await showAppDialog({
        title: "Criar novo plano",
        description: "Informe os dados do plano administrativo.",
        confirmText: "Criar plano",
        fields: [
          { name: "name", label: "Nome do plano", required: true },
          {
            name: "key",
            label: "Chave única",
            required: true,
            placeholder: "enterprise",
            transform: (value) => value.toLowerCase(),
            validate: (value) =>
              /^[a-z0-9_]+$/.test(value)
                ? ""
                : "Use apenas letras minúsculas, números e underline na chave."
          },
          {
            name: "price",
            label: "Preço em centavos",
            type: "number",
            value: "0",
            required: true,
            min: 0,
            step: 1,
            transform: (value) => Number(value),
            validate: (value) =>
              Number.isSafeInteger(Number(value)) && Number(value) >= 0
                ? ""
                : "Informe um preço inteiro em centavos, igual ou maior que zero."
          }
        ]
      });
      if (!dialog.confirmed) return;
      const { name, key, price } = dialog.values;
      try {
        const r = await apiFetch("/api/plans", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, name, price })
        });
        const d = await responsePayload(r);
        if (!r.ok) throw new Error(apiErrorMessage(d, "Não foi possível criar o plano."));
        showToast("Plano criado.", "success");
        renderPlansAdmin();
      } catch (e) {
        showToast(e.message, "error");
      }
    });
  if (btnFeat)
    btnFeat.addEventListener("click", async () => {
      const dialog = await showAppDialog({
        title: "Criar funcionalidade",
        description: "Cadastre a nova funcionalidade que poderá ser liberada por plano.",
        confirmText: "Criar funcionalidade",
        fields: [
          { name: "label", label: "Nome da funcionalidade", required: true },
          {
            name: "key",
            label: "Chave única",
            required: true,
            placeholder: "relatorios_avancados",
            transform: (value) => value.toLowerCase(),
            validate: (value) =>
              /^[a-z0-9_]+$/.test(value)
                ? ""
                : "Use apenas letras minúsculas, números e underline na chave."
          }
        ]
      });
      if (!dialog.confirmed) return;
      const { label, key } = dialog.values;
      try {
        const r = await apiFetch("/api/features", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, label })
        });
        const d = await responsePayload(r);
        if (!r.ok) throw new Error(apiErrorMessage(d, "Não foi possível criar a funcionalidade."));
        showToast("Funcionalidade criada.", "success");
        renderPlansAdmin();
      } catch (e) {
        showToast(e.message, "error");
      }
    });
}

// ============================================================
// AUTENTICAÇÃO E CONTROLE DE ACESSO (Frontend)
// ============================================================

let currentUser = null;

// Verifica a sessão; se não autenticado, redireciona para o login.
// Retorna true se autenticado, false caso contrário.
async function checkAuthOrRedirect() {
  try {
    const res = await apiFetch("/api/auth/me");
    if (!res.ok) {
      redirectToLogin();
      return false;
    }
    currentUser = await responsePayload(res);
    await loadCsrfToken();
    return true;
  } catch {
    redirectToLogin();
    return false;
  }
}

// Aplica as permissões por perfil na interface
function applyRolePermissions() {
  if (!currentUser) return;
  const isAdmin = currentUser.role === ROLE_ADMIN;

  // Configurações: SOMENTE administrador
  const navSettings = document.getElementById("nav-settings");
  toggleElementHidden(navSettings, !isAdmin);

  // Menu de Usuários (gestão): SOMENTE administrador
  const navUsers = document.getElementById("nav-users");
  toggleElementHidden(navUsers, !isAdmin);

  // Menu de Planos (gestão): SOMENTE administrador
  const navPlans = document.getElementById("nav-plans");
  toggleElementHidden(navPlans, !isAdmin);

  // Menu de Gestão de Dopamina: SOMENTE administrador
  const navDopamine = document.getElementById("nav-dopamine");
  toggleElementHidden(navDopamine, !isAdmin);

  // Menu de Configurações de IA: SOMENTE administrador
  const navIa = document.getElementById("nav-ai");
  toggleElementHidden(navIa, !isAdmin);

  // Menu de Recursos Inteligentes (governança): SOMENTE administrador
  const navSmart = document.getElementById("nav-smart");
  toggleElementHidden(navSmart, !isAdmin);

  // Exibe o perfil atual no dropdown
  const roleBadge = document.getElementById("profile-role-badge");
  if (roleBadge) {
    const roleName = currentUser.role === ROLE_ADMIN ? "Administrador" : "Usuário";
    const planName = currentUser.plan
      ? currentUser.plan.charAt(0).toUpperCase() + currentUser.plan.slice(1)
      : "";
    roleBadge.textContent = planName ? `${roleName} · ${planName}` : roleName;
  }
}

// Bloqueia a navegação para seções restritas conforme o perfil
function canAccessSection(section) {
  const isAdmin = currentUser && currentUser.role === ROLE_ADMIN;
  if (
    (section === "settings" ||
      section === "users" ||
      section === "plans" ||
      section === "dopamine" ||
      section === "ai" ||
      section === "smart") &&
    !isAdmin
  )
    return false;
  // Seções vinculadas a funcionalidades de plano: administrador tem acesso
  // integral; os demais dependem da matriz liberada pelo administrador.
  const featureKey = SECTION_FEATURE[section];
  if (featureKey && !isAdmin && !canUseFeature(featureKey)) return false;
  return true;
}

// ============================================================
// RECURSOS INTELIGENTES — Governança administrável (Tarefa 35)
// ------------------------------------------------------------
// Cards clicáveis por recurso (ligar/desligar) + painel lateral de
// configuração (parâmetros reais, vínculo de IA, dry-run e auditoria).
// Tudo CSP-safe (createElement/dataset), consumindo /api/admin/smart-features.
// ============================================================

const SMART_CATEGORY_LABELS = Object.freeze({
  capacidade: "Capacidade",
  planejamento: "Planejamento",
  registro: "Registro",
  foco: "Foco",
  captura: "Captura",
  lembretes: "Lembretes",
  coaching: "Coaching",
  simulacao: "Simulação",
  "bem-estar": "Bem-estar",
  geral: "Geral"
});

const SMART_CATEGORY_ICON = Object.freeze({
  capacidade: "🔋",
  planejamento: "🗓️",
  registro: "🧭",
  foco: "🎯",
  captura: "🧠",
  lembretes: "🔔",
  coaching: "📈",
  simulacao: "🔮",
  "bem-estar": "🌱",
  geral: "✨"
});

let smartFeaturesCache = [];
let smartFeatureTemplatesCache = [];
let smartReminderPollTimer = null;
const smartReminderSeen = new Set();

async function pollSmartReminders() {
  try {
    const data = await smartGet("/api/smart/reminders/due");
    for (const reminder of data.reminders || []) {
      const signature = `${reminder.id}:${reminder.level}`;
      if (smartReminderSeen.has(signature)) continue;
      smartReminderSeen.add(signature);
      if ("Notification" in window && Notification.permission === "granted") {
        const notification = new Notification("Kairo · Lembrete", {
          body: reminder.title,
          tag: `kairo-reminder-${reminder.id}`,
          renotify: true
        });
        notification.addEventListener("click", () => {
          window.focus();
          switchSection("myfeatures");
          notification.close();
        });
      } else {
        showToast(`Lembrete: ${reminder.title}`, "warning");
      }
      await smartSend("/api/smart/reminders/escalate", { id: reminder.id });
    }
  } catch {
    // O polling é auxiliar e não pode interromper a navegação do usuário.
  }
}

function configureSmartReminderPolling(enabled) {
  if (smartReminderPollTimer) {
    clearInterval(smartReminderPollTimer);
    smartReminderPollTimer = null;
  }
  if (!enabled) return;
  pollSmartReminders();
  smartReminderPollTimer = setInterval(pollSmartReminders, 60_000);
}

async function renderSmartAdmin() {
  const grid = document.getElementById("smart-admin-grid");
  const counter = document.getElementById("smart-admin-counter");
  if (!grid) return;
  clearElement(grid);
  grid.appendChild(createElement("p", { className: "smart-admin-loading", text: "Carregando recursos inteligentes…" }));

  const refreshBtn = document.getElementById("smart-admin-refresh");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "1";
    refreshBtn.addEventListener("click", () => renderSmartAdmin());
  }
  const createBtn = document.getElementById("smart-admin-create");
  if (createBtn && !createBtn.dataset.bound) {
    createBtn.dataset.bound = "1";
    createBtn.addEventListener("click", createSmartFeature);
  }

  try {
    const res = await apiFetch("/api/admin/smart-features");
    if (!res.ok) {
      throw new Error(apiErrorMessage(await responsePayload(res), "Sem permissão para acessar os recursos."));
    }
    const { features, templates } = await res.json();
    smartFeaturesCache = Array.isArray(features) ? features : [];
    smartFeatureTemplatesCache = Array.isArray(templates) ? templates : [];
    if (createBtn) {
      const available = smartFeatureTemplatesCache.some((template) => template.available);
      createBtn.disabled = !available;
      createBtn.title = available
        ? "Adicionar um recurso homologado ao catálogo"
        : "Todos os recursos homologados já estão registrados";
    }
    clearElement(grid);

    if (smartFeaturesCache.length === 0) {
      grid.appendChild(createElement("p", { className: "smart-admin-loading", text: "Nenhum recurso registrado." }));
      return;
    }

    smartFeaturesCache.forEach((feature) => grid.appendChild(buildSmartCard(feature)));
    const ativos = smartFeaturesCache.filter((f) => f.enabled).length;
    if (counter) counter.textContent = `${ativos} de ${smartFeaturesCache.length} ativos`;
  } catch (error) {
    clearElement(grid);
    grid.appendChild(createElement("p", { className: "smart-admin-loading", text: error.message }));
  }
}

async function createSmartFeature() {
  const available = smartFeatureTemplatesCache.filter((template) => template.available);
  if (available.length === 0) {
    showToast("Todos os recursos homologados já estão registrados.", "warning");
    return;
  }
  const dialog = await showAppDialog({
    title: "Adicionar recurso inteligente",
    description:
      "Selecione um engine homologado. Ele será restaurado desativado para configuração segura antes do uso.",
    fields: [
      {
        name: "key",
        label: "Recurso homologado",
        type: "select",
        required: true,
        options: available.map((template) => ({ value: template.key, label: template.name }))
      }
    ],
    confirmText: "Adicionar recurso"
  });
  if (!dialog.confirmed) return;
  const response = await apiFetch("/api/admin/smart-features", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key: dialog.values.key })
  });
  const payload = await responsePayload(response);
  if (!response.ok) {
    showToast(apiErrorMessage(payload, "Não foi possível adicionar o recurso."), "error");
    return;
  }
  showToast(`${payload.name} adicionado ao catálogo.`, "success");
  await renderSmartAdmin();
}

function buildSmartCard(feature) {
  const categoria = SMART_CATEGORY_LABELS[feature.category] || feature.category;
  const icone = SMART_CATEGORY_ICON[feature.category] || "✨";

  const card = createElement("article", {
    className: "smart-card",
    dataset: { key: feature.key, on: feature.enabled ? "1" : "0" }
  });

  const header = createElement("div", { className: "smart-card-head" });
  header.appendChild(
    createElement("div", {
      className: "smart-card-icon",
      text: icone,
      attributes: { "aria-hidden": "true" }
    })
  );

  const titleWrap = createElement("div", { className: "smart-card-titles" });
  titleWrap.appendChild(createElement("h3", { className: "smart-card-name", text: feature.name }));
  const badges = createElement("div", { className: "smart-card-badges" });
  badges.appendChild(createElement("span", { className: "smart-badge smart-badge-cat", text: categoria }));
  if (feature.requires_ai) {
    badges.appendChild(createElement("span", { className: "smart-badge smart-badge-ai", text: "IA opcional" }));
  }
  titleWrap.appendChild(badges);
  header.appendChild(titleWrap);

  const toggle = createSwitchButton({
    className: "smart-card-switch",
    on: Boolean(feature.enabled),
    variant: "success",
    dataset: { key: feature.key },
    title: feature.enabled ? "Desativar recurso" : "Ativar recurso"
  });
  toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleSmartFeature(feature.key, toggle.dataset.on !== "1", card, toggle);
  });
  header.appendChild(toggle);
  card.appendChild(header);

  card.appendChild(createElement("p", { className: "smart-card-desc", text: feature.description }));

  const footer = createElement("div", { className: "smart-card-foot" });
  footer.appendChild(
    createElement("span", {
      className: feature.enabled ? "smart-card-state on" : "smart-card-state off",
      text: feature.enabled ? "Ativo" : "Desativado"
    })
  );
  const configBtn = createElement("button", {
    className: "btn-secondary smart-card-config",
    text: "Configurar",
    attributes: { type: "button", "aria-label": `Configurar ${feature.name}` }
  });
  configBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openSmartConfig(feature.key);
  });
  footer.appendChild(configBtn);
  card.appendChild(footer);

  card.addEventListener("click", () => openSmartConfig(feature.key));
  return card;
}

async function toggleSmartFeature(key, enabled, cardEl, toggleEl) {
  try {
    const res = await apiFetch(`/api/admin/smart-features/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled })
    });
    if (!res.ok) {
      throw new Error(apiErrorMessage(await responsePayload(res), "Não foi possível atualizar o recurso."));
    }
    const feature = await res.json();
    updateSwitchButton(toggleEl, feature.enabled);
    if (cardEl) {
      cardEl.dataset.on = feature.enabled ? "1" : "0";
      const state = cardEl.querySelector(".smart-card-state");
      if (state) {
        state.textContent = feature.enabled ? "Ativo" : "Desativado";
        state.className = feature.enabled ? "smart-card-state on" : "smart-card-state off";
      }
    }
    const cached = smartFeaturesCache.find((f) => f.key === key);
    if (cached) cached.enabled = feature.enabled;
    const counter = document.getElementById("smart-admin-counter");
    if (counter) {
      const ativos = smartFeaturesCache.filter((f) => f.enabled).length;
      counter.textContent = `${ativos} de ${smartFeaturesCache.length} ativos`;
    }
    showToast(`${feature.name}: ${feature.enabled ? "ativado" : "desativado"}`, "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

function closeSmartConfig() {
  const drawer = document.getElementById("smart-config-drawer");
  const overlay = document.getElementById("smart-config-overlay");
  if (drawer) drawer.classList.add("hidden");
  if (overlay) overlay.classList.add("hidden");
}

function buildSmartParamField(chave, valor) {
  const wrapper = createElement("label", { className: "smart-field" });
  wrapper.appendChild(createElement("span", { className: "smart-field-label", text: chave }));
  let getValue;

  if (typeof valor === "boolean") {
    const sw = createSwitchButton({ className: "smart-field-switch", on: valor, variant: "success", title: chave });
    sw.addEventListener("click", () => updateSwitchButton(sw, sw.dataset.on !== "1"));
    wrapper.appendChild(sw);
    getValue = () => sw.dataset.on === "1";
  } else if (typeof valor === "number") {
    const input = createElement("input", {
      className: "smart-field-input",
      attributes: { type: "number", step: "any", value: String(valor) }
    });
    wrapper.appendChild(input);
    getValue = () => (input.value.trim() === "" ? valor : Number(input.value));
  } else if (Array.isArray(valor) || (valor && typeof valor === "object")) {
    const input = createElement("input", {
      className: "smart-field-input",
      attributes: { type: "text", value: JSON.stringify(valor) }
    });
    wrapper.appendChild(input);
    wrapper.appendChild(createElement("span", { className: "smart-field-hint", text: "Formato JSON" }));
    getValue = () => {
      try {
        return JSON.parse(input.value);
      } catch {
        return valor;
      }
    };
  } else {
    const input = createElement("input", {
      className: "smart-field-input",
      attributes: { type: "text", value: valor == null ? "" : String(valor) }
    });
    wrapper.appendChild(input);
    getValue = () => input.value;
  }

  return { wrapper, getValue };
}

async function openSmartConfig(key) {
  const drawer = document.getElementById("smart-config-drawer");
  const overlay = document.getElementById("smart-config-overlay");
  const inner = document.getElementById("smart-config-drawer-inner");
  if (!drawer || !inner) return;

  clearElement(inner);
  inner.appendChild(createElement("p", { className: "smart-admin-loading", text: "Carregando configuração…" }));
  drawer.classList.remove("hidden");
  if (overlay) {
    overlay.classList.remove("hidden");
    if (!overlay.dataset.bound) {
      overlay.dataset.bound = "1";
      overlay.addEventListener("click", closeSmartConfig);
    }
  }

  try {
    const res = await apiFetch(`/api/admin/smart-features/${encodeURIComponent(key)}`);
    if (!res.ok) {
      throw new Error(apiErrorMessage(await responsePayload(res), "Recurso não encontrado."));
    }
    const feature = await res.json();
    clearElement(inner);

    const head = createElement("div", { className: "smart-config-head" });
    head.appendChild(createElement("h3", { className: "smart-config-title", text: feature.name, attributes: { id: "smart-config-title" } }));
    const closeBtn = createElement("button", {
      className: "smart-config-close",
      text: "×",
      attributes: { type: "button", "aria-label": "Fechar" }
    });
    closeBtn.addEventListener("click", closeSmartConfig);
    head.appendChild(closeBtn);
    inner.appendChild(head);

    inner.appendChild(createElement("p", { className: "smart-config-desc", text: feature.description }));

    // Parâmetros: mescla defaults com os valores salvos.
    const paramsBase = { ...(feature.default_params || {}), ...(feature.params || {}) };
    const form = createElement("div", { className: "smart-config-form" });
    const nameField = buildSmartParamField("nome", feature.name);
    const descriptionField = buildSmartParamField("descrição", feature.description);
    const categoryField = buildSmartParamField("categoria", feature.category);
    const requiresAiField = buildSmartParamField("requer_ia", Boolean(feature.requires_ai));
    form.append(
      nameField.wrapper,
      descriptionField.wrapper,
      categoryField.wrapper,
      requiresAiField.wrapper
    );
    const getters = {};
    Object.keys(paramsBase).forEach((chave) => {
      const field = buildSmartParamField(chave, paramsBase[chave]);
      getters[chave] = field.getValue;
      form.appendChild(field.wrapper);
    });

    // Vínculo opcional de IA (conexão + artefato de treinamento).
    const aiConn = buildSmartParamField("ai_connection_id", feature.ai_connection_id ?? "");
    const aiArt = buildSmartParamField("ai_artifact_id", feature.ai_artifact_id ?? "");
    form.appendChild(aiConn.wrapper);
    form.appendChild(aiArt.wrapper);
    inner.appendChild(form);

    const actions = createElement("div", { className: "smart-config-actions" });
    const saveBtn = createElement("button", { className: "btn-primary", text: "Salvar", attributes: { type: "button" } });
    const testBtn = createElement("button", { className: "btn-secondary", text: "Testar (dry-run)", attributes: { type: "button" } });
    const auditBtn = createElement("button", { className: "btn-secondary", text: "Auditoria", attributes: { type: "button" } });
    const deleteBtn = createElement("button", { className: "btn-danger", text: "Excluir recurso", attributes: { type: "button" } });
    actions.appendChild(saveBtn);
    actions.appendChild(testBtn);
    actions.appendChild(auditBtn);
    actions.appendChild(deleteBtn);
    if (key === "emotional_map") {
      const privacyBtn = createElement("button", {
        className: "btn-secondary",
        text: "Agregado de privacidade",
        attributes: { type: "button" }
      });
      privacyBtn.addEventListener("click", async () => {
        const response = await apiFetch(
          "/api/admin/smart-features/privacy/emotional-summary"
        );
        const payload = await responsePayload(response);
        if (!response.ok) {
          showToast(apiErrorMessage(payload, "Falha ao carregar agregado."), "error");
          return;
        }
        clearElement(result);
        result.appendChild(
          createElement("p", {
            className: payload.privacy_threshold_met ? "smart-config-ok" : "smart-config-desc",
            text: payload.privacy_threshold_met
              ? `${payload.users} usuários · ${payload.checkins} check-ins anônimos`
              : payload.message
          })
        );
      });
      actions.appendChild(privacyBtn);
    }
    inner.appendChild(actions);

    const result = createElement("div", { className: "smart-config-result", attributes: { "aria-live": "polite" } });
    inner.appendChild(result);

    saveBtn.addEventListener("click", async () => {
      const params = {};
      Object.entries(getters).forEach(([chave, getter]) => {
        params[chave] = getter();
      });
      const connRaw = String(aiConn.getValue()).trim();
      const artRaw = String(aiArt.getValue()).trim();
      const payload = {
        name: String(nameField.getValue()).trim(),
        description: String(descriptionField.getValue()).trim(),
        category: String(categoryField.getValue()).trim(),
        requires_ai: Boolean(requiresAiField.getValue()),
        params,
        ai_connection_id: connRaw === "" ? null : Number(connRaw),
        ai_artifact_id: artRaw === "" ? null : Number(artRaw)
      };
      try {
        const r = await apiFetch(`/api/admin/smart-features/${encodeURIComponent(key)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!r.ok) {
          throw new Error(apiErrorMessage(await responsePayload(r), "Não foi possível salvar."));
        }
        showToast("Configuração salva.", "success");
        renderSmartAdmin();
      } catch (error) {
        showToast(error.message, "error");
      }
    });

    deleteBtn.addEventListener("click", async () => {
      const dialog = await showAppDialog({
        title: `Excluir ${feature.name}?`,
        description:
          "O recurso precisa estar desativado. Dados funcionais já criados pelos usuários não serão apagados; o histórico administrativo será preservado.",
        confirmText: "Excluir recurso",
        tone: "danger"
      });
      if (!dialog.confirmed) return;
      const response = await apiFetch(`/api/admin/smart-features/${encodeURIComponent(key)}`, {
        method: "DELETE"
      });
      const payload = await responsePayload(response);
      if (!response.ok) {
        showToast(apiErrorMessage(payload, "Não foi possível excluir o recurso."), "error");
        return;
      }
      closeSmartConfig();
      showToast("Recurso removido do catálogo.", "success");
      await renderSmartAdmin();
    });

    testBtn.addEventListener("click", async () => {
      clearElement(result);
      try {
        const r = await apiFetch(`/api/admin/smart-features/${encodeURIComponent(key)}/test`, { method: "POST" });
        if (!r.ok) {
          throw new Error(apiErrorMessage(await responsePayload(r), "Falha no teste."));
        }
        const data = await r.json();
        result.appendChild(
          createElement("p", {
            className: data.ready ? "smart-config-ok" : "smart-config-fail",
            text: data.ready ? "Pronto para uso ✓" : "Configuração com pendências ✗"
          })
        );
        (data.checks || []).forEach((c) => {
          result.appendChild(
            createElement("div", {
              className: "smart-check-row",
              text: `${c.ok ? "✓" : "✗"} ${c.nome}`
            })
          );
        });
      } catch (error) {
        showToast(error.message, "error");
      }
    });

    auditBtn.addEventListener("click", async () => {
      clearElement(result);
      try {
        const r = await apiFetch(`/api/admin/smart-features/${encodeURIComponent(key)}/audit`);
        if (!r.ok) {
          throw new Error(apiErrorMessage(await responsePayload(r), "Falha ao carregar auditoria."));
        }
        const data = await r.json();
        const eventos = data.events || [];
        if (eventos.length === 0) {
          result.appendChild(createElement("p", { className: "smart-config-desc", text: "Sem eventos de auditoria." }));
          return;
        }
        eventos.slice(0, 20).forEach((ev) => {
          result.appendChild(
            createElement("div", {
              className: "smart-audit-row",
              text: `${ev.created_at} · ${ev.action}${ev.detail ? " · " + ev.detail : ""}`
            })
          );
        });
      } catch (error) {
        showToast(error.message, "error");
      }
    });
  } catch (error) {
    clearElement(inner);
    inner.appendChild(createElement("p", { className: "smart-admin-loading", text: error.message }));
  }
}

// ============================================================
// MEUS RECURSOS — Consumo do usuário (Tarefa 35 — UI de usuário)
// ------------------------------------------------------------
// Descobre os recursos habilitados pelo administrador (GET /api/smart/features)
// e renderiza, para cada um, um widget funcional real consumindo o engine
// correspondente. Mobile-first e CSP-safe (createElement/dataset).
// ============================================================

async function smartGet(path) {
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(apiErrorMessage(await responsePayload(res), "Falha ao carregar."));
  return res.json();
}

async function smartSend(path, body, method = "POST") {
  const res = await apiFetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!res.ok) throw new Error(apiErrorMessage(await responsePayload(res), "Não foi possível concluir."));
  return res.json();
}

function myFeatureShell(feature) {
  const card = createElement("article", { className: "myf-card", dataset: { key: feature.key } });
  const head = createElement("div", { className: "myf-card-head" });
  head.appendChild(
    createElement("div", {
      className: "smart-card-icon",
      text: SMART_CATEGORY_ICON[feature.category] || "✨",
      attributes: { "aria-hidden": "true" }
    })
  );
  const titles = createElement("div", { className: "myf-card-titles" });
  titles.appendChild(createElement("h3", { className: "myf-card-name", text: feature.name }));
  titles.appendChild(
    createElement("span", {
      className: "smart-badge smart-badge-cat",
      text: SMART_CATEGORY_LABELS[feature.category] || feature.category
    })
  );
  head.appendChild(titles);
  card.appendChild(head);
  card.appendChild(createElement("p", { className: "myf-card-desc", text: feature.description }));
  const body = createElement("div", { className: "myf-card-body" });
  card.appendChild(body);
  return { card, body };
}

function myfResultBox() {
  return createElement("div", { className: "myf-result", attributes: { "aria-live": "polite" } });
}

function myfActionButton(label, handler, variant = "btn-primary") {
  const btn = createElement("button", { className: `${variant} myf-action`, text: label, attributes: { type: "button" } });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await handler();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      btn.disabled = false;
    }
  });
  return btn;
}

function myfInput(labelText, attrs) {
  const wrap = createElement("label", { className: "myf-field" });
  wrap.appendChild(createElement("span", { className: "myf-field-label", text: labelText }));
  const input = createElement("input", { className: "myf-field-input", attributes: attrs });
  wrap.appendChild(input);
  return { wrap, input };
}

function appendSmartAiSupport(body, feature) {
  if (!feature.ai_available) return;
  const output = createElement("div", {
    className: "myf-ai-result hidden",
    attributes: { "aria-live": "polite" }
  });
  const button = myfActionButton(
    "Pedir apoio à IA",
    async () => {
      const dialog = await showAppDialog({
        title: `Apoio de IA · ${feature.name}`,
        description:
          "O resumo visível deste recurso será enviado ao modelo configurado pelo administrador. Se o provedor for remoto, esta confirmação registra seu consentimento para este envio específico.",
        fields: [
          {
            name: "purpose",
            label: "Como a IA deve ajudar?",
            type: "select",
            options: [
              { value: "sugerir", label: "Sugerir próximos passos" },
              { value: "explicar", label: "Explicar os dados" },
              { value: "coaching", label: "Oferecer coaching" },
              { value: "reescrever", label: "Reescrever como plano" }
            ]
          }
        ],
        confirmText: "Enviar ao modelo"
      });
      if (!dialog.confirmed) return;
      const result = await smartSend(
        `/api/smart/features/${encodeURIComponent(feature.key)}/ai-assistance`,
        {
          purpose: dialog.values.purpose,
          consent_remote: true,
          context: {
            resource: feature.name,
            visible_summary: String(body.innerText || "").slice(0, 3000),
            requested_at: new Date().toISOString()
          }
        }
      );
      clearElement(output);
      output.classList.remove("hidden");
      output.append(
        createElement("span", {
          className: "myf-ai-badge",
          text: `${result.is_local ? "IA local" : "IA remota"} · ${result.model}`
        }),
        createElement("p", { text: result.text })
      );
    },
    "btn-secondary"
  );
  button.classList.add("myf-ai-action");
  body.append(button, output);
}

function appendSmartPrivacyAction(body, feature) {
  const endpoints = {
    passive_tracking: {
      path: "/api/smart/passive",
      title: "Excluir sinais de uso",
      description:
        "Remove definitivamente todas as sessões passivas deste usuário. Sugestões derivadas deixarão de existir."
    },
    emotional_map: {
      path: "/api/smart/emotional",
      title: "Excluir dados emocionais",
      description:
        "Remove definitivamente todos os check-ins emocionais criptografados deste usuário e as correlações derivadas."
    }
  };
  const config = endpoints[feature.key];
  if (!config) return;
  body.appendChild(
    myfActionButton(
      config.title,
      async () => {
        const dialog = await showAppDialog({
          title: config.title,
          description: config.description,
          confirmText: "Excluir meus dados",
          tone: "danger"
        });
        if (!dialog.confirmed) return;
        const result = await smartSend(config.path, {}, "DELETE");
        showToast(`${result.deleted} registro(s) excluído(s).`, "success");
        await renderMyFeatures();
      },
      "btn-secondary"
    )
  );
}

async function renderMyFeatures() {
  const grid = document.getElementById("myfeatures-grid");
  if (!grid) return;
  clearElement(grid);
  grid.appendChild(createElement("p", { className: "smart-admin-loading", text: "Carregando seus recursos…" }));

  const refreshBtn = document.getElementById("myfeatures-refresh");
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound = "1";
    refreshBtn.addEventListener("click", () => renderMyFeatures());
  }

  renderBilling();

  try {
    const { features } = await smartGet("/api/smart/features");
    clearElement(grid);
    const lista = Array.isArray(features) ? features : [];
    const habilitados = lista.filter((f) => f.enabled);
    configureSmartReminderPolling(
      habilitados.some((feature) => feature.key === "persistent_reminders")
    );

    if (habilitados.length === 0) {
      grid.appendChild(
        createElement("p", {
          className: "smart-admin-loading",
          text: "Nenhum recurso inteligente está ativo no momento. Peça ao administrador para ativar."
        })
      );
      return;
    }

    habilitados.forEach((feature) => {
      const { card, body } = myFeatureShell(feature);
      const widget = MYF_WIDGETS[feature.key];
      if (widget) {
        widget(body, feature);
      } else {
        body.appendChild(createElement("p", { className: "myf-card-desc", text: "Recurso ativo." }));
      }
      appendSmartAiSupport(body, feature);
      appendSmartPrivacyAction(body, feature);
      grid.appendChild(card);
    });
  } catch (error) {
    clearElement(grid);
    grid.appendChild(createElement("p", { className: "smart-admin-loading", text: error.message }));
  }
}

// ---- Assinatura / planos (Tarefa 13 — UI de usuário) ----
async function renderBilling() {
  const panel = document.getElementById("billing-panel");
  if (!panel) return;
  clearElement(panel);
  try {
    const query = new URLSearchParams(window.location.search);
    const paymentReturn = query.get("pagamento");
    const checkoutSessionId = query.get("sessao");
    if (paymentReturn === "sucesso") {
      const notice = createElement("div", { className: "billing-return is-processing" });
      notice.append(
        createElement("strong", { text: "Retorno seguro do Stripe recebido" }),
        createElement("span", { text: "Confirmando a sessão, a fatura e o plano antes de liberar o acesso…" })
      );
      panel.appendChild(notice);
      try {
        if (!checkoutSessionId) throw new Error("O Stripe não devolveu o identificador da sessão.");
        const result = await smartSend("/api/payments/reconcile", {
          checkout_session_id: checkoutSessionId
        });
        await checkAuthOrRedirect();
        await loadPlanCapabilities();
        applyRolePermissions();
        if (result.checkout?.confirmed) {
          notice.className = "billing-return is-success";
          notice.firstChild.textContent = "Pagamento confirmado";
          notice.lastChild.textContent = `Seu plano ${String(result.checkout.plan_key || "").toUpperCase()} já está ativo.`;
        } else {
          notice.className = "billing-return is-pending";
          notice.firstChild.textContent = "Confirmação ainda pendente";
          notice.lastChild.textContent = "O Stripe ainda está processando a cobrança. Atualize o status em instantes.";
        }
      } catch (error) {
        notice.className = "billing-return is-pending";
        notice.lastChild.textContent = `${error.message} Você pode atualizar o status novamente abaixo.`;
      }
      query.delete("pagamento");
      query.delete("sessao");
      const cleanUrl = `${window.location.pathname}${query.size ? `?${query}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", cleanUrl);
    } else if (paymentReturn === "cancelado") {
      const notice = createElement("div", { className: "billing-return is-pending" });
      notice.append(
        createElement("strong", { text: "Checkout interrompido" }),
        createElement("span", { text: "Nenhuma confirmação de pagamento foi aplicada ao seu plano." })
      );
      panel.appendChild(notice);
      query.delete("pagamento");
      query.delete("sessao");
      const cleanUrl = `${window.location.pathname}${query.size ? `?${query}` : ""}${window.location.hash}`;
      window.history.replaceState({}, "", cleanUrl);
    }

    const [plansPayload, subscriptionPayload] = await Promise.all([
      smartGet("/api/payments/plans"),
      smartGet("/api/payments/subscription")
    ]);
    const { plans, provider } = plansPayload;
    const { subscription, invoices } = subscriptionPayload;
    const planoAtual = (currentUser && currentUser.plan) || "free";

    const head = createElement("div", { className: "billing-head" });
    const titleGroup = createElement("div", { className: "billing-title-group" });
    titleGroup.append(
      createElement("h3", { className: "billing-title", text: "Meu plano" }),
      createElement("span", {
        className: provider.available ? "billing-provider is-ready" : "billing-provider is-offline",
        text: provider.available ? "Stripe seguro" : "Checkout indisponível"
      })
    );
    head.appendChild(titleGroup);
    const atualBadge = createElement("span", {
      className: "billing-current",
      text: `Atual: ${planoAtual.toUpperCase()}`
    });
    head.appendChild(atualBadge);
    panel.appendChild(head);

    const grid = createElement("div", { className: "billing-plans" });
    (plans || []).forEach((p) => {
      const planoPretendido = query.get("plano");
      const card = createElement("div", {
        className: `billing-plan${p.key === planoAtual ? " is-current" : ""}${p.key === planoPretendido ? " is-target" : ""}`
      });
      card.appendChild(createElement("h4", { className: "billing-plan-name", text: p.name }));
      card.appendChild(createElement("div", { className: "billing-plan-price", text: p.price_label }));
      card.appendChild(createElement("p", { className: "myf-note", text: p.description || "" }));

      if (p.key === planoAtual) {
        card.appendChild(createElement("span", { className: "billing-plan-tag", text: "Seu plano" }));
      } else if (p.payable) {
        const checkoutButton = myfActionButton(`Assinar ${p.name}`, async () => {
          const checkout = await smartSend("/api/payments/checkout", { plan_key: p.key });
          if (!checkout.url) throw new Error("O Stripe não retornou o checkout seguro.");
          window.location.assign(checkout.url);
        });
        checkoutButton.disabled = !p.checkout_available || Boolean(subscription?.access_granted);
        if (checkoutButton.disabled) {
          checkoutButton.title = subscription?.access_granted
            ? "Gerencie sua assinatura atual antes de trocar de plano."
            : provider.message;
        }
        card.appendChild(checkoutButton);
      }
      grid.appendChild(card);
    });
    panel.appendChild(grid);

    if (subscription) {
      const rodape = createElement("div", { className: "billing-foot" });
      const statusLabels = {
        active: "ativa",
        trialing: "em período de teste",
        past_due: "com pagamento pendente",
        unpaid: "não paga",
        canceled: "encerrada",
        incomplete: "aguardando confirmação",
        incomplete_expired: "expirada",
        paused: "pausada"
      };
      rodape.appendChild(
        createElement("span", {
          className: "myf-note",
          text: `Assinatura ${subscription.plan_key.toUpperCase()} ${statusLabels[subscription.status] || subscription.status}${subscription.current_period_end ? " · período até " + new Date(subscription.current_period_end).toLocaleDateString("pt-BR") : ""}${subscription.cancel_at_period_end ? " · cancelamento agendado" : ""}.`
        })
      );
      if (subscription.access_granted) {
        rodape.appendChild(
          myfActionButton("Abrir portal de cobrança", async () => {
            const result = await smartSend("/api/payments/portal", {});
            window.location.assign(result.url);
          }, "btn-secondary")
        );
      }
      if (subscription.access_granted && !subscription.cancel_at_period_end) {
        rodape.appendChild(
          myfActionButton("Agendar cancelamento", async () => {
            const dialog = await showAppDialog({
              title: "Agendar cancelamento",
              description: "Seu acesso continuará até o fim do período já pago. O Stripe encerrará a renovação automaticamente.",
              confirmText: "Agendar cancelamento",
              tone: "danger"
            });
            if (!dialog.confirmed) return;
            const result = await smartSend("/api/payments/cancel", {});
            showToast(
              `Cancelamento agendado. O acesso permanece até ${new Date(result.current_period_end).toLocaleDateString("pt-BR")}.`,
              "success"
            );
            await renderBilling();
          }, "btn-secondary")
        );
      }
      rodape.appendChild(
        myfActionButton("Atualizar status", async () => {
          await smartSend("/api/payments/reconcile", {});
          await checkAuthOrRedirect();
          await loadPlanCapabilities();
          await renderBilling();
        }, "btn-secondary")
      );
      panel.appendChild(rodape);
    }

    if (Array.isArray(invoices) && invoices.length > 0) {
      const invoiceStatusLabels = {
        paid: "paga",
        open: "aberta",
        draft: "rascunho",
        void: "cancelada",
        uncollectible: "não recebida"
      };
      const invoiceList = createElement("div", { className: "billing-invoices" });
      invoiceList.appendChild(createElement("h4", { text: "Faturas e recibos do Stripe" }));
      invoices.slice(0, 6).forEach((invoice) => {
        const row = createElement("div", { className: "billing-invoice-row" });
        row.appendChild(
          createElement("span", {
            text: `${new Date(invoice.created_at).toLocaleDateString("pt-BR")} · ${invoiceStatusLabels[invoice.status] || invoice.status} · R$ ${(Number(invoice.amount_paid_cents || 0) / 100).toFixed(2).replace(".", ",")}`
          })
        );
        const url = invoice.hosted_invoice_url || invoice.invoice_pdf_url;
        if (url) {
          row.appendChild(
            createElement("a", {
              className: "billing-invoice-link",
              text: "Abrir no Stripe",
              attributes: { href: url, target: "_blank", rel: "noopener noreferrer" }
            })
          );
        }
        invoiceList.appendChild(row);
      });
      panel.appendChild(invoiceList);
    }
  } catch (error) {
    panel.appendChild(createElement("p", { className: "myf-note", text: error.message }));
  }
}

// ---- Widgets por recurso (todos consomem engines reais) ----
const MYF_WIDGETS = {
  energy_budget(body) {
    const result = myfResultBox();
    const budgetInput = myfInput("Orçamento de hoje", {
      type: "number",
      min: "1",
      max: "100",
      step: "0.5",
      placeholder: "Ex.: 12"
    });
    body.appendChild(budgetInput.wrap);
    body.appendChild(
      myfActionButton("Definir orçamento", async () => {
        const data = await smartSend("/api/smart/energy-budget", {
          budget: Number(budgetInput.input.value)
        });
        showToast(`Orçamento diário definido em ${data.budget} pontos.`, "success");
      }, "btn-secondary")
    );
    body.appendChild(
      myfActionButton("Ver bateria de hoje", async () => {
        const data = await smartGet("/api/smart/energy-budget");
        clearElement(result);
        const pct = data.budget > 0 ? Math.min(100, Math.round((data.consumed / data.budget) * 100)) : 0;
        const bar = createElement("div", { className: "myf-bar" });
        const fill = createElement("div", {
          className: data.overloaded ? "myf-bar-fill over" : data.near_limit ? "myf-bar-fill warn" : "myf-bar-fill"
        });
        applyDynamicStyles(fill, { width: `${pct}%` });
        bar.appendChild(fill);
        result.appendChild(bar);
        result.appendChild(
          createElement("p", {
            className: "myf-metric",
            text: `${data.consumed} de ${data.budget} pontos usados · restam ${data.remaining}`
          })
        );
        result.appendChild(
          createElement("p", {
            className: "myf-note",
            text:
              data.source === "historico_energia"
                ? `Orçamento calibrado por ${data.energy_samples} registros do seu Termômetro de Energia.`
                : data.source === "manual"
                  ? "Orçamento personalizado por você para este dia."
                  : "Orçamento padrão do administrador; registre energia para calibrá-lo."
          })
        );
        result.appendChild(
          createElement("p", {
            className: data.overloaded ? "smart-config-fail" : "myf-note",
            text: data.overloaded
              ? "Dia sobrecarregado — considere adiar algo."
              : data.near_limit
                ? "Perto do limite de energia do dia."
                : "Energia sob controle."
          })
        );
      })
    );
    body.appendChild(result);
  },

  auto_scheduler(body) {
    const atividades = Array.isArray(activitiesData) ? activitiesData : [];
    const info = createElement("p", { className: "myf-note", text: "Selecione atividades e uma duração para o agendador organizar seu dia sem sobreposição." });
    body.appendChild(info);
    const lista = createElement("div", { className: "myf-checklist" });
    const linhas = [];
    atividades.slice(0, 12).forEach((a) => {
      const row = createElement("label", { className: "myf-check-row" });
      const cb = createElement("input", { className: "myf-check", attributes: { type: "checkbox" } });
      const dur = createElement("input", {
        className: "myf-field-input myf-dur",
        attributes: { type: "number", min: "15", max: "480", step: "15", value: "60", "aria-label": "Duração em minutos" }
      });
      row.appendChild(cb);
      row.appendChild(createElement("span", { className: "myf-check-label", text: a.name || a.title || `Atividade ${a.id}` }));
      row.appendChild(dur);
      lista.appendChild(row);
      linhas.push({ id: a.id, cb, dur });
    });
    if (atividades.length === 0) {
      lista.appendChild(createElement("p", { className: "myf-note", text: "Cadastre atividades primeiro para usar o agendador." }));
    }
    body.appendChild(lista);
    const result = myfResultBox();

    let ultimoPlano = null;
    let ultimoRunId = null;
    const renderPlanPreview = (meta = {}) => {
      clearElement(result);
      let draggedIndex = null;
      ultimoPlano.forEach((planItem, index) => {
        const row = createElement("div", {
          className: "myf-plan-row myf-plan-draggable",
          attributes: { draggable: "true", title: "Arraste para trocar a ordem dos blocos" }
        });
        row.appendChild(
          createElement("span", { text: `${planItem.start_time}–${planItem.end_time}` })
        );
        const title = createElement("input", {
          className: "myf-field-input",
          attributes: {
            type: "text",
            maxlength: "200",
            value: planItem.title,
            "aria-label": `Título do bloco ${index + 1}`
          }
        });
        title.addEventListener("input", () => {
          planItem.title = title.value.trim();
        });
        row.appendChild(title);
        row.addEventListener("dragstart", () => {
          draggedIndex = index;
          row.classList.add("is-dragging");
        });
        row.addEventListener("dragend", () => row.classList.remove("is-dragging"));
        row.addEventListener("dragover", (event) => event.preventDefault());
        row.addEventListener("drop", (event) => {
          event.preventDefault();
          if (draggedIndex === null || draggedIndex === index) return;
          const slots = ultimoPlano.map((item) => ({
            event_date: item.event_date,
            start_time: item.start_time,
            end_time: item.end_time
          }));
          const reordered = [...ultimoPlano];
          const [moved] = reordered.splice(draggedIndex, 1);
          reordered.splice(index, 0, moved);
          ultimoPlano = reordered.map((item, slotIndex) => ({ ...item, ...slots[slotIndex] }));
          renderPlanPreview(meta);
        });
        result.appendChild(row);
      });
      if (meta.energy?.would_overload) {
        result.appendChild(
          createElement("p", {
            className: "smart-config-fail",
            text: `Atenção: o plano projetaria ${meta.energy.projected} de ${meta.energy.budget} pontos de energia.`
          })
        );
      }
      if ((meta.unscheduled || []).length > 0) {
        result.appendChild(
          createElement("p", {
            className: "myf-note",
            text: `${meta.unscheduled.length} não couberam.`
          })
        );
      }
      const actions = createElement("div", { className: "smart-config-actions" });
      actions.append(
        myfActionButton("Aplicar na agenda", async () => {
          if (!ultimoPlano || ultimoPlano.length === 0) return;
          const plan = ultimoPlano.map((item) => ({
            title: item.title,
            activity_id: item.activity_id,
            event_date: item.event_date,
            start_time: item.start_time,
            end_time: item.end_time,
            cognitive_load: item.cognitive_load,
            priority: item.priority
          }));
          const applied = await smartSend("/api/smart/auto-plan/apply", {
            run_id: ultimoRunId,
            plan
          });
          showToast(`${applied.applied} bloco(s) criado(s) na agenda.`, "success");
          actions.replaceChildren(
            myfActionButton("Desfazer aplicação", async () => {
              const reverted = await smartSend(
                `/api/smart/auto-plan/${applied.run_id}`,
                {},
                "DELETE"
              );
              showToast(`${reverted.removed} bloco(s) removido(s) da agenda.`, "success");
              clearElement(result);
            }, "btn-secondary")
          );
        }, "btn-secondary"),
        myfActionButton("Descartar prévia", async () => {
          ultimoPlano = null;
          ultimoRunId = null;
          clearElement(result);
        }, "btn-secondary")
      );
      result.appendChild(actions);
    };
    body.appendChild(
      myfActionButton("Gerar prévia", async () => {
        const tasks = linhas
          .filter((l) => l.cb.checked)
          .map((l) => ({ title: (l.cb.parentElement.querySelector(".myf-check-label").textContent) || "Tarefa", duration_min: Number(l.dur.value) || 60, activity_id: l.id }));
        if (tasks.length === 0) {
          showToast("Selecione ao menos uma atividade.", "error");
          return;
        }
        const data = await smartSend("/api/smart/auto-plan", { tasks });
        ultimoPlano = data.plan || [];
        ultimoRunId = data.run_id;
        if (ultimoPlano.length === 0) {
          clearElement(result);
          result.appendChild(createElement("p", { className: "myf-note", text: "Sem janelas livres suficientes hoje." }));
          return;
        }
        renderPlanPreview(data);
      })
    );
    body.appendChild(result);
  },

  passive_tracking(body) {
    const result = myfResultBox();
    let trackingStartedAt = null;
    const trackingButton = myfActionButton(
      "Iniciar medição desta sessão",
      async () => {
        if (trackingStartedAt === null) {
          trackingStartedAt = Date.now();
          trackingButton.textContent = "Parar e registrar sessão";
          showToast("Medição iniciada somente nesta sessão do Kairo.", "success");
          return;
        }
        const focusSeconds = Math.max(0, Math.round((Date.now() - trackingStartedAt) / 1000));
        await smartSend("/api/smart/passive/record", {
          section: activeSection || "recursos",
          layout: window.innerWidth < 640 ? "mobile" : "desktop",
          focus_seconds: focusSeconds,
          focused: document.visibilityState === "visible"
        });
        trackingStartedAt = null;
        trackingButton.textContent = "Iniciar medição desta sessão";
        showToast("Sessão registrada com sua confirmação.", "success");
      },
      "btn-secondary"
    );
    body.appendChild(trackingButton);
    body.appendChild(
      myfActionButton("Ver meu uso de hoje", async () => {
        const data = await smartGet("/api/smart/passive/summary");
        clearElement(result);
        if ((data.sections || []).length === 0) {
          result.appendChild(createElement("p", { className: "myf-note", text: "Sem registros de uso hoje." }));
          return;
        }
        data.sections.forEach((s) => {
          result.appendChild(createElement("div", { className: "myf-plan-row", text: `${s.section}: ${s.focus_minutes} min` }));
        });
        (data.suggestions || []).forEach((sug) => {
          const box = createElement("div", { className: "myf-suggestion" });
          box.appendChild(createElement("span", { text: sug.suggested_title }));
          box.appendChild(
            myfActionButton("Lançar", async () => {
              await smartSend("/api/smart/passive/promote", { title: sug.suggested_title });
              showToast("Atividade criada.", "success");
            }, "btn-secondary")
          );
          result.appendChild(box);
        });
      })
    );
    body.appendChild(result);
  },

  transition_bridge(body) {
    const result = myfResultBox();
    body.appendChild(
      myfActionButton("Minhas preferências", async () => {
        const current = await smartGet("/api/smart/transition/preferences");
        const dialog = await showAppDialog({
          title: "Preferências de transição",
          fields: [
            {
              name: "enabled",
              label: "Oferecer transições",
              type: "select",
              value: current.enabled ? "sim" : "nao",
              options: [
                { value: "sim", label: "Sim" },
                { value: "nao", label: "Não" }
              ]
            },
            {
              name: "ritual_type",
              label: "Ritual preferido",
              type: "select",
              value: current.ritual_type || "",
              options: [
                { value: "", label: "Padrão do administrador" },
                { value: "respiracao", label: "Respiração" },
                { value: "contagem", label: "Contagem" },
                { value: "som", label: "Som curto" }
              ]
            },
            {
              name: "sound_enabled",
              label: "Permitir som",
              type: "select",
              value: current.sound_enabled ? "sim" : "nao",
              options: [
                { value: "sim", label: "Sim" },
                { value: "nao", label: "Não" }
              ]
            }
          ],
          confirmText: "Salvar preferências"
        });
        if (!dialog.confirmed) return;
        await smartSend(
          "/api/smart/transition/preferences",
          {
            enabled: dialog.values.enabled === "sim",
            ritual_type: dialog.values.ritual_type || null,
            sound_enabled: dialog.values.sound_enabled === "sim"
          },
          "PUT"
        );
        showToast("Preferências de transição salvas.", "success");
      }, "btn-secondary")
    );
    body.appendChild(
      myfActionButton("Iniciar ritual de transição", async () => {
        const data = await smartSend("/api/smart/transition/plan", {});
        clearElement(result);
        result.appendChild(createElement("p", { className: "myf-metric", text: `Ritual: ${data.ritual_type} · ${data.total_seconds}s` }));
        (data.steps || []).forEach((p) => {
          result.appendChild(createElement("div", { className: "myf-plan-row", text: `${p.label} — ${p.seconds}s` }));
        });
        result.appendChild(createElement("p", { className: "myf-note", text: data.next_prep }));
        result.appendChild(
          myfActionButton("Concluí a transição", async () => {
            await smartSend("/api/smart/transition/complete", { completed: true, duration_seconds: data.total_seconds });
            showToast("Transição registrada. Bom foco!", "success");
          }, "btn-secondary")
        );
      })
    );
    body.appendChild(result);
  },

  brain_dump(body) {
    const ta = createElement("textarea", {
      className: "myf-textarea",
      attributes: { rows: "4", placeholder: "Despeje tudo o que está na sua cabeça, uma ideia por linha…", "aria-label": "Despejo de ideias" }
    });
    body.appendChild(ta);
    const result = myfResultBox();
    body.appendChild(
      myfActionButton("Organizar em tarefas", async () => {
        const data = await smartSend("/api/smart/brain-dump/parse", { text: ta.value });
        clearElement(result);
        if ((data.items || []).length === 0) {
          result.appendChild(createElement("p", { className: "myf-note", text: "Nada reconhecido. Escreva uma ideia por linha." }));
          return;
        }
        const escolhas = [];
        data.items.forEach((item) => {
          const row = createElement("label", { className: "myf-check-row" });
          const cb = createElement("input", { className: "myf-check", attributes: { type: "checkbox", checked: true } });
          const titleInput = createElement("input", {
            className: "myf-field-input myf-proposal-title",
            attributes: {
              type: "text",
              maxlength: "200",
              value: item.title,
              "aria-label": "Editar tarefa proposta"
            }
          });
          row.appendChild(cb);
          row.appendChild(titleInput);
          row.appendChild(
            createElement("span", {
              className: "myf-note",
              text: `~${item.estimate_min} min`
            })
          );
          result.appendChild(row);
          escolhas.push({ cb, titleInput });
        });
        result.appendChild(
          myfActionButton("Criar selecionadas", async () => {
            const items = escolhas
              .filter((entry) => entry.cb.checked && entry.titleInput.value.trim())
              .map((entry) => ({ title: entry.titleInput.value.trim() }));
            if (items.length === 0) {
              showToast("Selecione ao menos uma.", "error");
              return;
            }
            const r = await smartSend("/api/smart/brain-dump/commit", { items });
            showToast(`${r.created} atividade(s) criada(s).`, "success");
          }, "btn-secondary")
        );
      })
    );
    body.appendChild(result);
  },

  persistent_reminders(body) {
    const titulo = myfInput("Título", { type: "text", maxlength: "200", placeholder: "Ex.: Enviar relatório" });
    const quando = myfInput("Quando", { type: "datetime-local" });
    body.appendChild(titulo.wrap);
    body.appendChild(quando.wrap);
    if ("Notification" in window && Notification.permission !== "granted") {
      body.appendChild(
        myfActionButton("Ativar notificações", async () => {
          const permission = await Notification.requestPermission();
          showToast(
            permission === "granted"
              ? "Notificações ativadas."
              : "Notificações não autorizadas; os avisos continuarão dentro do app.",
            permission === "granted" ? "success" : "warning"
          );
        }, "btn-secondary")
      );
    }
    const result = myfResultBox();
    body.appendChild(
      myfActionButton("Agendar lembrete", async () => {
        if (!titulo.input.value.trim() || !quando.input.value) {
          showToast("Preencha título e horário.", "error");
          return;
        }
        const baseAt = quando.input.value.replace("T", " ");
        await smartSend("/api/smart/reminders/schedule", { title: titulo.input.value.trim(), base_at: baseAt });
        showToast("Lembrete agendado.", "success");
        titulo.input.value = "";
      })
    );
    body.appendChild(
      myfActionButton("Gerenciar lembretes", async () => {
        const data = await smartGet("/api/smart/reminders");
        clearElement(result);
        const itens = data.reminders || [];
        if (itens.length === 0) {
          result.appendChild(createElement("p", { className: "myf-note", text: "Nenhum lembrete cadastrado." }));
          return;
        }
        itens.forEach((rem) => {
          const box = createElement("div", { className: "myf-suggestion" });
          box.appendChild(
            createElement("span", {
              text: `${rem.title} · ${rem.next_at} · ${rem.status} · nível ${rem.level}`
            })
          );
          if (["pendente", "adiado"].includes(rem.status)) {
            box.appendChild(
              myfActionButton("Feito", async () => {
                await smartSend("/api/smart/reminders/act", { id: rem.id, action: "done" });
                showToast("Lembrete concluído.", "success");
                box.remove();
              }, "btn-secondary")
            );
            box.appendChild(
              myfActionButton("Adiar 15min", async () => {
                await smartSend("/api/smart/reminders/act", { id: rem.id, action: "snooze", snooze_minutes: 15 });
                showToast("Lembrete adiado.", "success");
                box.remove();
              }, "btn-secondary")
            );
          }
          box.appendChild(
            myfActionButton("Reagendar", async () => {
              const dialog = await showAppDialog({
                title: "Reagendar lembrete",
                fields: [
                  { name: "title", label: "Título", value: rem.title, required: true },
                  {
                    name: "base_at",
                    label: "Nova data e horário",
                    type: "datetime-local",
                    value: String(rem.next_at || "").replace(" ", "T").slice(0, 16),
                    required: true
                  }
                ],
                confirmText: "Reagendar"
              });
              if (!dialog.confirmed) return;
              await smartSend(
                `/api/smart/reminders/${rem.id}`,
                {
                  title: dialog.values.title,
                  base_at: dialog.values.base_at.replace("T", " ")
                },
                "PUT"
              );
              showToast("Lembrete reagendado.", "success");
              box.remove();
            }, "btn-secondary")
          );
          box.appendChild(
            myfActionButton("Excluir", async () => {
              const dialog = await showAppDialog({
                title: "Excluir lembrete?",
                description: rem.title,
                confirmText: "Excluir",
                tone: "danger"
              });
              if (!dialog.confirmed) return;
              await smartSend(`/api/smart/reminders/${rem.id}`, {}, "DELETE");
              showToast("Lembrete excluído.", "success");
              box.remove();
            }, "btn-secondary")
          );
          result.appendChild(box);
        });
      }, "btn-secondary")
    );
    body.appendChild(result);
  },

  now_mode(body) {
    const result = myfResultBox();
    const openFocus = (event) => {
      const overlay = createElement("div", {
        className: "now-focus-overlay",
        attributes: { role: "dialog", "aria-modal": "true", "aria-label": "Modo Agora" }
      });
      const panel = createElement("div", { className: "now-focus-panel" });
      panel.append(
        createElement("span", { className: "myf-ai-badge", text: "Modo Agora" }),
        createElement("h2", { text: event.title }),
        createElement("p", { text: `${event.start_time}–${event.end_time}` })
      );
      const actions = createElement("div", { className: "smart-config-actions" });
      const close = () => overlay.remove();
      actions.append(
        myfActionButton("Concluir", async () => {
          const response = await smartSend(`/api/smart/now/${event.id}/action`, {
            action: "complete"
          });
          clearElement(panel);
          panel.appendChild(createElement("h2", { text: "Tarefa concluída" }));
          if (response.transition) {
            panel.appendChild(
              createElement("p", {
                text: `Transição guiada · ${response.transition.total_seconds}s`
              })
            );
            (response.transition.steps || []).forEach((step) => {
              panel.appendChild(
                createElement("p", { text: `${step.label} — ${step.seconds}s` })
              );
            });
          }
          panel.appendChild(myfActionButton("Fechar", close, "btn-secondary"));
        }),
        myfActionButton("Adiar 15 min", async () => {
          await smartSend(`/api/smart/now/${event.id}/action`, {
            action: "postpone",
            minutes: 15
          });
          showToast("Tarefa adiada em 15 minutos.", "success");
          close();
        }, "btn-secondary"),
        myfActionButton("Sair do foco", close, "btn-secondary")
      );
      panel.appendChild(actions);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
      overlay.addEventListener("click", (clickEvent) => {
        if (clickEvent.target === overlay) close();
      });
    };
    body.appendChild(
      myfActionButton("O que fazer agora?", async () => {
        const data = await smartGet("/api/smart/now");
        clearElement(result);
        if (data.idle) {
          result.appendChild(createElement("p", { className: "myf-metric", text: "Nenhuma tarefa em curso agora." }));
        } else {
          result.appendChild(createElement("p", { className: "myf-metric", text: `Agora: ${data.now.title} (${data.now.start_time}–${data.now.end_time})` }));
          result.appendChild(myfActionButton("Focar agora", () => openFocus(data.now)));
        }
        if (data.next) {
          result.appendChild(createElement("p", { className: "myf-note", text: `Depois: ${data.next.title} às ${data.next.start_time}` }));
        }
      })
    );
    body.appendChild(result);
  },

  predictive_coach(body) {
    const result = myfResultBox();
    body.appendChild(
      myfActionButton("Analisar meus padrões", async () => {
        const data = await smartGet("/api/smart/coach/analyze");
        clearElement(result);
        result.appendChild(createElement("p", { className: "myf-metric", text: data.message }));
        (data.insights || []).forEach((i) => {
          const box = createElement("div", { className: `myf-insight sev-${i.severity}` });
          box.appendChild(createElement("strong", { text: i.message }));
          box.appendChild(createElement("span", { className: "myf-note", text: i.recommendation }));
          box.appendChild(
            createElement("span", {
              className: "myf-ai-badge",
              text: `Estado: ${i.state || "pendente"}`
            })
          );
          const actions = createElement("div", { className: "smart-config-actions" });
          actions.append(
            myfActionButton("Aceitar", async () => {
              await smartSend(`/api/smart/coach/${i.id}/action`, { action: "accept" });
              showToast("Recomendação aceita e registrada.", "success");
              box.dataset.state = "aceito";
            }, "btn-secondary"),
            myfActionButton("Ajustar", async () => {
              const dialog = await showAppDialog({
                title: "Ajustar recomendação",
                fields: [
                  {
                    name: "adjustment",
                    label: "Como deseja ajustar?",
                    required: true,
                    minlength: 2,
                    maxlength: 500
                  }
                ],
                confirmText: "Salvar ajuste"
              });
              if (!dialog.confirmed) return;
              await smartSend(`/api/smart/coach/${i.id}/action`, {
                action: "adjust",
                adjustment: dialog.values.adjustment
              });
              showToast("Ajuste salvo.", "success");
              box.dataset.state = "ajustado";
            }, "btn-secondary"),
            myfActionButton("Descartar", async () => {
              await smartSend(`/api/smart/coach/${i.id}/action`, { action: "dismiss" });
              showToast("Insight descartado.", "success");
              box.remove();
            }, "btn-secondary")
          );
          box.appendChild(actions);
          result.appendChild(box);
        });
      })
    );
    body.appendChild(result);
  },

  focus_time_machine(body) {
    const result = myfResultBox();
    const sliderWrap = createElement("label", { className: "myf-field" });
    const sliderLabel = createElement("span", {
      className: "myf-field-label",
      text: "Ritmo extra: 0h por dia"
    });
    const slider = createElement("input", {
      className: "myf-range",
      attributes: {
        type: "range",
        min: "0",
        max: "4",
        step: "0.25",
        value: "0",
        "aria-label": "Horas extras de foco por dia"
      }
    });
    slider.addEventListener("input", () => {
      sliderLabel.textContent = `Ritmo extra: ${Number(slider.value).toLocaleString("pt-BR")}h por dia`;
    });
    sliderWrap.append(sliderLabel, slider);
    body.appendChild(sliderWrap);
    body.appendChild(
      myfActionButton("Simular e salvar cenário", async () => {
        const data = await smartSend("/api/smart/time-machine/simulate", {
          extra_hours_per_day: Number(slider.value)
        });
        clearElement(result);
        if ((data.projections || []).length === 0) {
          result.appendChild(createElement("p", { className: "myf-note", text: data.message }));
          return;
        }
        data.projections.forEach((p) => {
          const dias = p.days_to_goal == null ? "no ritmo atual, inatingível" : `${p.days_to_goal} dias`;
          result.appendChild(
            createElement("div", {
              className: p.within_horizon ? "myf-plan-row" : "myf-plan-row risk",
              text: `${p.title}: ${dias} (${p.daily_rate_hours}h/dia)`
            })
          );
          const curve = createElement("div", { className: "myf-bar" });
          const fill = createElement("div", {
            className: p.adjusted.within_horizon ? "myf-bar-fill" : "myf-bar-fill warn"
          });
          const progress =
            p.adjusted.days_to_goal == null
              ? 4
              : Math.max(4, Math.min(100, 100 - (p.adjusted.days_to_goal / data.horizon_days) * 100));
          applyDynamicStyles(fill, { width: `${progress}%` });
          curve.appendChild(fill);
          result.appendChild(curve);
        });
        result.appendChild(
          createElement("p", {
            className: "myf-note",
            text: `Cenário #${data.projection_id} salvo com premissas reais.`
          })
        );
      })
    );
    body.appendChild(result);
  },

  digital_twin(body) {
    const result = myfResultBox();
    const question = myfInput("Pergunte ao seu gêmeo", {
      type: "text",
      maxlength: "500",
      placeholder: "Ex.: Quando eu rendo mais?"
    });
    body.appendChild(question.wrap);
    body.appendChild(
      myfActionButton("Ver meu gêmeo digital", async () => {
        const data = await smartGet("/api/smart/twin/profile");
        clearElement(result);
        if (!data.sufficient) {
          result.appendChild(createElement("p", { className: "myf-note", text: data.message }));
          return;
        }
        result.appendChild(createElement("p", { className: "myf-metric", text: `Capacidade típica: ${data.estimated_daily_capacity_hours}h/dia` }));
        result.appendChild(createElement("p", { className: "myf-note", text: `Taxa de conclusão: ${Math.round(data.completion_rate * 100)}%` }));
        if (data.best_hour) {
          result.appendChild(createElement("p", { className: "myf-note", text: `Melhor horário: ${String(data.best_hour.hour).padStart(2, "0")}h` }));
        }
      })
    );
    body.appendChild(
      myfActionButton("Perguntar aos meus dados", async () => {
        if (question.input.value.trim().length < 2) {
          showToast("Escreva uma pergunta.", "warning");
          return;
        }
        const data = await smartSend("/api/smart/twin/ask", {
          question: question.input.value.trim()
        });
        clearElement(result);
        result.append(
          createElement("p", { className: "myf-metric", text: data.answer }),
          createElement("p", {
            className: "myf-note",
            text: "Resposta determinística baseada exclusivamente nos seus agregados reais."
          })
        );
      }, "btn-secondary")
    );
    body.appendChild(result);
  },

  emotional_map(body) {
    const humor = myfInput("Humor (1–5)", { type: "number", min: "1", max: "5", value: "3" });
    const energia = myfInput("Energia (1–5)", { type: "number", min: "1", max: "5", value: "3" });
    body.appendChild(humor.wrap);
    body.appendChild(energia.wrap);
    const consent = createElement("label", { className: "myf-check-row" });
    const cbConsent = createElement("input", { className: "myf-check", attributes: { type: "checkbox" } });
    consent.appendChild(cbConsent);
    consent.appendChild(createElement("span", { className: "myf-check-label", text: "Concordo em registrar meu bem-estar (dados locais, sem diagnóstico)." }));
    body.appendChild(consent);
    const result = myfResultBox();
    body.appendChild(
      myfActionButton("Registrar hoje", async () => {
        if (!cbConsent.checked) {
          showToast("É preciso consentir para registrar.", "error");
          return;
        }
        await smartSend("/api/smart/emotional/record", {
          mood: Number(humor.input.value),
          energy: Number(energia.input.value),
          consent: true
        });
        showToast("Check-in emocional salvo.", "success");
      })
    );
    body.appendChild(
      myfActionButton("Ver correlação", async () => {
        const data = await smartGet("/api/smart/emotional/map");
        clearElement(result);
        const c = data.correlations || {};
        result.appendChild(createElement("p", { className: "myf-metric", text: `Humor × produtividade: ${c.mood_productivity == null ? "dados insuficientes" : c.mood_productivity}` }));
        result.appendChild(createElement("p", { className: "myf-note", text: data.disclaimer }));
      }, "btn-secondary")
    );
    body.appendChild(result);
  },

  shutdown_ritual(body) {
    const result = myfResultBox();
    body.appendChild(
      myfActionButton("Encerrar o dia", async () => {
        const data = await smartGet("/api/smart/shutdown/summary");
        clearElement(result);
        result.appendChild(createElement("p", { className: "myf-metric", text: data.closing_message }));
        result.appendChild(createElement("p", { className: "myf-note", text: `Concluídos: ${data.completed_count} · Pendentes: ${data.pending_count}` }));
        (data.steps || []).forEach((step, index) => {
          result.appendChild(
            createElement("div", {
              className: "myf-plan-row",
              text: `${index + 1}. ${step}`
            })
          );
        });
        const ta = createElement("textarea", {
          className: "myf-textarea",
          attributes: { rows: "3", placeholder: "Prioridades para amanhã, uma por linha…", "aria-label": "Plano de amanhã" }
        });
        (data.tomorrow_suggestions || []).forEach((s) => {
          ta.value += (ta.value ? "\n" : "") + s.title;
        });
        result.appendChild(ta);
        result.appendChild(
          myfActionButton("Concluir ritual", async () => {
            const tomorrow_items = ta.value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
            const completed = await smartSend("/api/smart/shutdown/complete", { tomorrow_items });
            clearElement(result);
            result.append(
              createElement("p", { className: "myf-metric", text: completed.closing_message }),
              createElement("p", {
                className: "myf-note",
                text: `${completed.rolled_count} pendência(s) levada(s) realmente para ${completed.rollover_date}.`
              })
            );
            showToast("Expediente encerrado e amanhã preparado.", "success");
          }, "btn-secondary")
        );
      })
    );
    body.appendChild(result);
  }
};

async function doLogout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } finally {
    csrfToken = null;
    window.location.assign("/login");
  }
}

// ---- Gestão de Usuários (Administrador) ----
function showUsersTableMessage(tbody, message, color = "var(--pale-blue)") {
  const row = document.createElement("tr");
  const cell = createElement("td", {
    className: "users-table-message",
    text: message,
    attributes: { colspan: 6 }
  });
  cell.dataset.tone = color === "var(--danger-color)" ? "danger" : "neutral";
  row.appendChild(cell);
  tbody.replaceChildren(row);
}

function createUserSelect(userId, className, options, selectedValue, ariaLabel) {
  const select = createElement("select", {
    className: `${className} admin-inline-select`,
    dataset: { uid: userId },
    attributes: { "aria-label": ariaLabel }
  });
  options.forEach(({ value, label }) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    option.selected = value === selectedValue;
    select.appendChild(option);
  });
  return select;
}

async function renderUsersAdmin() {
  const tbody = document.getElementById("users-table-body");
  if (!tbody) return;
  showUsersTableMessage(tbody, "Carregando…");
  try {
    const [usersResponse, plansResponse] = await Promise.all([
      apiFetch("/api/users"),
      apiFetch("/api/plans")
    ]);
    const usersPayload = await responsePayload(usersResponse);
    const plansPayload = await responsePayload(plansResponse);
    if (!usersResponse.ok)
      throw new Error(apiErrorMessage(usersPayload, "Sem permissão para gerenciar usuários."));
    if (!plansResponse.ok)
      throw new Error(apiErrorMessage(plansPayload, "Não foi possível carregar os planos."));

    const users = Array.isArray(usersPayload) ? usersPayload : [];
    const plans = Array.isArray(plansPayload?.plans) ? plansPayload.plans : [];
    const roleOptions = [
      { value: "administrador", label: "Administrador" },
      { value: "usuario", label: "Usuário" }
    ];
    const planOptions = plans.map((plan) => ({ value: plan.key, label: plan.name }));
    tbody.replaceChildren();

    users.forEach((u) => {
      const tr = document.createElement("tr");
      const nameCell = document.createElement("td");
      nameCell.textContent = u.name;
      const emailCell = document.createElement("td");
      emailCell.textContent = u.email;
      const roleCell = document.createElement("td");
      roleCell.appendChild(
        createUserSelect(
          u.id,
          "user-role-select",
          roleOptions,
          u.role,
          `Perfil de acesso de ${u.name}`
        )
      );
      const planCell = document.createElement("td");
      planCell.appendChild(
        createUserSelect(
          u.id,
          "user-plan-select",
          planOptions,
          u.plan,
          `Plano comercial de ${u.name}`
        )
      );
      const statusCell = document.createElement("td");
      const status = createElement("span", {
        className: `user-status user-status-${u.is_active ? "active" : "inactive"}`,
        text: u.is_active ? "Ativo" : "Inativo"
      });
      statusCell.appendChild(status);
      const actionCell = document.createElement("td");
      const deleteButton = createElement("button", {
        className: "quick-btn quick-delete user-delete user-delete-button",
        dataset: { uid: u.id },
        text: "×",
        attributes: {
          type: "button",
          title: `Excluir usuário ${u.name}`,
          "aria-label": `Excluir usuário ${u.name}`
        }
      });
      actionCell.appendChild(deleteButton);
      tr.append(nameCell, emailCell, roleCell, planCell, statusCell, actionCell);
      tbody.appendChild(tr);
    });

    tbody.querySelectorAll(".user-role-select, .user-plan-select").forEach((sel) => {
      sel.addEventListener("change", async () => {
        try {
          const field = sel.classList.contains("user-role-select") ? "role" : "plan";
          const r = await apiFetch(`/api/users/${sel.dataset.uid}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: sel.value })
          });
          const payload = await responsePayload(r);
          if (!r.ok)
            throw new Error(apiErrorMessage(payload, "Não foi possível atualizar o usuário."));
          showToast(field === "role" ? "Perfil atualizado." : "Plano atualizado.", "success");
          renderUsersAdmin();
        } catch (e) {
          showToast(e.message, "error");
          renderUsersAdmin();
        }
      });
    });

    // Excluir usuário
    tbody.querySelectorAll(".user-delete").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const dialog = await showAppDialog({
          title: "Excluir usuário",
          description: "Deseja excluir este usuário e revogar seus acessos?",
          confirmText: "Excluir usuário",
          tone: "danger"
        });
        if (!dialog.confirmed) return;
        try {
          const r = await apiFetch(`/api/users/${btn.dataset.uid}`, { method: "DELETE" });
          const payload = await responsePayload(r);
          if (!r.ok)
            throw new Error(apiErrorMessage(payload, "Não foi possível excluir o usuário."));
          showToast("Usuário excluído.", "success");
          renderUsersAdmin();
        } catch (e) {
          showToast(e.message, "error");
        }
      });
    });
  } catch (e) {
    showUsersTableMessage(tbody, e.message, "var(--danger-color)");
  }
}

function initUsersAdmin() {
  const btnAdd = document.getElementById("btn-add-user");
  if (btnAdd) {
    btnAdd.addEventListener("click", async () => {
      let planOptions;
      try {
        const plansResponse = await apiFetch("/api/plans");
        const plansPayload = await responsePayload(plansResponse);
        if (!plansResponse.ok) {
          throw new Error(
            apiErrorMessage(plansPayload, "Não foi possível carregar os planos disponíveis.")
          );
        }
        planOptions = Array.isArray(plansPayload?.plans)
          ? plansPayload.plans.map((plan) => ({ value: plan.key, label: plan.name }))
          : [];
        if (planOptions.length === 0) {
          throw new Error("Nenhum plano está disponível para vincular ao novo usuário.");
        }
      } catch (error) {
        showToast(error.message || "Não foi possível carregar os planos disponíveis.", "error");
        return;
      }

      const dialog = await showAppDialog({
        title: "Cadastrar usuário",
        description: "Preencha os dados do novo usuário administrativo.",
        confirmText: "Criar usuário",
        fields: [
          { name: "name", label: "Nome", required: true, autocomplete: "name" },
          {
            name: "email",
            label: "E-mail",
            required: true,
            type: "email",
            autocomplete: "email",
            validate: (value) => (/\S+@\S+\.\S+/.test(value) ? "" : "Informe um e-mail válido.")
          },
          {
            name: "password",
            label: "Senha",
            required: true,
            type: "password",
            autocomplete: "new-password",
            minlength: 8,
            maxlength: 128,
            validate: (value) =>
              typeof value === "string" && value.length >= 8 && value.length <= 128
                ? ""
                : "Use de 8 a 128 caracteres."
          },
          {
            name: "role",
            label: "Papel",
            type: "select",
            value: "usuario",
            options: [
              { value: "usuario", label: "Usuário" },
              { value: "administrador", label: "Administrador" }
            ]
          },
          {
            name: "plan",
            label: "Plano",
            type: "select",
            value: planOptions[0].value,
            options: planOptions
          }
        ]
      });
      if (!dialog.confirmed) return;
      const { name, email, password, role, plan } = dialog.values;
      try {
        const r = await apiFetch("/api/users", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, role, plan })
        });
        const payload = await responsePayload(r);
        if (!r.ok) throw new Error(apiErrorMessage(payload, "Não foi possível criar o usuário."));
        showToast("Usuário criado.", "success");
        renderUsersAdmin();
      } catch (e) {
        showToast(e.message, "error");
      }
    });
  }
}

// ============================================================
// INTEGRAÇÃO GOOGLE CALENDAR (Frontend)
// ============================================================

async function refreshGoogleStatus() {
  const dot = document.getElementById("google-status-dot");
  const title = document.getElementById("google-status-title");
  const desc = document.getElementById("google-status-desc");
  const btnConnect = document.getElementById("btn-google-connect");
  const btnSync = document.getElementById("btn-google-sync");
  const btnDisc = document.getElementById("btn-google-disconnect");
  const hint = document.getElementById("google-hint");
  if (!dot || !title) return;

  try {
    const res = await apiFetch("/api/google/status");
    if (res.status === 503) {
      setGoogleStatusState(dot, "warning");
      title.textContent = "Dependência ausente";
      desc.textContent = "Rode: npm install";
      hint.textContent =
        'A biblioteca googleapis ainda não foi instalada. Rode "npm install" e reinicie o servidor.';
      setInlineActionVisibility(btnConnect, false);
      setInlineActionVisibility(btnSync, false);
      setInlineActionVisibility(btnDisc, false);
      return;
    }
    const data = await res.json();
    // Alimenta o pill da página da Agenda com o mesmo status real (Tarefa 36).
    atualizarPillGoogleAgenda(data);

    if (!data.configured) {
      setGoogleStatusState(dot, "warning");
      title.textContent = "Não configurada";
      desc.textContent = "Faltam credenciais no .env";
      hint.textContent =
        "Preencha GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI no arquivo .env (veja o .env.example) e reinicie o servidor.";
      setInlineActionVisibility(btnConnect, false);
      setInlineActionVisibility(btnSync, false);
      setInlineActionVisibility(btnDisc, false);
      return;
    }

    if (data.connected) {
      setGoogleStatusState(dot, "success");
      title.textContent = "Conectada";
      desc.textContent = data.email ? data.email : "Conta Google vinculada";
      hint.textContent =
        'Sincronização bidirecional ativa. Clique em "Sincronizar agora" para atualizar os compromissos nos dois sentidos.';
      setInlineActionVisibility(btnConnect, false);
      setInlineActionVisibility(btnSync, true);
      setInlineActionVisibility(btnDisc, true);
    } else {
      setGoogleStatusState(dot, "neutral");
      title.textContent = "Desconectada";
      desc.textContent = "Pronta para conectar";
      hint.textContent =
        "Conecte sua Google Agenda para sincronizar compromissos nos dois sentidos (criar, editar e excluir).";
      setInlineActionVisibility(btnConnect, true);
      setInlineActionVisibility(btnSync, false);
      setInlineActionVisibility(btnDisc, false);
    }
  } catch (e) {
    setGoogleStatusState(dot, "danger");
    title.textContent = "Indisponível";
    desc.textContent = "Erro ao consultar status";
    atualizarPillGoogleAgenda({ error: true });
  }
}

// ============================================================
// PILL DE CONEXÃO E SYNC DO GOOGLE NA PÁGINA DA AGENDA (Tarefa 36)
// ============================================================

let googleStatusCache = null;

// Converte um instante em texto relativo "há X min" honesto.
function tempoRelativoDesde(iso) {
  if (!iso) return "";
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return "";
  const minutos = Math.floor((Date.now() - ts) / 60000);
  if (minutos < 1) return "agora mesmo";
  if (minutos < 60) return `há ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} h`;
  const dias = Math.floor(horas / 24);
  return `há ${dias} dia(s)`;
}

// Atualiza o pill verde/vermelho/âmbar da Agenda com ícone + texto + cor.
function atualizarPillGoogleAgenda(status) {
  const pill = document.getElementById("agenda-google-pill");
  const dot = document.getElementById("agenda-google-dot");
  const icon = document.getElementById("agenda-google-icon");
  const label = document.getElementById("agenda-google-label");
  const btnSync = document.getElementById("agenda-google-sync");
  const lastSync = document.getElementById("agenda-google-last-sync");
  if (!pill || !dot || !icon || !label) return;

  googleStatusCache = status;

  const definir = (estado, textoIcone, texto, mostrarSync) => {
    pill.dataset.state = estado;
    icon.textContent = textoIcone;
    label.textContent = texto;
    if (btnSync) setInlineActionVisibility(btnSync, Boolean(mostrarSync));
  };

  if (status?.error) {
    definir("danger", "!", "Google Agenda indisponível", false);
    if (lastSync) lastSync.textContent = "";
    return;
  }
  if (status?.configured === false) {
    definir("warning", "!", "Google Agenda não configurada", false);
    if (lastSync) lastSync.textContent = "";
    return;
  }
  if (status?.connected) {
    // VERDE — conectado (ícone ✓ + rótulo, WCAG 1.4.1).
    definir(
      "connected",
      "✓",
      `Conectado${status.email ? ` — ${status.email}` : " ao Google Agenda"}`,
      true
    );
    if (lastSync) {
      const rel = tempoRelativoDesde(status.lastSync);
      lastSync.textContent = rel ? `Última sincronização: ${rel}` : "Ainda não sincronizado";
    }
  } else {
    // VERMELHO — desconectado (ícone ✕ + rótulo).
    definir("disconnected", "✕", "Desconectado — clique para conectar", false);
    if (lastSync) lastSync.textContent = "";
  }
}

// Ação do pill: conecta quando desconectado; quando conectado abre o painel de
// conta em Configurações (onde há desconectar). Estado intermediário âmbar.
async function acaoPillGoogleAgenda() {
  const pill = document.getElementById("agenda-google-pill");
  if (!googleStatusCache || googleStatusCache.configured === false) {
    showToast("Configure as credenciais do Google no .env para conectar.", "warning");
    return;
  }
  if (googleStatusCache.connected) {
    // Já conectado: leva às Configurações para ver a conta e desconectar.
    switchSection("settings");
    return;
  }
  if (pill) pill.dataset.state = "connecting";
  const label = document.getElementById("agenda-google-label");
  if (label) label.textContent = "Conectando…";
  await connectGoogle();
}

// Sincronização manual pelo botão da Agenda, com estados ocioso→sincronizando→
// sucesso/erro e trava contra duplo clique.
let sincronizacaoEmAndamento = false;
async function sincronizarGoogleAgenda() {
  if (sincronizacaoEmAndamento) return;
  const btn = document.getElementById("agenda-google-sync");
  const texto = document.getElementById("agenda-google-sync-text");
  const icon = btn?.querySelector(".google-sync-icon");
  sincronizacaoEmAndamento = true;
  if (btn) {
    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
  }
  if (icon) icon.classList.add("is-spinning");
  if (texto) texto.textContent = "Sincronizando…";

  try {
    const res = await apiFetch("/api/google/sync", { method: "POST" });
    const data = await responsePayload(res);
    if (!res.ok) throw new Error(apiErrorMessage(data, "Falha na sincronização."));
    const s = data || {};
    showToast(
      `Sincronizado! Enviados: ${s.pushed || 0} · Importados: ${s.pulled || 0} · Atualizados: ${s.updated || 0}`,
      "success"
    );
    if (texto) texto.textContent = "Sincronizado!";
    await fetchAndRenderAgenda();
    await refreshGoogleStatus();
    setTimeout(() => {
      if (texto) texto.textContent = "Sincronizar agora";
    }, 2000);
  } catch (error) {
    showToast(error.message || "Erro ao sincronizar. Tente novamente.", "error");
    if (texto) texto.textContent = "Tentar novamente";
  } finally {
    sincronizacaoEmAndamento = false;
    if (btn) {
      btn.disabled = false;
      btn.removeAttribute("aria-busy");
    }
    if (icon) icon.classList.remove("is-spinning");
  }
}

async function connectGoogle() {
  try {
    const res = await apiFetch("/api/google/auth", { method: "POST" });
    const data = await responsePayload(res);
    if (res.ok && data.url) {
      window.location.href = data.url; // redireciona para o consentimento do Google
    } else {
      showToast(apiErrorMessage(data, "Não foi possível iniciar a conexão."), "error");
    }
  } catch (e) {
    showToast(e.message || "Erro ao iniciar a conexão com o Google.", "error");
  }
}

async function syncGoogle() {
  const icon = document.getElementById("google-sync-icon");
  const btn = document.getElementById("btn-google-sync");
  if (btn) btn.disabled = true;
  if (icon) icon.classList.add("is-spinning");
  showToast("Sincronizando com o Google Agenda…", "success");
  try {
    const res = await apiFetch("/api/google/sync", { method: "POST" });
    const data = await responsePayload(res);
    if (!res.ok) throw new Error(apiErrorMessage(data, "Falha na sincronização."));
    const s = data || {};
    showToast(
      `Sincronizado! Enviados: ${s.pushed || 0} · Importados: ${s.pulled || 0} · Atualizados: ${s.updated || 0}`,
      "success"
    );
    await refreshData();
    if (activeSection === "agenda") await fetchAndRenderAgenda();
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.classList.remove("is-spinning");
  }
}

async function disconnectGoogle() {
  try {
    const res = await apiFetch("/api/google/disconnect", { method: "POST" });
    const data = await responsePayload(res);
    if (!res.ok) throw new Error(apiErrorMessage(data, "Falha ao desconectar."));
    showToast("Conta Google desconectada.", "success");
    await refreshGoogleStatus();
  } catch (e) {
    showToast(e.message, "error");
  }
}

function initGoogleIntegration() {
  // O backend continua sendo a barreira definitiva, mas o cliente também não
  // consulta nem inicializa uma integração ausente da matriz do plano. Assim,
  // ocultar o componente não produz requisições 403 ou ruído de console.
  if (!canUseFeature("google_calendar")) {
    googleStatusCache = null;
    return;
  }

  const btnConnect = document.getElementById("btn-google-connect");
  const btnSync = document.getElementById("btn-google-sync");
  const btnDisc = document.getElementById("btn-google-disconnect");
  if (btnConnect) btnConnect.addEventListener("click", connectGoogle);
  if (btnSync) btnSync.addEventListener("click", syncGoogle);
  if (btnDisc) btnDisc.addEventListener("click", disconnectGoogle);

  // Pill e sincronização manual na página da Agenda (Tarefa 36).
  const pill = document.getElementById("agenda-google-pill");
  const pillSync = document.getElementById("agenda-google-sync");
  if (pill) pill.addEventListener("click", acaoPillGoogleAgenda);
  if (pillSync) pillSync.addEventListener("click", sincronizarGoogleAgenda);

  // Trata o retorno do fluxo OAuth (?google=conectado|erro)
  const params = new URLSearchParams(window.location.search);
  const g = params.get("google");
  if (g === "conectado") {
    showToast("Google Agenda conectada com sucesso!", "success");
    window.history.replaceState({}, document.title, window.location.pathname);
  } else if (g === "erro") {
    showToast("Não foi possível conectar a Google Agenda.", "error");
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  refreshGoogleStatus();
}

// ============================================================
// TERMÔMETRO DE ENERGIA E CRONOTIPO (Tarefa 23)
// ============================================================

const ENERGIA = {
  carregado: false,
  habilitado: true,
  nivelEnviando: false
};

const ENERGIA_ROTULOS_CONTEXTO = Object.freeze({
  "ao-acordar": "Ao acordar",
  manha: "Manhã",
  "pos-almoco": "Pós-almoço",
  tarde: "Tarde",
  noite: "Noite",
  "apos-tarefa": "Após uma tarefa",
  "apos-pausa": "Após uma pausa"
});

const ENERGIA_ROTULOS_NIVEL = Object.freeze({
  1: "Muito baixa",
  2: "Baixa",
  3: "Média",
  4: "Alta",
  5: "Muito alta"
});

// Paleta do mapa de calor: do azul frio (baixa) ao âmbar quente (alta).
const ENERGIA_CORES = Object.freeze([
  "#1f2a44", // sem amostra
  "#2b4a6f",
  "#2f7d8c",
  "#3fae72",
  "#e0a63c",
  "#e5533c"
]);

function energiaCorPorNivel(nivelMedio) {
  if (nivelMedio === null || nivelMedio === undefined) return ENERGIA_CORES[0];
  const indice = Math.max(1, Math.min(5, Math.round(nivelMedio)));
  return ENERGIA_CORES[indice];
}

function formatarHoraCurta(hora) {
  return `${String(hora).padStart(2, "0")}h`;
}

async function carregarTermometroEnergia() {
  const card = document.getElementById("energy-card");
  if (!card) return;
  try {
    const resposta = await apiFetch("/api/energy");
    if (!resposta.ok) {
      if (resposta.status === 404) card.classList.add("hidden");
      return;
    }
    const estado = await resposta.json();
    ENERGIA.carregado = true;
    ENERGIA.habilitado = Boolean(estado.enabled);
    renderTermometroEnergia(estado);
  } catch {
    // Silencioso: o termômetro é auxiliar e não pode quebrar o dashboard.
  }
}

function renderTermometroEnergia(estado) {
  const toggle = document.getElementById("energy-toggle");
  const body = document.getElementById("energy-body");
  const disabled = document.getElementById("energy-disabled-state");
  if (!toggle || !body || !disabled) return;

  toggle.setAttribute("aria-checked", estado.enabled ? "true" : "false");
  toggle.classList.toggle("energy-toggle-on", Boolean(estado.enabled));
  body.classList.toggle("hidden", !estado.enabled);
  disabled.classList.toggle("hidden", Boolean(estado.enabled));

  if (!estado.enabled) return;

  renderEscalaEnergia(estado.levels || [1, 2, 3, 4, 5]);
  renderContextosEnergia(estado.contexts || []);
  renderHeatmapEnergia(estado.heatmap || []);
  renderInsightsEnergia(estado.insights || { ready: false });
}

function renderEscalaEnergia(niveis) {
  const escala = document.getElementById("energy-scale");
  if (!escala) return;
  clearElement(escala);
  niveis.forEach((nivel) => {
    const botao = createElement("button", {
      className: "energy-level-btn",
      attributes: {
        type: "button",
        "data-level": String(nivel),
        "aria-label": `Energia ${nivel} de 5 — ${ENERGIA_ROTULOS_NIVEL[nivel] || ""}`.trim(),
        title: ENERGIA_ROTULOS_NIVEL[nivel] || `Nível ${nivel}`
      }
    });
    botao.dataset.energyLevel = String(nivel);
    botao.append(
      createElement("span", { className: "energy-level-value", text: String(nivel) }),
      createElement("span", {
        className: "energy-level-tag",
        text: ENERGIA_ROTULOS_NIVEL[nivel] || ""
      })
    );
    botao.addEventListener("click", () => registrarEnergia(nivel));
    escala.appendChild(botao);
  });
}

function renderContextosEnergia(contextos) {
  const select = document.getElementById("energy-context");
  if (!select) return;
  const anterior = select.value;
  clearElement(select);
  contextos.forEach((ctx) => {
    const opt = createElement("option", {
      text: ENERGIA_ROTULOS_CONTEXTO[ctx] || ctx,
      attributes: { value: ctx }
    });
    select.appendChild(opt);
  });
  if (anterior && contextos.includes(anterior)) select.value = anterior;
}

function renderHeatmapEnergia(heatmap) {
  const container = document.getElementById("energy-heatmap");
  if (!container) return;
  clearElement(container);
  heatmap.forEach((hora) => {
    const celula = createElement("span", {
      className: "energy-heat-cell",
      attributes: {
        role: "img",
        title:
          hora.samples > 0
            ? `${formatarHoraCurta(hora.hour)}: energia média ${hora.avg_level.toFixed(1)} (${hora.samples} registro${hora.samples > 1 ? "s" : ""})`
            : `${formatarHoraCurta(hora.hour)}: sem registros`,
        "aria-label":
          hora.samples > 0
            ? `${formatarHoraCurta(hora.hour)}, energia média ${hora.avg_level.toFixed(1)}`
            : `${formatarHoraCurta(hora.hour)}, sem registros`
      }
    });
    applyDynamicStyles(celula, { background: energiaCorPorNivel(hora.avg_level) });
    if (hora.samples === 0) celula.classList.add("energy-heat-empty");
    container.appendChild(celula);
  });
}

function renderInsightsEnergia(insights) {
  const container = document.getElementById("energy-insights");
  const hint = document.getElementById("energy-samples-hint");
  if (!container) return;
  clearElement(container);

  if (hint) {
    hint.textContent = insights.ready
      ? `${insights.samples} registros`
      : `${insights.samples || 0}/${insights.required || 8}`;
  }

  if (!insights.ready) {
    container.appendChild(
      createElement("p", {
        className: "energy-insight-empty",
        text: insights.message || "Registre sua energia para revelar seu cronotipo."
      })
    );
    return;
  }

  // Sugestão principal (melhor janela cognitiva).
  if (insights.suggestion) {
    const bloco = createElement("div", { className: "energy-suggestion" });
    bloco.append(
      createElement("span", {
        className: "energy-suggestion-badge",
        text: `Pico às ${formatarHoraCurta(insights.suggestion.hour)}`
      }),
      createElement("p", { className: "energy-suggestion-text", text: insights.suggestion.reason })
    );
    // Barra de confiança.
    const confWrap = createElement("div", { className: "energy-confidence" });
    const confLabel = createElement("span", {
      className: "energy-confidence-label",
      text: `Confiança: ${Math.round((insights.confidence || 0) * 100)}%`
    });
    const confTrack = createElement("div", {
      className: "energy-confidence-track",
      attributes: {
        role: "progressbar",
        "aria-valuemin": "0",
        "aria-valuemax": "100",
        "aria-valuenow": String(Math.round((insights.confidence || 0) * 100))
      }
    });
    const confFill = createElement("div", { className: "energy-confidence-fill" });
    applyDynamicStyles(confFill, { width: `${Math.round((insights.confidence || 0) * 100)}%` });
    confTrack.appendChild(confFill);
    confWrap.append(confLabel, confTrack);
    bloco.appendChild(confWrap);
    container.appendChild(bloco);
  }

  // Picos e vales.
  if (insights.peaks?.length) {
    const grade = createElement("div", { className: "energy-peaks" });
    const picos = createElement("div", { className: "energy-peak-col" });
    picos.appendChild(
      createElement("span", { className: "energy-peak-title energy-peak-up", text: "Mais energia" })
    );
    insights.peaks.forEach((p) => {
      picos.appendChild(
        createElement("span", {
          className: "energy-peak-item",
          text: `${formatarHoraCurta(p.hour)} · ${p.avg_level.toFixed(1)}`
        })
      );
    });
    const vales = createElement("div", { className: "energy-peak-col" });
    vales.appendChild(
      createElement("span", {
        className: "energy-peak-title energy-peak-down",
        text: "Menos energia"
      })
    );
    (insights.troughs || []).forEach((t) => {
      vales.appendChild(
        createElement("span", {
          className: "energy-peak-item",
          text: `${formatarHoraCurta(t.hour)} · ${t.avg_level.toFixed(1)}`
        })
      );
    });
    grade.append(picos, vales);
    container.appendChild(grade);
  }

  if (insights.disclaimer) {
    container.appendChild(
      createElement("p", { className: "energy-disclaimer", text: insights.disclaimer })
    );
  }
}

async function registrarEnergia(nivel) {
  if (ENERGIA.nivelEnviando) return;
  ENERGIA.nivelEnviando = true;
  const escala = document.getElementById("energy-scale");
  const alvo = escala?.querySelector(`[data-energy-level="${nivel}"]`);
  if (alvo) alvo.classList.add("energy-level-loading");
  try {
    const select = document.getElementById("energy-context");
    const corpo = { level: nivel };
    if (select?.value) corpo.context = select.value;
    const resposta = await apiFetch("/api/energy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo)
    });
    const payload = await responsePayload(resposta.clone());
    if (!resposta.ok) {
      showToast(apiErrorMessage(payload, "Não foi possível registrar sua energia."), "error");
      return;
    }
    if (alvo) {
      alvo.classList.add("energy-level-confirmed");
      setTimeout(() => alvo.classList.remove("energy-level-confirmed"), 900);
    }
    showToast(`Energia ${nivel} registrada. Obrigado!`, "success");
    await carregarTermometroEnergia();
  } catch {
    showToast("Falha de rede ao registrar energia.", "error");
  } finally {
    if (alvo) alvo.classList.remove("energy-level-loading");
    ENERGIA.nivelEnviando = false;
  }
}

async function alternarTermometroEnergia() {
  const proximo = !ENERGIA.habilitado;
  try {
    const resposta = await apiFetch("/api/energy/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: proximo })
    });
    if (!resposta.ok) {
      const payload = await responsePayload(resposta.clone());
      showToast(apiErrorMessage(payload, "Não foi possível atualizar o termômetro."), "error");
      return;
    }
    ENERGIA.habilitado = proximo;
    showToast(
      proximo ? "Termômetro de energia ativado." : "Termômetro de energia desativado.",
      "success"
    );
    await carregarTermometroEnergia();
  } catch {
    showToast("Falha de rede ao atualizar o termômetro.", "error");
  }
}

async function apagarRegistrosEnergia() {
  const resultado = await showAppDialog({
    title: "Apagar registros de energia",
    description:
      "Isto remove permanentemente todos os seus registros de energia e o cronotipo derivado deles. Deseja continuar?",
    confirmText: "Apagar tudo",
    cancelText: "Cancelar",
    tone: "danger"
  });
  if (!resultado.confirmed) return;
  try {
    const resposta = await apiFetch("/api/energy", { method: "DELETE" });
    const payload = await responsePayload(resposta.clone());
    if (!resposta.ok) {
      showToast(apiErrorMessage(payload, "Não foi possível apagar os registros."), "error");
      return;
    }
    showToast(`${payload.deleted || 0} registro(s) apagado(s).`, "success");
    await carregarTermometroEnergia();
  } catch {
    showToast("Falha de rede ao apagar registros.", "error");
  }
}

function initTermometroEnergia() {
  const toggle = document.getElementById("energy-toggle");
  if (toggle) toggle.addEventListener("click", alternarTermometroEnergia);
  const purge = document.getElementById("energy-purge-btn");
  if (purge) purge.addEventListener("click", apagarRegistrosEnergia);
}

// ============================================================
// CONFIGURAÇÕES DE IA E ESTÚDIO DE TREINAMENTO (Tarefa 27)
// ============================================================

const IA_BASE = "/api/admin/ai";
let iaAbaAtual = "connections";
let iaEditandoConexaoId = null;
let iaEditandoArtefatoId = null;

const IA_ROTULO_PROVIDER = Object.freeze({
  lmstudio: "LM Studio",
  ollama: "Ollama",
  "openai-compatible": "OpenAI-compatível",
  anthropic: "Anthropic"
});

const IA_ROTULO_CAP = Object.freeze({
  chat: "chat",
  streaming: "stream",
  json: "json",
  embeddings: "embeddings",
  vision: "visão",
  tool_calling: "ferramentas"
});

async function iaJson(resource, options) {
  const resp = await apiFetch(`${IA_BASE}${resource}`, options);
  const payload = await responsePayload(resp.clone()).catch(() => null);
  if (!resp.ok) {
    throw new Error(apiErrorMessage(payload, "Falha na operação de IA."));
  }
  return payload;
}

function carregarPaginaIA() {
  initAbasIA();
  if (iaAbaAtual === "connections") carregarConexoesIA();
  else if (iaAbaAtual === "training") carregarArtefatosIA();
  else if (iaAbaAtual === "llmops") carregarLlmOpsIA();
  else if (iaAbaAtual === "tools") carregarGovernancaFerramentasIA();
  else if (iaAbaAtual === "audit") carregarAuditoriaIA();
  else if (iaAbaAtual === "memory") carregarMemoriaAdminIA();
}

let iaAbasIniciadas = false;
function initAbasIA() {
  if (iaAbasIniciadas) return;
  iaAbasIniciadas = true;
  document.querySelectorAll(".ai-tab").forEach((tab) => {
    tab.addEventListener("click", () => trocarAbaIA(tab.dataset.aiTab));
  });
  const btnConn = document.getElementById("ai-btn-new-connection");
  if (btnConn) btnConn.addEventListener("click", () => abrirModalConexaoIA());
  const btnArt = document.getElementById("ai-btn-new-artifact");
  if (btnArt) btnArt.addEventListener("click", () => abrirModalArtefatoIA());
  const filtro = document.getElementById("ai-training-filter");
  if (filtro) filtro.addEventListener("change", () => carregarArtefatosIA());
  document.getElementById("ai-llmops-artifact")?.addEventListener("change", carregarLlmOpsArtefatoIA);
  document.getElementById("ai-llmops-refresh")?.addEventListener("click", carregarLlmOpsIA);
  document
    .getElementById("ai-btn-new-tool-policy")
    ?.addEventListener("click", () => abrirPoliticaFerramentaIA());
  document.getElementById("ai-btn-new-mcp")?.addEventListener("click", () => abrirServidorMcpIA());

  // Modais
  document
    .getElementById("modal-ai-connection-close")
    .addEventListener("click", () => closeModal("modal-ai-connection-overlay"));
  document
    .getElementById("modal-ai-connection-cancel")
    .addEventListener("click", () => closeModal("modal-ai-connection-overlay"));
  document.getElementById("modal-ai-connection-save").addEventListener("click", salvarConexaoIA);
  document
    .getElementById("modal-ai-artifact-close")
    .addEventListener("click", () => closeModal("modal-ai-artifact-overlay"));
  document
    .getElementById("modal-ai-artifact-cancel")
    .addEventListener("click", () => closeModal("modal-ai-artifact-overlay"));
  document.getElementById("modal-ai-artifact-save").addEventListener("click", salvarArtefatoIA);

  // Sugestão automática de URL local ao trocar o provedor.
  const provSelect = document.getElementById("ai-conn-provider");
  if (provSelect) {
    provSelect.addEventListener("change", () => {
      const url = document.getElementById("ai-conn-url");
      if (!url.value || /^https?:\/\/(127\.0\.0\.1|192\.168|localhost)/.test(url.value)) {
        const sugestoes = {
          lmstudio: "http://192.168.0.8:1234",
          ollama: "http://127.0.0.1:11434",
          "openai-compatible": "https://api.openai.com/v1",
          anthropic: "https://api.anthropic.com"
        };
        url.value = sugestoes[provSelect.value] || "";
      }
    });
  }
}

function trocarAbaIA(aba) {
  iaAbaAtual = aba;
  document.querySelectorAll(".ai-tab").forEach((t) => {
    const ativo = t.dataset.aiTab === aba;
    t.classList.toggle("active", ativo);
    t.setAttribute("aria-selected", ativo ? "true" : "false");
  });
  ["connections", "training", "llmops", "tools", "memory", "audit"].forEach((nome) => {
    const painel = document.getElementById(`ai-panel-${nome}`);
    if (painel) painel.classList.toggle("hidden", nome !== aba);
  });
  carregarPaginaIA();
}

// ---------------------------------------------------------- Conexões e modelos
async function carregarConexoesIA() {
  const grid = document.getElementById("ai-connections-grid");
  const vazio = document.getElementById("ai-connections-empty");
  if (!grid) return;
  clearElement(grid);
  try {
    const { connections } = await iaJson("/connections");
    vazio.classList.toggle("hidden", connections.length > 0);
    for (const conexao of connections) {
      const { models } = await iaJson(`/models?connection_id=${conexao.id}`);
      grid.appendChild(renderCardConexaoIA(conexao, models));
    }
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderCardConexaoIA(conexao, modelos) {
  const card = createElement("div", { className: "ai-connection-card" });

  const head = createElement("div", { className: "ai-conn-head" });
  const nomeGrupo = createElement("div");
  nomeGrupo.append(
    createElement("h3", { className: "ai-conn-name", text: conexao.name }),
    createElement("span", {
      className: "ai-conn-provider",
      text: IA_ROTULO_PROVIDER[conexao.provider_type] || conexao.provider_type
    })
  );
  const pill = createElement("span", {
    className: "ai-health-pill",
    attributes: { "data-state": conexao.health_status || "desconhecido" }
  });
  pill.append(
    createElement("span", { className: "ai-health-dot" }),
    document.createTextNode(iaTextoSaude(conexao.health_status))
  );
  head.append(nomeGrupo, pill);

  const url = createElement("div", { className: "ai-conn-url", text: conexao.base_url });

  const meta = createElement("div", { className: "ai-conn-meta" });
  meta.append(
    createElement("span", { className: "ai-chip", text: conexao.is_local ? "Local" : "Remoto" }),
    createElement("span", {
      className: "ai-chip",
      attributes: { "data-tone": conexao.is_active ? "active" : "inactive" },
      text: conexao.is_active ? "Ativa" : "Inativa"
    }),
    conexao.has_api_key ? createElement("span", { className: "ai-chip", text: "Com chave" }) : null
  );

  card.append(head, url, meta);

  // Bloco de modelos (aparecem automaticamente após descoberta).
  const blocoModelos = createElement("div", { className: "ai-models-block" });
  blocoModelos.appendChild(
    createElement("div", { className: "ai-models-title", text: `Modelos (${modelos.length})` })
  );
  if (modelos.length === 0) {
    blocoModelos.appendChild(
      createElement("div", {
        className: "ai-conn-url",
        text: 'Clique em "Descobrir modelos" para listar automaticamente.'
      })
    );
  } else {
    for (const modelo of modelos) blocoModelos.appendChild(renderLinhaModeloIA(conexao, modelo));
  }
  card.appendChild(blocoModelos);

  // Ações da conexão.
  const acoes = createElement("div", { className: "ai-conn-actions" });
  acoes.append(
    iaBotao("Testar", () => testarConexaoIA(conexao.id)),
    iaBotao("Descobrir modelos", () => descobrirModelosIA(conexao.id), "primary"),
    iaBotao(conexao.is_active ? "Desativar" : "Ativar", () => alternarConexaoIA(conexao)),
    iaBotao("Editar", () => abrirModalConexaoIA(conexao)),
    iaBotao("Excluir", () => excluirConexaoIA(conexao.id), "danger")
  );
  card.appendChild(acoes);
  return card;
}

function renderLinhaModeloIA(conexao, modelo) {
  const row = createElement("div", { className: "ai-model-row" });
  const info = createElement("div", { className: "ai-model-info" });
  const idLinha = createElement("span", { className: "ai-model-id", text: modelo.model_id });
  info.appendChild(idLinha);
  const caps = createElement("div", { className: "ai-model-caps" });
  Object.entries(IA_ROTULO_CAP).forEach(([chave, rotulo]) => {
    const valor = modelo.capabilities?.[chave];
    if (valor === true)
      caps.appendChild(
        createElement("span", {
          className: "ai-cap",
          attributes: { "data-on": "true" },
          text: rotulo
        })
      );
  });
  if (modelo.max_context)
    caps.appendChild(
      createElement("span", { className: "ai-cap", text: `ctx ${modelo.max_context}` })
    );
  info.appendChild(caps);
  row.appendChild(info);

  const acoes = createElement("div", { className: "ai-model-actions" });
  if (modelo.is_default)
    acoes.appendChild(createElement("span", { className: "ai-default-badge", text: "Padrão" }));
  else acoes.appendChild(iaBotao("Definir padrão", () => definirModeloPadraoIA(modelo.id)));
  acoes.appendChild(iaBotao("Checar capacidades", () => checarCapacidadesIA(modelo.id)));
  row.appendChild(acoes);
  return row;
}

function iaBotao(texto, onClick, variant) {
  const btn = createElement("button", {
    className: "ai-btn-sm",
    text: texto,
    attributes: { type: "button" }
  });
  if (variant) btn.dataset.variant = variant;
  btn.addEventListener("click", onClick);
  return btn;
}

function iaTextoSaude(estado) {
  if (estado === "ok") return "Saudável";
  if (estado === "offline") return "Offline";
  return "Não testada";
}

function abrirModalConexaoIA(conexao = null) {
  iaEditandoConexaoId = conexao?.id ?? null;
  document.getElementById("modal-ai-connection-title").textContent = conexao
    ? "Editar conexão de IA"
    : "Nova conexão de IA";
  document.getElementById("ai-conn-name").value = conexao?.name ?? "";
  document.getElementById("ai-conn-provider").value = conexao?.provider_type ?? "lmstudio";
  document.getElementById("ai-conn-url").value = conexao?.base_url ?? "http://192.168.0.8:1234";
  document.getElementById("ai-conn-key").value = "";
  document.getElementById("ai-conn-allow-remote").checked = Boolean(conexao?.allow_remote_host);
  openModal("modal-ai-connection-overlay");
}

async function salvarConexaoIA() {
  const corpo = {
    name: document.getElementById("ai-conn-name").value.trim(),
    provider_type: document.getElementById("ai-conn-provider").value,
    base_url: document.getElementById("ai-conn-url").value.trim(),
    allow_remote_host: document.getElementById("ai-conn-allow-remote").checked
  };
  const chave = document.getElementById("ai-conn-key").value;
  if (chave) corpo.api_key = chave;
  if (!corpo.name || !corpo.base_url) {
    showToast("Informe nome e URL base.", "warning");
    return;
  }
  try {
    let conexaoId = iaEditandoConexaoId;
    if (conexaoId) {
      await iaJson(`/connections/${conexaoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
    } else {
      const criada = await iaJson("/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
      conexaoId = criada.id;
    }
    closeModal("modal-ai-connection-overlay");
    showToast("Conexão salva. Descobrindo modelos...", "success");
    // Requisito: ao adicionar a conexão, os modelos aparecem automaticamente.
    try {
      await iaJson(`/connections/${conexaoId}/discover-models`, { method: "POST" });
    } catch (e) {
      showToast(`Conexão salva, mas a descoberta falhou: ${e.message}`, "warning");
    }
    await carregarConexoesIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function testarConexaoIA(id) {
  try {
    const r = await iaJson(`/connections/${id}/test`, { method: "POST" });
    showToast(
      r.ok ? `Conexão saudável (${r.models_found} modelos).` : `Offline: ${r.error}`,
      r.ok ? "success" : "error"
    );
    await carregarConexoesIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function descobrirModelosIA(id) {
  try {
    const r = await iaJson(`/connections/${id}/discover-models`, { method: "POST" });
    showToast(`${r.models.length} modelo(s) descoberto(s).`, "success");
    await carregarConexoesIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function alternarConexaoIA(conexao) {
  try {
    await iaJson(`/connections/${conexao.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !conexao.is_active })
    });
    showToast(conexao.is_active ? "Conexão desativada." : "Conexão ativada.", "success");
    await carregarConexoesIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function excluirConexaoIA(id) {
  const r = await showAppDialog({
    title: "Excluir conexão",
    description: "Isto remove a conexão e seus modelos descobertos. Continuar?",
    confirmText: "Excluir",
    cancelText: "Cancelar",
    tone: "danger"
  });
  if (!r.confirmed) return;
  try {
    const resp = await apiFetch(`${IA_BASE}/connections/${id}`, { method: "DELETE" });
    if (!resp.ok && resp.status !== 204) throw new Error("Falha ao excluir.");
    showToast("Conexão excluída.", "success");
    await carregarConexoesIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function definirModeloPadraoIA(modeloId) {
  try {
    await iaJson(`/models/${modeloId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_default: true })
    });
    showToast("Modelo definido como padrão.", "success");
    await carregarConexoesIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function checarCapacidadesIA(modeloId) {
  showToast("Checando capacidades reais do modelo...", "success");
  try {
    const m = await iaJson(`/models/${modeloId}/capability-check`, { method: "POST" });
    const ativas = Object.entries(m.capabilities)
      .filter(([, v]) => v === true)
      .map(([k]) => IA_ROTULO_CAP[k])
      .join(", ");
    showToast(`Capacidades confirmadas: ${ativas || "nenhuma"}.`, "success");
    await carregarConexoesIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ---------------------------------------------------------- Estúdio de Treinamento
async function carregarArtefatosIA() {
  const lista = document.getElementById("ai-artifacts-list");
  if (!lista) return;
  clearElement(lista);
  const filtro = document.getElementById("ai-training-filter")?.value || "";
  try {
    const query = filtro ? `?state=${encodeURIComponent(filtro)}` : "";
    const { artifacts } = await iaJson(`/training/artifacts${query}`);
    if (artifacts.length === 0) {
      lista.appendChild(
        createElement("div", {
          className: "ai-empty",
          children: [createElement("p", { text: "Nenhuma competência neste filtro." })]
        })
      );
      return;
    }
    for (const art of artifacts) lista.appendChild(renderCardArtefatoIA(art));
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderCardArtefatoIA(art) {
  const card = createElement("div", { className: "ai-artifact-card" });
  const main = createElement("div", { className: "ai-artifact-main" });
  main.appendChild(createElement("h3", { className: "ai-artifact-name", text: art.name }));
  if (art.description)
    main.appendChild(
      createElement("span", { className: "ai-artifact-desc", text: art.description })
    );
  const tags = createElement("div", { className: "ai-artifact-tags" });
  tags.append(
    createElement("span", {
      className: "ai-state-pill",
      attributes: { "data-state": art.state },
      text: art.state.replace("_", " ")
    }),
    createElement("span", { className: "ai-chip", text: art.type.replace(/_/g, " ") }),
    createElement("span", { className: "ai-chip", text: `v${art.current_version}` }),
    art.is_seed ? createElement("span", { className: "ai-chip", text: "inicial" }) : null
  );
  main.appendChild(tags);
  card.appendChild(main);

  const acoes = createElement("div", { className: "ai-artifact-actions" });
  acoes.append(
    iaBotao("Editar", () => abrirModalArtefatoIA(art)),
    iaBotao("Avaliar", () => avaliarArtefatoIA(art)),
    iaBotao("Aprovar", () => aprovarArtefatoIA(art)),
    iaBotao("Publicar", () => publicarArtefatoIA(art.id), "primary"),
    iaBotao("Reverter", () => reverterArtefatoIA(art.id)),
    art.state === "arquivado"
      ? iaBotao("Restaurar", () => restaurarArtefatoIA(art.id))
      : iaBotao("Arquivar", () => arquivarArtefatoIA(art.id))
  );
  if (!art.is_seed)
    acoes.appendChild(iaBotao("Excluir", () => excluirArtefatoIA(art.id), "danger"));
  card.appendChild(acoes);
  return card;
}

async function avaliarArtefatoIA(art) {
  try {
    const result = await iaJson(`/training/artifacts/${art.id}/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: art.current_version })
    });
    const tone = result.release_approved ? "success" : "warning";
    showToast(
      `Avaliação v${result.version}: score ${result.scores.aggregate}. ${
        result.release_approved ? "Release liberado para aprovação." : "Release bloqueado pelos critérios vigentes."
      }`,
      tone
    );
    await carregarArtefatosIA();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function aprovarArtefatoIA(art) {
  const dialog = await showAppDialog({
    title: `Aprovar ${art.name} v${art.current_version}`,
    description: "A aprovação fica vinculada ao snapshot avaliado e será revogada se a versão mudar.",
    fields: [
      {
        name: "rationale",
        label: "Justificativa da aprovação",
        value: "Avaliação revisada e aprovada para publicação administrativa.",
        minlength: 10,
        maxlength: 1000,
        required: true
      }
    ],
    confirmText: "Aprovar versão"
  });
  if (!dialog.confirmed) return;
  try {
    await iaJson(`/training/artifacts/${art.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: art.current_version,
        rationale: dialog.values.rationale
      })
    });
    showToast("Aprovação humana registrada.", "success");
    await carregarArtefatosIA();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function abrirModalArtefatoIA(art = null) {
  iaEditandoArtefatoId = art?.id ?? null;
  document.getElementById("modal-ai-artifact-title").textContent = art
    ? "Editar competência"
    : "Nova competência";
  document.getElementById("ai-art-name").value = art?.name ?? "";
  document.getElementById("ai-art-type").value = art?.type ?? "skill";
  document.getElementById("ai-art-description").value = art?.description ?? "";
  document.getElementById("ai-art-priority").value = art?.priority ?? 100;
  document.getElementById("ai-art-content").value = art?.content ?? "";
  openModal("modal-ai-artifact-overlay");
}

async function salvarArtefatoIA() {
  const corpo = {
    name: document.getElementById("ai-art-name").value.trim(),
    type: document.getElementById("ai-art-type").value,
    description: document.getElementById("ai-art-description").value.trim(),
    priority: parseInt(document.getElementById("ai-art-priority").value, 10) || 100,
    content: document.getElementById("ai-art-content").value
  };
  if (!corpo.name || corpo.content.trim().length < 10) {
    showToast("Informe nome e conteúdo (mínimo 10 caracteres).", "warning");
    return;
  }
  try {
    if (iaEditandoArtefatoId) {
      await iaJson(`/training/artifacts/${iaEditandoArtefatoId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
    } else {
      await iaJson("/training/artifacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo)
      });
    }
    closeModal("modal-ai-artifact-overlay");
    showToast("Competência salva.", "success");
    await carregarArtefatosIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function publicarArtefatoIA(id) {
  try {
    await iaJson(`/training/artifacts/${id}/publish`, { method: "POST" });
    showToast("Competência publicada e ativa no contexto.", "success");
    await carregarArtefatosIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function reverterArtefatoIA(id) {
  try {
    await iaJson(`/training/artifacts/${id}/rollback`, { method: "POST" });
    showToast("Versão revertida.", "success");
    await carregarArtefatosIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function arquivarArtefatoIA(id) {
  try {
    await iaJson(`/training/artifacts/${id}/archive`, { method: "POST" });
    showToast("Competência arquivada.", "success");
    await carregarArtefatosIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function restaurarArtefatoIA(id) {
  try {
    await iaJson(`/training/artifacts/${id}/restore`, { method: "POST" });
    showToast("Competência restaurada.", "success");
    await carregarArtefatosIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function excluirArtefatoIA(id) {
  const r = await showAppDialog({
    title: "Excluir competência",
    description: "Esta ação é permanente. Continuar?",
    confirmText: "Excluir",
    cancelText: "Cancelar",
    tone: "danger"
  });
  if (!r.confirmed) return;
  try {
    const resp = await apiFetch(`${IA_BASE}/training/artifacts/${id}`, { method: "DELETE" });
    if (!resp.ok && resp.status !== 204) throw new Error("Falha ao excluir.");
    showToast("Competência excluída.", "success");
    await carregarArtefatosIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ---------------------------------------------------------- LLMOps (Tarefa 30)
async function carregarLlmOpsIA() {
  const select = document.getElementById("ai-llmops-artifact");
  if (!select) return;
  const selected = select.value;
  clearElement(select);
  try {
    const [{ artifacts }, scorecards] = await Promise.all([
      iaJson("/training/artifacts"),
      iaJson("/training/scorecards")
    ]);
    if (!artifacts.length) {
      select.appendChild(createElement("option", { text: "Nenhum artefato", attributes: { value: "" } }));
      renderEstadoLlmOps("Crie uma competência no Estúdio de Treinamento para iniciar o pipeline.");
    } else {
      for (const artifact of artifacts) {
        const option = createElement("option", {
          text: `${artifact.name} · v${artifact.current_version}`,
          attributes: { value: artifact.id }
        });
        if (String(artifact.id) === selected) option.selected = true;
        select.appendChild(option);
      }
      await carregarLlmOpsArtefatoIA();
    }
    renderScorecardsLlmOps(scorecards);
  } catch (error) {
    renderEstadoLlmOps(error.message, "danger");
  }
}

function renderEstadoLlmOps(message, tone = "neutral") {
  const summary = document.getElementById("ai-llmops-summary");
  if (!summary) return;
  clearElement(summary);
  summary.appendChild(createStateMessage(message, { tone, compact: true }));
}

async function carregarLlmOpsArtefatoIA() {
  const artifactId = Number(document.getElementById("ai-llmops-artifact")?.value);
  if (!artifactId) return;
  try {
    const [artifact, versionsPayload, evaluationsPayload, canariesPayload] = await Promise.all([
      iaJson(`/training/artifacts/${artifactId}`),
      iaJson(`/training/artifacts/${artifactId}/versions`),
      iaJson(`/training/artifacts/${artifactId}/evaluations`),
      iaJson(`/training/artifacts/${artifactId}/canaries`)
    ]);
    renderResumoLlmOps(artifact, versionsPayload.versions, evaluationsPayload.evaluations);
    renderVersoesLlmOps(artifact, versionsPayload.versions, evaluationsPayload.evaluations);
    renderCanariesLlmOps(canariesPayload.canaries);
  } catch (error) {
    renderEstadoLlmOps(error.message, "danger");
  }
}

function renderResumoLlmOps(artifact, versions, evaluations) {
  const summary = document.getElementById("ai-llmops-summary");
  if (!summary) return;
  clearElement(summary);
  const latest = evaluations.find((evaluation) => evaluation.version === artifact.current_version);
  const meta = createElement("div", { className: "ai-governance-meta" });
  meta.append(
    createElement("span", { className: "ai-chip", text: `Atual v${artifact.current_version}` }),
    createElement("span", {
      className: "ai-chip",
      text: artifact.published_version ? `Publicada v${artifact.published_version}` : "Sem publicação"
    }),
    createElement("span", {
      className: "ai-chip",
      text: latest ? `Score ${Number(latest.aggregate_score).toFixed(1)}` : "Sem avaliação atual"
    })
  );
  const actions = createElement("div", { className: "ai-artifact-actions" });
  actions.append(
    iaBotao("Avaliar versão", () => avaliarArtefatoIA(artifact), "primary"),
    iaBotao("Aprovar", () => aprovarArtefatoIA(artifact)),
    iaBotao("Publicar", () => publicarLlmOpsIA(artifact)),
    iaBotao("Iniciar canary", () => iniciarCanaryIA(artifact)),
    iaBotao("Política de regressão", configurarRegressaoLlmOpsIA)
  );
  if (versions.length >= 2) {
    actions.appendChild(
      iaBotao("Comparar versões", () => compararVersoesIA(artifact, versions))
    );
  }
  summary.append(meta, actions);
}

async function configurarRegressaoLlmOpsIA() {
  try {
    const settings = await iaJson("/training/evaluation-settings");
    const dialog = await showAppDialog({
      title: "Política de regressão",
      description: "Uma queda superior ao limite bloqueia a publicação mesmo após aprovação humana.",
      fields: [
        {
          name: "threshold",
          label: "Queda máxima permitida (pontos)",
          type: "number",
          value: String(settings.regression_threshold),
          min: 0,
          max: 50,
          step: "0.1",
          required: true
        }
      ],
      confirmText: "Salvar política"
    });
    if (!dialog.confirmed) return;
    await iaJson("/training/evaluation-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ regression_threshold: Number(dialog.values.threshold) })
    });
    showToast("Política de regressão atualizada e versionada na auditoria.", "success");
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function publicarLlmOpsIA(artifact) {
  await publicarArtefatoIA(artifact.id);
  await carregarLlmOpsIA();
}

function renderVersoesLlmOps(artifact, versions, evaluations) {
  const list = document.getElementById("ai-llmops-versions");
  if (!list) return;
  clearElement(list);
  for (const version of versions) {
    const evaluation = evaluations.find((item) => item.version === version.version);
    const row = createElement("article", { className: "ai-governance-item" });
    const title = createElement("div", { className: "ai-governance-title" });
    title.append(
      createElement("strong", { text: `Versão ${version.version}` }),
      createElement("span", {
        className: "ai-state-pill",
        attributes: { "data-state": version.state },
        text: version.state.replace("_", " ")
      })
    );
    const details = [
      evaluation ? `Score ${Number(evaluation.aggregate_score).toFixed(1)}` : "Sem avaliação",
      version.evaluated_at ? "avaliada" : "não avaliada",
      version.published_at || artifact.published_version === version.version ? "publicada" : "não publicada",
      `hash ${String(version.content_hash).slice(0, 10)}`
    ].join(" · ");
    row.append(title, createElement("span", { className: "ai-governance-detail", text: details }));
    list.appendChild(row);
  }
}

async function compararVersoesIA(artifact, versions) {
  const options = versions.map((version) => ({
    value: String(version.version),
    label: `Versão ${version.version}`
  }));
  const dialog = await showAppDialog({
    title: `Comparar versões de ${artifact.name}`,
    fields: [
      { name: "left", label: "Versão-base", type: "select", value: options[1]?.value, options },
      { name: "right", label: "Versão candidata", type: "select", value: options[0]?.value, options }
    ],
    confirmText: "Comparar"
  });
  if (!dialog.confirmed || dialog.values.left === dialog.values.right) {
    if (dialog.confirmed) showToast("Selecione duas versões diferentes.", "warning");
    return;
  }
  try {
    const comparison = await iaJson(
      `/training/artifacts/${artifact.id}/compare?left=${encodeURIComponent(dialog.values.left)}&right=${encodeURIComponent(dialog.values.right)}`
    );
    const fields = comparison.changed_fields.map((change) => change.field).join(", ");
    await showAppDialog({
      title: `Comparação v${comparison.left.version} → v${comparison.right.version}`,
      description: fields ? `Campos alterados: ${fields}.` : "Os snapshots são equivalentes.",
      confirmText: "Fechar",
      cancelText: "Voltar"
    });
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function iniciarCanaryIA(artifact) {
  if (!artifact.published_version || artifact.published_version === artifact.current_version) {
    showToast("O canary exige uma versão-base publicada e uma candidata diferente.", "warning");
    return;
  }
  const dialog = await showAppDialog({
    title: `Canary de ${artifact.name} v${artifact.current_version}`,
    description: `Baseline publicada: v${artifact.published_version}. O roteamento usa coorte determinística por usuário.`,
    fields: [
      { name: "traffic", label: "Tráfego candidato (%)", type: "number", value: "10", min: 1, max: 100, required: true },
      { name: "samples", label: "Amostra mínima", type: "number", value: "20", min: 1, max: 100000, required: true },
      { name: "errors", label: "Taxa máxima de erro (%)", type: "number", value: "5", min: 0, max: 100, step: "0.1", required: true }
    ],
    confirmText: "Iniciar canary"
  });
  if (!dialog.confirmed) return;
  try {
    await iaJson(`/training/artifacts/${artifact.id}/canary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: artifact.current_version,
        traffic_percent: Number(dialog.values.traffic),
        min_samples: Number(dialog.values.samples),
        max_error_rate: Number(dialog.values.errors)
      })
    });
    showToast("Canary iniciado com coorte controlada.", "success");
    await carregarLlmOpsArtefatoIA();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderCanariesLlmOps(canaries) {
  const list = document.getElementById("ai-llmops-canaries");
  if (!list) return;
  clearElement(list);
  if (!canaries.length) {
    list.appendChild(createStateMessage("Nenhum canary registrado.", { compact: true }));
    return;
  }
  for (const canary of canaries) {
    const row = createElement("article", { className: "ai-governance-item" });
    row.append(
      createElement("strong", { text: `v${canary.baseline_version} → v${canary.candidate_version}` }),
      createElement("span", {
        className: "ai-governance-detail",
        text: `${canary.traffic_percent}% · ${canary.samples}/${canary.min_samples} amostras · ${canary.error_rate}% erros · ${canary.status}`
      })
    );
    if (canary.status === "executando") {
      const actions = createElement("div", { className: "ai-artifact-actions" });
      actions.append(
        iaBotao("Promover", () => finalizarCanaryIA(canary, "promote"), "primary"),
        iaBotao("Abortar", () => finalizarCanaryIA(canary, "abort"), "danger")
      );
      row.appendChild(actions);
    }
    list.appendChild(row);
  }
}

async function finalizarCanaryIA(canary, action) {
  const promoting = action === "promote";
  const dialog = await showAppDialog({
    title: promoting ? "Promover canary" : "Abortar canary",
    description: promoting
      ? "A promoção só ocorre se a amostra e a taxa de erro cumprirem a política."
      : "O candidato deixa de receber tráfego imediatamente.",
    fields: [
      {
        name: "reason",
        label: "Justificativa",
        value: promoting
          ? "Métricas do canary revisadas e aprovadas para promoção."
          : "Canary abortado após revisão administrativa das métricas.",
        minlength: 10,
        maxlength: 1000,
        required: true
      }
    ],
    confirmText: promoting ? "Promover" : "Abortar",
    tone: promoting ? "default" : "danger"
  });
  if (!dialog.confirmed) return;
  try {
    await iaJson(`/training/canaries/${canary.id}/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, reason: dialog.values.reason })
    });
    showToast(promoting ? "Canary promovido." : "Canary abortado.", "success");
    await carregarLlmOpsIA();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderScorecardsLlmOps(scorecards) {
  const tbody = document.getElementById("ai-llmops-score-body");
  if (!tbody) return;
  clearElement(tbody);
  const rows = [
    ...(scorecards.runtime || []).map((row) => ({
      source: row.provider,
      model: row.model,
      version: row.version || "—",
      runs: row.executions,
      score: `${row.success_rate}% sucesso`,
      latency: row.avg_duration_ms ? `${Math.round(row.avg_duration_ms)} ms` : "—"
    })),
    ...(scorecards.evaluations || []).map((row) => ({
      source: row.evaluator,
      model: row.model,
      version: row.version,
      runs: row.runs,
      score: `${row.score}/100`,
      latency: "determinístico"
    }))
  ];
  if (!rows.length) {
    tbody.appendChild(createLoadingTableRow("Sem execuções ou avaliações.", "neutral", 6));
    return;
  }
  for (const row of rows) {
    const tr = document.createElement("tr");
    [row.source, row.model, row.version, row.runs, row.score, row.latency].forEach((value) =>
      tr.appendChild(createElement("td", { text: String(value) }))
    );
    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------- Ferramentas e MCP
async function carregarGovernancaFerramentasIA() {
  try {
    const [{ policies }, { servers }, { events }] = await Promise.all([
      iaJson("/tool-policies"),
      iaJson("/mcp/servers"),
      iaJson("/tool-audit?limit=100")
    ]);
    renderPoliticasFerramentaIA(policies);
    renderServidoresMcpIA(servers);
    renderAuditoriaFerramentasIA(events);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderPoliticasFerramentaIA(policies) {
  const list = document.getElementById("ai-tool-policies-list");
  if (!list) return;
  clearElement(list);
  if (!policies.length) {
    list.appendChild(createStateMessage("Nenhuma política específica; ferramentas internas seguem o risco nativo.", { compact: true }));
    return;
  }
  for (const policy of policies) {
    const item = createElement("article", { className: "ai-governance-item" });
    item.append(
      createElement("div", {
        className: "ai-governance-title",
        children: [
          createElement("strong", { text: policy.tool_name }),
          createElement("span", { className: "ai-chip", text: policy.risk_class }),
          createElement("span", { className: "ai-chip", text: policy.approval_status })
        ]
      }),
      createElement("span", {
        className: "ai-governance-detail",
        text: `${policy.max_calls} chamadas/${policy.window_seconds}s · leitura: ${policy.read_scopes.join(", ") || "qualquer"} · escrita: ${policy.write_scopes.join(", ") || "qualquer"}`
      })
    );
    const actions = createElement("div", { className: "ai-artifact-actions" });
    actions.append(
      iaBotao("Editar", () => abrirPoliticaFerramentaIA(policy)),
      policy.approval_status === "aprovada"
        ? iaBotao("Revogar", () => decidirPoliticaFerramentaIA(policy, "revoke"), "danger")
        : iaBotao("Aprovar", () => decidirPoliticaFerramentaIA(policy, "approve"), "primary")
    );
    item.appendChild(actions);
    list.appendChild(item);
  }
}

async function abrirPoliticaFerramentaIA(policy = null) {
  const dialog = await showAppDialog({
    title: policy ? `Editar ${policy.tool_name}` : "Nova política de ferramenta",
    description: "Salvar uma política sempre reabre a revisão e suspende sua aprovação até nova decisão administrativa.",
    fields: [
      { name: "tool", label: "Identificador", value: policy?.tool_name || "", pattern: "[A-Za-z0-9_.-]+", minlength: 2, maxlength: 120, required: true },
      { name: "description", label: "Descrição", value: policy?.description || "", maxlength: 500 },
      {
        name: "risk",
        label: "Classe de risco",
        type: "select",
        value: policy?.risk_class || "mutavel",
        options: [
          { value: "somente_leitura", label: "Somente leitura" },
          { value: "mutavel", label: "Mutável" },
          { value: "destrutiva", label: "Destrutiva" },
          { value: "externa", label: "Externa" }
        ]
      },
      { name: "read", label: "Escopos de leitura (separados por vírgula)", value: policy?.read_scopes?.join(", ") || "" },
      { name: "write", label: "Escopos de escrita (separados por vírgula)", value: policy?.write_scopes?.join(", ") || "" },
      { name: "max", label: "Máximo de chamadas", type: "number", value: String(policy?.max_calls || 60), min: 1, max: 10000, required: true },
      { name: "window", label: "Janela (segundos)", type: "number", value: String(policy?.window_seconds || 60), min: 1, max: 86400, required: true },
      {
        name: "allowed",
        label: "Disponibilidade",
        type: "select",
        value: policy?.allowed === false ? "false" : "true",
        options: [
          { value: "true", label: "Permitida após aprovação" },
          { value: "false", label: "Bloqueada" }
        ]
      }
    ],
    confirmText: "Salvar para revisão"
  });
  if (!dialog.confirmed) return;
  const scopes = (value) => value.split(",").map((item) => item.trim()).filter(Boolean);
  try {
    await iaJson("/tool-policies", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tool_name: dialog.values.tool,
        description: dialog.values.description,
        risk_class: dialog.values.risk,
        read_scopes: scopes(dialog.values.read),
        write_scopes: scopes(dialog.values.write),
        max_calls: Number(dialog.values.max),
        window_seconds: Number(dialog.values.window),
        allowed: dialog.values.allowed === "true"
      })
    });
    showToast("Política salva e enviada para aprovação.", "success");
    await carregarGovernancaFerramentasIA();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function decidirPoliticaFerramentaIA(policy, action) {
  const dialog = await showAppDialog({
    title: action === "approve" ? "Aprovar política" : "Revogar política",
    fields: [
      { name: "rationale", label: "Justificativa", value: action === "approve" ? "Risco, escopos e limites revisados pelo administrador." : "Permissão revogada por decisão administrativa explícita.", minlength: 10, maxlength: 1000, required: true }
    ],
    confirmText: action === "approve" ? "Aprovar" : "Revogar",
    tone: action === "approve" ? "default" : "danger"
  });
  if (!dialog.confirmed) return;
  try {
    await iaJson(`/tool-policies/${encodeURIComponent(policy.tool_name)}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, rationale: dialog.values.rationale })
    });
    showToast(action === "approve" ? "Política aprovada." : "Política revogada.", "success");
    await carregarGovernancaFerramentasIA();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderServidoresMcpIA(servers) {
  const list = document.getElementById("ai-mcp-list");
  if (!list) return;
  clearElement(list);
  if (!servers.length) {
    list.appendChild(createStateMessage("Nenhum servidor MCP cadastrado.", { compact: true }));
    return;
  }
  for (const server of servers) {
    const item = createElement("article", { className: "ai-governance-item" });
    item.append(
      createElement("div", {
        className: "ai-governance-title",
        children: [
          createElement("strong", { text: server.name }),
          createElement("span", { className: "ai-chip", text: server.approval_status }),
          createElement("span", { className: "ai-chip", text: server.enabled ? "habilitado" : "desativado" })
        ]
      }),
      createElement("span", { className: "ai-governance-detail", text: `${server.server_url} · ${server.transport} · ${server.auth_type}` }),
      createElement("span", {
        className: "ai-governance-detail",
        text: `Allowlist: ${server.allowlisted ? "sim" : "não"} · ferramentas revisadas: ${server.tools_reviewed ? "sim" : "não"} · credencial: ${server.credential_reference}`
      })
    );
    const actions = createElement("div", { className: "ai-artifact-actions" });
    actions.append(
      iaBotao("Editar", () => abrirServidorMcpIA(server)),
      server.approval_status === "aprovada"
        ? iaBotao("Revogar", () => decidirServidorMcpIA(server, "revoke"), "danger")
        : iaBotao("Aprovar", () => decidirServidorMcpIA(server, "approve"), "primary"),
      iaBotao("Excluir", () => excluirServidorMcpIA(server), "danger")
    );
    item.appendChild(actions);
    list.appendChild(item);
  }
}

async function abrirServidorMcpIA(server = null) {
  const boolOptions = [
    { value: "false", label: "Não" },
    { value: "true", label: "Sim" }
  ];
  const dialog = await showAppDialog({
    title: server ? `Editar ${server.name}` : "Novo servidor MCP",
    description: "O cadastro nasce desativado e em quarentena. Tokens literais não são aceitos; use somente referência de cofre externo.",
    fields: [
      { name: "name", label: "Nome", value: server?.name || "", minlength: 2, maxlength: 120, required: true },
      { name: "url", label: "URL MCP", value: server?.server_url || "http://127.0.0.1:3100/mcp", maxlength: 2048, required: true },
      { name: "transport", label: "Transporte", type: "select", value: server?.transport || "streamable_http", options: [{ value: "streamable_http", label: "Streamable HTTP" }, { value: "sse", label: "SSE legado" }] },
      { name: "auth", label: "Autorização", type: "select", value: server?.auth_type || "none", options: [{ value: "none", label: "Sem autenticação (local)" }, { value: "oauth2", label: "OAuth 2" }] },
      { name: "issuer", label: "Emissor OAuth (opcional)", value: server?.oauth_issuer || "", maxlength: 2048 },
      { name: "client", label: "Client ID OAuth (opcional)", value: server?.oauth_client_id || "", maxlength: 500 },
      { name: "scopes", label: "Escopos solicitados", value: server?.requested_scopes?.join(", ") || "", maxlength: 1000 },
      { name: "credential", label: "Referência de cofre (opcional)", value: server?.credential_reference === "configurada" ? "" : server?.credential_reference || "", placeholder: "vault://kairo/mcp/servidor", maxlength: 500 },
      { name: "allowlist", label: "Host revisado na allowlist", type: "select", value: String(Boolean(server?.allowlisted)), options: boolOptions },
      { name: "reviewed", label: "Ferramentas revisadas", type: "select", value: String(Boolean(server?.tools_reviewed)), options: boolOptions }
    ],
    confirmText: "Salvar em quarentena"
  });
  if (!dialog.confirmed) return;
  const body = {
    name: dialog.values.name,
    server_url: dialog.values.url,
    transport: dialog.values.transport,
    auth_type: dialog.values.auth,
    oauth_issuer: dialog.values.issuer || null,
    oauth_client_id: dialog.values.client || null,
    requested_scopes: dialog.values.scopes.split(",").map((item) => item.trim()).filter(Boolean),
    allowlisted: dialog.values.allowlist === "true",
    tools_reviewed: dialog.values.reviewed === "true"
  };
  if (dialog.values.credential) body.credential_reference = dialog.values.credential;
  try {
    await iaJson(server ? `/mcp/servers/${server.id}` : "/mcp/servers", {
      method: server ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    showToast("Servidor salvo desativado e em revisão.", "success");
    await carregarGovernancaFerramentasIA();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function decidirServidorMcpIA(server, action) {
  const dialog = await showAppDialog({
    title: action === "approve" ? "Aprovar servidor MCP" : "Revogar servidor MCP",
    description: "A aprovação mantém o servidor desativado; nenhuma ferramenta externa é habilitada automaticamente.",
    fields: [
      { name: "rationale", label: "Justificativa", value: action === "approve" ? "Host, transporte, autorização e ferramentas revisados pelo administrador." : "Servidor revogado por decisão administrativa explícita.", minlength: 10, maxlength: 1000, required: true }
    ],
    confirmText: action === "approve" ? "Aprovar desativado" : "Revogar",
    tone: action === "approve" ? "default" : "danger"
  });
  if (!dialog.confirmed) return;
  try {
    await iaJson(`/mcp/servers/${server.id}/decision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, rationale: dialog.values.rationale })
    });
    showToast(action === "approve" ? "Servidor aprovado e mantido desativado." : "Servidor revogado.", "success");
    await carregarGovernancaFerramentasIA();
  } catch (error) {
    showToast(error.message, "error");
  }
}

async function excluirServidorMcpIA(server) {
  const dialog = await showAppDialog({
    title: "Excluir servidor MCP",
    description: `Remover definitivamente “${server.name}”?`,
    confirmText: "Excluir",
    tone: "danger"
  });
  if (!dialog.confirmed) return;
  try {
    const response = await apiFetch(`${IA_BASE}/mcp/servers/${server.id}`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) throw new Error("Falha ao excluir servidor MCP.");
    showToast("Servidor MCP excluído.", "success");
    await carregarGovernancaFerramentasIA();
  } catch (error) {
    showToast(error.message, "error");
  }
}

function renderAuditoriaFerramentasIA(events) {
  const tbody = document.getElementById("ai-tool-audit-body");
  if (!tbody) return;
  clearElement(tbody);
  if (!events.length) {
    tbody.appendChild(createLoadingTableRow("Nenhuma decisão de execução registrada.", "neutral", 6));
    return;
  }
  for (const event of events) {
    const tr = document.createElement("tr");
    [
      new Date(`${event.created_at}Z`).toLocaleString("pt-BR"),
      event.tool_name,
      event.user_id ?? "—",
      event.operation,
      event.scope || "—",
      event.result
    ].forEach((value) => tr.appendChild(createElement("td", { text: String(value) })));
    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------- Auditoria
async function carregarAuditoriaIA() {
  const tbody = document.getElementById("ai-audit-body");
  if (!tbody) return;
  clearElement(tbody);
  try {
    const { events } = await iaJson("/audit?limit=100");
    for (const ev of events) {
      const tr = document.createElement("tr");
      [
        new Date(ev.created_at + "Z").toLocaleString("pt-BR"),
        ev.action,
        ev.artifact_id ?? "—",
        ev.version ?? "—",
        ev.decision ?? "—",
        ev.result
      ].forEach((valor) => tr.appendChild(createElement("td", { text: String(valor) })));
      tbody.appendChild(tr);
    }
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ---------------------------------------------------------- Memória (admin/dashboard)
const IA_ROTULO_TIPO_MEM = Object.freeze({
  preferencia: "Preferências",
  fato: "Fatos",
  resumo_contexto: "Resumos",
  padrao_operacional: "Padrões",
  episodica: "Episódicas",
  semantica: "Semânticas"
});
const IA_CORES_DONUT = ["#6366f1", "#22c55e", "#e0a63c", "#e5533c", "#2f7d8c", "#a855f7"];
let iaMemGranularidadeIniciada = false;

async function carregarMemoriaAdminIA() {
  await Promise.all([
    carregarKpisMemoria(),
    carregarTimeseriesMemoria(),
    carregarTopMemoria(),
    carregarRouterIA(),
    carregarPosturaIA(),
    carregarUsuariosMemoria(),
    carregarLivroLegal()
  ]);
  if (!iaMemGranularidadeIniciada) {
    iaMemGranularidadeIniciada = true;
    document
      .getElementById("ai-memory-granularity")
      ?.addEventListener("change", carregarTimeseriesMemoria);
    document.getElementById("ai-legal-search")?.addEventListener("input", debounceLegal);
  }
}

function formatarBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

async function carregarKpisMemoria() {
  const grid = document.getElementById("ai-memory-kpis");
  if (!grid) return;
  clearElement(grid);
  try {
    const s = await iaJson("/memory/dashboard/summary");
    const kpis = [
      ["Usuários com memória", s.active_users],
      ["Itens ativos", s.total_items],
      ["Armazenamento lógico", formatarBytes(s.logical_bytes)],
      ["Embeddings", s.embeddings],
      ["Expirando (7d)", s.expiring_7d],
      ["Eliminados (30d)", s.deleted_30d],
      ["Recuperações (30d)", s.retrievals_30d],
      ["Sem expiração", s.items_without_expiry],
      ["Tokens de contexto (est.)", s.estimated_context_tokens]
    ];
    for (const [rotulo, valor] of kpis) {
      const card = createElement("div", { className: "ai-kpi" });
      card.append(
        createElement("span", { className: "ai-kpi-value", text: String(valor) }),
        createElement("span", { className: "ai-kpi-label", text: rotulo })
      );
      grid.appendChild(card);
    }
    renderDonutMemoria(s.by_type || []);
  } catch (e) {
    showToast(e.message, "error");
  }
}

function renderDonutMemoria(porTipo) {
  const donut = document.getElementById("ai-memory-donut");
  const legenda = document.getElementById("ai-memory-donut-legend");
  if (!donut || !legenda) return;
  clearElement(legenda);
  const total = porTipo.reduce((s, t) => s + Number(t.total), 0);
  if (total === 0) {
    applyDynamicStyles(donut, { background: "conic-gradient(rgba(255,255,255,0.08) 0 100%)" });
    legenda.appendChild(createElement("span", { className: "ai-donut-empty", text: "Sem dados." }));
    return;
  }
  let acumulado = 0;
  const partes = [];
  porTipo.forEach((t, i) => {
    const cor = IA_CORES_DONUT[i % IA_CORES_DONUT.length];
    const inicio = (acumulado / total) * 100;
    acumulado += Number(t.total);
    const fim = (acumulado / total) * 100;
    partes.push(`${cor} ${inicio}% ${fim}%`);
    const item = createElement("span", { className: "ai-donut-item" });
    const cor2 = createElement("span", { className: "ai-donut-dot" });
    applyDynamicStyles(cor2, { background: cor });
    item.append(
      cor2,
      document.createTextNode(`${IA_ROTULO_TIPO_MEM[t.type] || t.type}: ${t.total}`)
    );
    legenda.appendChild(item);
  });
  applyDynamicStyles(donut, { background: `conic-gradient(${partes.join(", ")})` });
}

async function carregarTimeseriesMemoria() {
  const wrap = document.getElementById("ai-memory-timeseries");
  if (!wrap) return;
  clearElement(wrap);
  const gran = document.getElementById("ai-memory-granularity")?.value || "day";
  try {
    const s = await iaJson(`/memory/dashboard/timeseries?granularity=${gran}`);
    const periodos = new Map();
    const somar = (lista, chave) => {
      for (const p of lista) {
        if (!periodos.has(p.periodo))
          periodos.set(p.periodo, { growth: 0, deletions: 0, retrievals: 0 });
        periodos.get(p.periodo)[chave] = Number(p.total);
      }
    };
    somar(s.growth, "growth");
    somar(s.deletions, "deletions");
    somar(s.retrievals, "retrievals");
    if (periodos.size === 0) {
      wrap.appendChild(
        createElement("span", { className: "ai-donut-empty", text: "Sem dados no período." })
      );
      return;
    }
    const chaves = [...periodos.keys()].sort();
    const maxVal = Math.max(
      1,
      ...chaves.map((k) =>
        Math.max(periodos.get(k).growth, periodos.get(k).deletions, periodos.get(k).retrievals)
      )
    );
    for (const k of chaves) {
      const d = periodos.get(k);
      const linha = createElement("div", { className: "ai-ts-row" });
      linha.appendChild(createElement("span", { className: "ai-ts-label", text: k }));
      const barras = createElement("div", { className: "ai-ts-bars" });
      [
        ["growth", "Crescimento"],
        ["deletions", "Exclusões"],
        ["retrievals", "Recuperações"]
      ].forEach(([chave, titulo]) => {
        const barra = createElement("span", {
          className: `ai-ts-bar ai-ts-${chave}`,
          attributes: { title: `${titulo}: ${d[chave]}` }
        });
        applyDynamicStyles(barra, { width: `${(d[chave] / maxVal) * 100}%` });
        barras.appendChild(barra);
      });
      linha.appendChild(barras);
      wrap.appendChild(linha);
    }
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function carregarTopMemoria() {
  const tbody = document.getElementById("ai-memory-top-body");
  if (!tbody) return;
  clearElement(tbody);
  try {
    const { top } = await iaJson("/memory/dashboard/top?limit=10");
    if (!top.length) {
      const tr = document.createElement("tr");
      tr.appendChild(createElement("td", { text: "Sem dados.", attributes: { colspan: 6 } }));
      tbody.appendChild(tr);
      return;
    }
    for (const u of top) {
      const tr = document.createElement("tr");
      [
        u.name || "—",
        u.email || "—",
        formatarBytes(u.bytes),
        String(u.items),
        String(u.embeddings),
        u.last_activity ? new Date(u.last_activity + "Z").toLocaleString("pt-BR") : "—"
      ].forEach((v) => tr.appendChild(createElement("td", { text: v })));
      tbody.appendChild(tr);
    }
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function carregarRouterIA() {
  const wrap = document.getElementById("ai-router");
  if (!wrap) return;
  clearElement(wrap);
  try {
    const p = await iaJson("/governance/router");
    const opcoes = [
      ["sensitive_local_only", "Dados sensíveis só em modelo local"],
      ["tools_require_capability", "Ações só em modelos com tool calling"],
      ["fallback_allowed", "Permitir fallback para remoto"]
    ];
    for (const [chave, rotulo] of opcoes) {
      const linha = createElement("label", { className: "ai-router-row" });
      const check = createElement("input", { attributes: { type: "checkbox" } });
      check.checked = Boolean(p[chave]);
      check.addEventListener("change", () => atualizarRouterIA(chave, check.checked));
      linha.append(check, createElement("span", { text: rotulo }));
      wrap.appendChild(linha);
    }
    wrap.appendChild(
      createElement("p", { className: "ai-router-version", text: `Política versão ${p.version}` })
    );
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function atualizarRouterIA(campo, valor) {
  try {
    await iaJson("/governance/router", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [campo]: valor })
    });
    showToast("Política de roteamento atualizada.", "success");
    await carregarRouterIA();
  } catch (e) {
    showToast(e.message, "error");
    await carregarRouterIA();
  }
}

async function carregarPosturaIA() {
  const wrap = document.getElementById("ai-privacy-posture");
  if (!wrap) return;
  clearElement(wrap);
  try {
    const p = await iaJson("/memory/privacy-posture");
    const linhas = [
      ["Criptografia", p.encryption],
      ["Guarda da chave", p.key_storage],
      ["Versões de chave", p.key_versions],
      ["Usuários com chave", p.users_with_key],
      ["Itens sem expiração", p.items_without_expiry],
      ["Rotação pendente (>90d)", p.rotation_pending],
      ["Confidential computing", p.confidential_computing_ready ? "Pronto" : "Não atestado"]
    ];
    for (const [rotulo, valor] of linhas) {
      const linha = createElement("div", { className: "ai-posture-row" });
      linha.append(
        createElement("span", { className: "ai-posture-label", text: rotulo }),
        createElement("span", { className: "ai-posture-value", text: String(valor) })
      );
      wrap.appendChild(linha);
    }
    wrap.appendChild(createElement("p", { className: "ai-router-version", text: p.note }));
  } catch (e) {
    showToast(e.message, "error");
  }
}

let iaLegalTimer = null;
function debounceLegal() {
  clearTimeout(iaLegalTimer);
  iaLegalTimer = setTimeout(carregarLivroLegal, 350);
}

async function carregarLivroLegal() {
  const tbody = document.getElementById("ai-legal-ledger-body");
  if (!tbody) return;
  clearElement(tbody);
  const q = document.getElementById("ai-legal-search")?.value.trim() || "";
  try {
    const resp = await apiFetch(
      `/api/privacy/admin/legal-ledger${q ? `?q=${encodeURIComponent(q)}` : ""}`
    );
    const payload = await responsePayload(resp.clone());
    if (!resp.ok) throw new Error(apiErrorMessage(payload, "Falha ao carregar retenção legal."));
    const registros = payload.records || [];
    if (!registros.length) {
      const tr = document.createElement("tr");
      tr.appendChild(
        createElement("td", {
          text: "Nenhum registro de retenção legal.",
          attributes: { colspan: 8 }
        })
      );
      tbody.appendChild(tr);
      return;
    }
    for (const r of registros) {
      const tr = document.createElement("tr");
      [
        r.user_name,
        r.user_email,
        r.category,
        r.legal_basis,
        r.reference,
        r.retained_at ? new Date(r.retained_at + "Z").toLocaleDateString("pt-BR") : "—",
        r.retention_until ? new Date(r.retention_until).toLocaleDateString("pt-BR") : "—",
        Number(r.account_deleted) ? "Excluída" : "Ativa"
      ].forEach((v) => tr.appendChild(createElement("td", { text: String(v) })));
      tbody.appendChild(tr);
    }
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function carregarUsuariosMemoria() {
  const tbody = document.getElementById("ai-memory-body");
  if (!tbody) return;
  clearElement(tbody);
  try {
    const { users } = await iaJson("/memory/users");
    if (!users.length) {
      const tr = document.createElement("tr");
      tr.appendChild(
        createElement("td", { text: "Nenhum usuário com memória.", attributes: { colspan: 6 } })
      );
      tbody.appendChild(tr);
      return;
    }
    for (const u of users) {
      const tr = document.createElement("tr");
      tr.append(
        createElement("td", { text: u.name || "—" }),
        createElement("td", { text: u.email || "—" }),
        createElement("td", { text: Number(u.enabled) ? "Sim" : "Não" }),
        createElement("td", { text: String(u.total_items) }),
        createElement("td", { text: Number(u.writes_blocked) ? "Bloqueadas" : "Liberadas" })
      );
      const acoes = createElement("td");
      acoes.append(
        iaBotao(Number(u.writes_blocked) ? "Liberar" : "Bloquear", () =>
          bloquearGravacoesMemoria(u.user_id, !Number(u.writes_blocked))
        ),
        iaBotao("Rotacionar chave", () => rotacionarChaveMemoria(u.user_id)),
        iaBotao("Limpar", () => limparMemoriaAdmin(u.user_id), "danger")
      );
      tr.appendChild(acoes);
      tbody.appendChild(tr);
    }
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function bloquearGravacoesMemoria(userId, blocked) {
  try {
    await iaJson(`/memory/users/${userId}/block-writes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blocked })
    });
    showToast(blocked ? "Gravações bloqueadas." : "Gravações liberadas.", "success");
    await carregarMemoriaAdminIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function rotacionarChaveMemoria(userId) {
  try {
    const r = await iaJson(`/memory/users/${userId}/rotate-key`, { method: "POST" });
    showToast(
      `Chave rotacionada (v${r.from_version}→v${r.to_version}, ${r.items} itens).`,
      "success"
    );
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function limparMemoriaAdmin(userId) {
  const r = await showAppDialog({
    title: "Limpar memória do usuário",
    description:
      "Isto apaga permanentemente toda a memória deste usuário (exclusão criptográfica). Continuar?",
    confirmText: "Limpar",
    cancelText: "Cancelar",
    tone: "danger"
  });
  if (!r.confirmed) return;
  try {
    const res = await iaJson(`/memory/users/${userId}`, { method: "DELETE" });
    showToast(`${res.deleted_items} item(ns) apagado(s).`, "success");
    await carregarMemoriaAdminIA();
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ---------------------------------------------------------- Memória (usuário)
const MEMORIA_BASE = "/api/ai/memory";
let memoriaIniciada = false;

function initMemoriaUsuario() {
  if (memoriaIniciada) return;
  const painel = document.getElementById("memory-panel");
  if (!painel) return;
  memoriaIniciada = true;
  painel.addEventListener("toggle", () => {
    if (painel.open) carregarMemoriaUsuario();
  });
  document.getElementById("memory-toggle-btn").addEventListener("click", alternarMemoriaUsuario);
  document.getElementById("memory-add-btn").addEventListener("click", adicionarMemoriaUsuario);
  document.getElementById("memory-purge-btn").addEventListener("click", limparMemoriaUsuario);
}

async function memoriaJson(resource, options) {
  const resp = await apiFetch(`${MEMORIA_BASE}${resource}`, options);
  const payload = await responsePayload(resp.clone()).catch(() => null);
  if (!resp.ok) throw new Error(apiErrorMessage(payload, "Falha na operação de memória."));
  return payload;
}

async function carregarMemoriaUsuario() {
  const valor = document.getElementById("memory-status-value");
  const botao = document.getElementById("memory-toggle-btn");
  const add = document.getElementById("memory-add");
  const acoes = document.getElementById("memory-actions");
  const lista = document.getElementById("memory-items");
  if (!valor) return;
  try {
    const status = await memoriaJson("/status");
    valor.textContent = status.enabled ? `Ativa — ${status.total_items} item(ns)` : "Desativada";
    botao.textContent = status.enabled ? "Desativar memória" : "Ativar memória";
    add.classList.toggle("hidden", !status.enabled);
    acoes.classList.toggle("hidden", !status.enabled);
    clearElement(lista);
    if (status.enabled) {
      const { items } = await memoriaJson("/items");
      if (!items.length) {
        lista.appendChild(
          createElement("p", {
            className: "memory-empty",
            text: "Nenhuma memória registrada ainda."
          })
        );
      } else {
        for (const item of items) lista.appendChild(renderMemoriaItem(item));
      }
    }
  } catch (e) {
    valor.textContent = "Indisponível";
    showToast(e.message, "error");
  }
}

function renderMemoriaItem(item) {
  const row = createElement("div", { className: "memory-item" });
  const info = createElement("div", { className: "memory-item-info" });
  info.append(
    createElement("span", { className: "memory-item-type", text: item.type }),
    createElement("span", { className: "memory-item-content", text: item.content })
  );
  row.appendChild(info);
  row.appendChild(iaBotao("Esquecer", () => esquecerMemoriaItem(item.id), "danger"));
  return row;
}

async function alternarMemoriaUsuario() {
  const valor = document.getElementById("memory-status-value").textContent;
  const ativando = /desativada|indispon/i.test(valor);
  try {
    await memoriaJson(ativando ? "/enable" : "/disable", { method: "POST" });
    showToast(ativando ? "Memória ativada." : "Memória desativada.", "success");
    await carregarMemoriaUsuario();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function adicionarMemoriaUsuario() {
  const campo = document.getElementById("memory-new-content");
  const conteudo = campo.value.trim();
  if (conteudo.length < 2) {
    showToast("Escreva algo para memorizar.", "warning");
    return;
  }
  try {
    await memoriaJson("/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "preferencia", purpose: "personalizacao", content: conteudo })
    });
    campo.value = "";
    showToast("Salvo na sua memória.", "success");
    await carregarMemoriaUsuario();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function esquecerMemoriaItem(id) {
  try {
    const resp = await apiFetch(`${MEMORIA_BASE}/items/${id}`, { method: "DELETE" });
    if (!resp.ok && resp.status !== 204) throw new Error("Falha ao esquecer item.");
    showToast("Item esquecido.", "success");
    await carregarMemoriaUsuario();
  } catch (e) {
    showToast(e.message, "error");
  }
}

async function limparMemoriaUsuario() {
  const r = await showAppDialog({
    title: "Apagar toda a memória",
    description:
      "Isto remove permanentemente toda a sua memória de IA (com comprovante). Deseja continuar?",
    confirmText: "Apagar tudo",
    cancelText: "Cancelar",
    tone: "danger"
  });
  if (!r.confirmed) return;
  try {
    const res = await memoriaJson("/", { method: "DELETE" });
    showToast(`${res.deleted_items} item(ns) apagado(s).`, "success");
    await carregarMemoriaUsuario();
  } catch (e) {
    showToast(e.message, "error");
  }
}

// ============================================================
// ASSISTENTE DE IA — CHAT FLUTUANTE (Tarefa 16)
// ============================================================

const ASSISTENTE_BASE = "/api/ai/assistant";
const assistenteEstado = {
  iniciado: false,
  historicoCarregado: false,
  status: null,
  ocupado: false,
  controlador: null,
  focoAnterior: null
};

const COPILOTO_ASSISTENCIAS = Object.freeze([
  "correcao",
  "clareza",
  "passos",
  "dicas",
  "microtarefas",
  "estimativa",
  "dependencias",
  "prioridade",
  "criterio"
]);

const copilotoAgendaEstado = {
  iniciado: false,
  ocupado: false,
  original: "",
  sugestao: "",
  alvo: "title",
  kind: "clareza"
};

function statusAssistenteNormalizado(payload = {}) {
  const connection = payload.connection || {};
  const connected = Boolean(
    payload.connected ?? payload.available ?? connection.connected ?? connection.available
  );
  const provider =
    payload.provider_label || payload.provider || connection.provider_label || connection.provider || "IA";
  const model = payload.model_label || payload.model || connection.model_label || connection.model || "modelo não informado";
  const isLocal = Boolean(payload.is_local ?? connection.is_local);
  return { connected, provider, model, isLocal };
}

function atualizarStatusVisualAssistente(payload) {
  const status = statusAssistenteNormalizado(payload);
  assistenteEstado.status = status;
  const connection = document.getElementById("assistant-connection");
  const privacy = document.getElementById("assistant-privacy");
  const consentWrap = document.getElementById("assistant-consent-wrap");
  const agendaPrivacy = document.getElementById("agenda-ai-privacy");
  const agendaConsent = document.getElementById("agenda-ai-consent-wrap");

  if (connection) {
    connection.textContent = status.connected
      ? `${status.provider} · ${status.model} · ${status.isLocal ? "local" : "remoto"}`
      : "Nenhum modelo disponível";
    connection.className = status.connected
      ? `assistant-connection ${status.isLocal ? "is-local" : "is-remote"}`
      : "assistant-connection is-offline";
  }
  if (privacy) {
    privacy.textContent = !status.connected
      ? "Conecte um modelo para conversar."
      : status.isLocal
        ? "Processamento local: o texto não sai deste ambiente."
        : "Processamento remoto: confirme o consentimento antes de cada envio.";
  }
  if (consentWrap) consentWrap.classList.toggle("hidden", !status.connected || status.isLocal);
  if (agendaPrivacy) {
    agendaPrivacy.textContent = !status.connected
      ? "Nenhum modelo está disponível para o copiloto."
      : status.isLocal
        ? `${status.provider} · ${status.model}: processamento local.`
        : `${status.provider} · ${status.model}: o texto será enviado a um provedor remoto.`;
    agendaPrivacy.className = `agenda-ai-privacy ${
      !status.connected ? "is-offline" : status.isLocal ? "is-local" : "is-remote"
    }`;
  }
  if (agendaConsent) agendaConsent.classList.toggle("hidden", !status.connected || status.isLocal);
  definirAssistenteOcupado(assistenteEstado.ocupado);
}

async function carregarStatusAssistente() {
  try {
    const response = await apiFetch(`${ASSISTENTE_BASE}/status`);
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(apiErrorMessage(payload, "Não foi possível consultar o modelo."));
    atualizarStatusVisualAssistente(payload);
    return assistenteEstado.status;
  } catch (error) {
    atualizarStatusVisualAssistente({ connected: false });
    const connection = document.getElementById("assistant-connection");
    if (connection) connection.textContent = error.message;
    return assistenteEstado.status;
  }
}

function definirAssistenteOcupado(ocupado) {
  assistenteEstado.ocupado = ocupado;
  const panel = document.getElementById("assistant-panel");
  const messages = document.getElementById("assistant-messages");
  const field = document.getElementById("assistant-text");
  const send = document.getElementById("assistant-send");
  const stop = document.getElementById("assistant-stop");
  const clear = document.getElementById("assistant-clear");
  const connected = Boolean(assistenteEstado.status?.connected);
  if (panel) panel.setAttribute("aria-busy", String(ocupado));
  if (messages) messages.setAttribute("aria-busy", String(ocupado));
  if (field) field.disabled = ocupado || !connected;
  if (send) send.disabled = ocupado || !connected;
  if (clear) clear.disabled = ocupado;
  if (stop) stop.classList.toggle("hidden", !ocupado);
}

function adicionarMensagemAssistente(autor, texto, options = {}) {
  const lista = document.getElementById("assistant-messages");
  const role = autor === "user" ? "user" : "assistant";
  const bolha = createElement("div", {
    className: `assistant-msg assistant-msg-${role}`,
    text: texto,
    attributes: {
      role: "group",
      "aria-label": role === "user" ? "Você" : "Assistente"
    }
  });
  if (options.id) bolha.dataset.messageId = options.id;
  lista.appendChild(bolha);
  lista.scrollTop = lista.scrollHeight;
  return bolha;
}

function mensagemInicialAssistente() {
  adicionarMensagemAssistente(
    "assistant",
    "Olá! Posso consultar seus dados e propor ações reais. Toda alteração exige sua confirmação explícita."
  );
}

function limparMensagensAssistente() {
  clearElement(document.getElementById("assistant-messages"));
}

function rotuloFerramentaAssistente(tool) {
  const labels = {
    listar_atividades: "Atividades consultadas",
    consultar_agenda: "Agenda consultada",
    consultar_disponibilidade: "Disponibilidade consultada",
    consultar_metas: "Metas consultadas",
    criar_atividade: "Atividade criada",
    editar_atividade: "Atividade atualizada",
    concluir_tarefa: "Tarefa concluída",
    excluir_atividade: "Atividade excluída",
    criar_compromisso: "Compromisso criado",
    editar_compromisso: "Compromisso atualizado",
    sugerir_bloco_foco: "Bloco de foco sugerido"
  };
  return labels[tool] || String(tool || "Ação concluída").replaceAll("_", " ");
}

function renderExecucaoAssistente(execution) {
  const count = Array.isArray(execution?.result) ? execution.result.length : null;
  const text = count === null
    ? `✓ ${rotuloFerramentaAssistente(execution?.tool)}.`
    : `✓ ${rotuloFerramentaAssistente(execution?.tool)}: ${count} item(ns).`;
  adicionarMensagemAssistente("assistant", text);
}

function processarPayloadAssistente(payload = {}, options = {}) {
  if (payload.message && !options.ignoreMessage) {
    adicionarMensagemAssistente("assistant", payload.message);
  }
  for (const execution of payload.executions || []) renderExecucaoAssistente(execution);
  const proposals = payload.proposals || (payload.proposal ? [payload.proposal] : []);
  for (const proposal of proposals) renderPropostaAssistente(proposal);
}

function renderItemHistoricoAssistente(item) {
  if (!item) return;
  if (item.type === "proposal" || item.proposal_id) {
    if (item.status === "pending" || item.status === "pendente" || !item.status) {
      renderPropostaAssistente(item.proposal || item);
    }
    return;
  }
  const role = item.role === "user" ? "user" : "assistant";
  const text = item.content ?? item.message ?? item.text;
  if (text) adicionarMensagemAssistente(role, text, { id: item.id });
}

async function carregarHistoricoAssistente({ force = false } = {}) {
  if (assistenteEstado.historicoCarregado && !force) return;
  const lista = document.getElementById("assistant-messages");
  lista.setAttribute("aria-busy", "true");
  try {
    const response = await apiFetch(`${ASSISTENTE_BASE}/history`);
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(apiErrorMessage(payload, "Não foi possível carregar o histórico."));
    limparMensagensAssistente();
    const items = payload.history || payload.messages || [];
    for (const item of items) renderItemHistoricoAssistente(item);
    for (const proposal of payload.proposals || []) renderPropostaAssistente(proposal);
    if (!lista.childElementCount) mensagemInicialAssistente();
    assistenteEstado.historicoCarregado = true;
  } catch (error) {
    limparMensagensAssistente();
    adicionarMensagemAssistente("assistant", `Histórico indisponível: ${error.message}`);
  } finally {
    lista.setAttribute("aria-busy", "false");
  }
}

async function limparHistoricoAssistente() {
  if (assistenteEstado.ocupado) return;
  const dialog = await showAppDialog({
    title: "Limpar histórico do assistente",
    description: "As mensagens desta conversa serão removidas. Seus dados do app e sua memória de IA não serão alterados.",
    confirmText: "Limpar histórico",
    cancelText: "Manter histórico",
    tone: "danger"
  });
  if (!dialog.confirmed) return;
  const button = document.getElementById("assistant-clear");
  button.disabled = true;
  try {
    const response = await apiFetch(`${ASSISTENTE_BASE}/history`, { method: "DELETE" });
    if (!response.ok && response.status !== 204) {
      const payload = await responsePayload(response);
      throw new Error(apiErrorMessage(payload, "Não foi possível limpar o histórico."));
    }
    assistenteEstado.historicoCarregado = true;
    limparMensagensAssistente();
    mensagemInicialAssistente();
    showToast("Histórico do assistente limpo.", "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    button.disabled = false;
  }
}

function fecharAssistente() {
  const panel = document.getElementById("assistant-panel");
  const fab = document.getElementById("assistant-fab");
  panel.classList.add("hidden");
  fab.setAttribute("aria-expanded", "false");
  (assistenteEstado.focoAnterior || fab).focus();
}

async function abrirAssistente() {
  const panel = document.getElementById("assistant-panel");
  const fab = document.getElementById("assistant-fab");
  const opening = panel.classList.contains("hidden");
  if (!opening) {
    fecharAssistente();
    return;
  }
  assistenteEstado.focoAnterior = document.activeElement;
  panel.classList.remove("hidden");
  fab.setAttribute("aria-expanded", "true");
  await Promise.all([carregarStatusAssistente(), carregarHistoricoAssistente()]);
  document.getElementById("assistant-text").focus();
}

function decodificarEventoSse(block) {
  let event = "message";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  const raw = data.join("\n");
  if (!raw || raw === "[DONE]") return null;
  try {
    return { event, payload: JSON.parse(raw) };
  } catch {
    return { event, payload: { text: raw } };
  }
}

async function consumirEventosSse(response, onEvent) {
  if (!response.body?.getReader) {
    throw new Error("Este navegador não oferece streaming de respostas.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const parsed = decodificarEventoSse(block);
      if (parsed) onEvent(parsed.event, parsed.payload);
    }
    if (done) break;
  }
  const parsed = decodificarEventoSse(buffer);
  if (parsed) onEvent(parsed.event, parsed.payload);
}

function tratarEventoStreamAssistente(eventName, payload, bubble) {
  const type = payload.type || eventName;
  if (["token", "delta", "content"].includes(type)) {
    const delta = payload.delta ?? payload.text ?? payload.content ?? "";
    if (delta) bubble.textContent += delta;
    return;
  }
  if (["message", "final"].includes(type)) {
    const text = payload.message ?? payload.text ?? payload.content;
    if (text && !bubble.textContent) bubble.textContent = text;
    processarPayloadAssistente(payload, { ignoreMessage: true });
    return;
  }
  if (type === "proposal") {
    renderPropostaAssistente(payload.proposal || payload);
    return;
  }
  if (type === "execution") {
    renderExecucaoAssistente(payload.execution || payload);
    return;
  }
  if (type === "done") {
    processarPayloadAssistente(payload, { ignoreMessage: Boolean(bubble.textContent) });
    return;
  }
  if (type === "error") throw new Error(payload.message || "O streaming foi interrompido pelo servidor.");
}

async function enviarMensagemAssistente(evento) {
  evento.preventDefault();
  if (assistenteEstado.ocupado) return;
  const field = document.getElementById("assistant-text");
  const text = field.value.trim();
  if (!text) return;
  if (!assistenteEstado.status?.connected) {
    showToast("Nenhum modelo de IA está disponível.", "warning");
    return;
  }
  const remoteConsent = document.getElementById("assistant-remote-consent");
  if (!assistenteEstado.status.isLocal && !remoteConsent.checked) {
    showToast("Confirme o envio ao provedor remoto antes de continuar.", "warning");
    remoteConsent.focus();
    return;
  }

  adicionarMensagemAssistente("user", text);
  field.value = "";
  const bubble = adicionarMensagemAssistente("assistant", "");
  bubble.classList.add("is-streaming");
  assistenteEstado.controlador = new AbortController();
  definirAssistenteOcupado(true);
  try {
    const response = await apiFetch(`${ASSISTENTE_BASE}/chat/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({
        message: text,
        ...(!assistenteEstado.status.isLocal ? { remote_consent: true } : {})
      }),
      signal: assistenteEstado.controlador.signal
    });
    if (!response.ok) {
      const payload = await responsePayload(response);
      throw new Error(apiErrorMessage(payload, "Falha no assistente."));
    }
    await consumirEventosSse(response, (name, payload) =>
      tratarEventoStreamAssistente(name, payload, bubble)
    );
    if (!bubble.textContent) bubble.textContent = "Resposta concluída.";
    if (typeof refreshData === "function") refreshData();
  } catch (error) {
    if (error?.name === "AbortError" || assistenteEstado.controlador?.signal.aborted) {
      if (!bubble.textContent) bubble.textContent = "Resposta interrompida por você.";
      bubble.classList.add("is-stopped");
    } else {
      if (!bubble.textContent) bubble.textContent = `Erro: ${error.message}`;
      bubble.classList.add("is-error");
    }
  } finally {
    bubble.classList.remove("is-streaming");
    assistenteEstado.controlador = null;
    definirAssistenteOcupado(false);
    if (remoteConsent) remoteConsent.checked = false;
    field.focus();
  }
}

function pararAssistente() {
  assistenteEstado.controlador?.abort();
}

function renderPropostaAssistente(proposta) {
  const list = document.getElementById("assistant-messages");
  const proposalId = proposta?.proposal_id || proposta?.id;
  const summary = proposta?.summary || "Ação proposta pelo assistente.";
  const block = createElement("section", {
    className: "assistant-proposal",
    attributes: { "aria-label": `Confirmação necessária: ${summary}` }
  });
  block.appendChild(createElement("p", { className: "assistant-proposal-text", text: summary }));
  const actions = createElement("div", { className: "assistant-proposal-actions" });
  const confirm = createElement("button", {
    className: "btn btn-primary",
    text: "Confirmar",
    attributes: { type: "button", "aria-label": `Confirmar: ${summary}` }
  });
  const cancel = createElement("button", {
    className: "btn btn-cancel",
    text: "Cancelar",
    attributes: { type: "button", "aria-label": `Cancelar: ${summary}` }
  });
  if (!proposalId) {
    confirm.disabled = true;
    confirm.title = "Proposta sem identificador seguro.";
  }
  const lockActions = () => {
    confirm.disabled = true;
    cancel.disabled = true;
    block.setAttribute("aria-busy", "true");
  };
  confirm.addEventListener("click", async () => {
    if (!proposalId) return;
    lockActions();
    try {
      const response = await apiFetch(`${ASSISTENTE_BASE}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: { proposal_id: proposalId } })
      });
      const payload = await responsePayload(response);
      if (!response.ok) throw new Error(apiErrorMessage(payload, "Falha ao executar a ação."));
      block.remove();
      processarPayloadAssistente(payload);
      if (!payload.message) adicionarMensagemAssistente("assistant", "Ação confirmada e concluída.");
      if (typeof refreshData === "function") refreshData();
    } catch (error) {
      confirm.disabled = false;
      cancel.disabled = false;
      block.setAttribute("aria-busy", "false");
      adicionarMensagemAssistente("assistant", `Erro: ${error.message}`);
    }
  });
  cancel.addEventListener("click", async () => {
    if (!proposalId) {
      block.remove();
      return;
    }
    lockActions();
    try {
      const response = await apiFetch(
        `${ASSISTENTE_BASE}/proposals/${encodeURIComponent(proposalId)}`,
        { method: "DELETE" }
      );
      if (!response.ok && response.status !== 204) {
        const payload = await responsePayload(response);
        throw new Error(apiErrorMessage(payload, "Não foi possível cancelar a proposta."));
      }
      block.remove();
      adicionarMensagemAssistente("assistant", "Ação cancelada. Nenhuma alteração foi executada.");
    } catch (error) {
      confirm.disabled = false;
      cancel.disabled = false;
      block.setAttribute("aria-busy", "false");
      adicionarMensagemAssistente("assistant", `Erro ao cancelar: ${error.message}`);
    }
  });
  actions.append(confirm, cancel);
  block.appendChild(actions);
  list.appendChild(block);
  list.scrollTop = list.scrollHeight;
}

function campoAgendaDoCopiloto(target = copilotoAgendaEstado.alvo) {
  return document.getElementById(target === "description" ? "agenda-desc" : "agenda-title");
}

function definirCopilotoAgendaOcupado(ocupado) {
  copilotoAgendaEstado.ocupado = ocupado;
  const panel = document.getElementById("agenda-ai-panel");
  if (!panel) return;
  panel.setAttribute("aria-busy", String(ocupado));
  for (const id of [
    "agenda-ai-kind",
    "agenda-ai-target",
    "agenda-ai-generate",
    "agenda-ai-apply",
    "agenda-ai-apply-partial",
    "agenda-ai-retry",
    "agenda-ai-discard"
  ]) {
    const control = document.getElementById(id);
    if (control) control.disabled = ocupado;
  }
}

function resetarCopilotoAgenda({ close = true } = {}) {
  copilotoAgendaEstado.original = "";
  copilotoAgendaEstado.sugestao = "";
  const panel = document.getElementById("agenda-ai-panel");
  const trigger = document.getElementById("agenda-ai-trigger");
  const comparison = document.getElementById("agenda-ai-comparison");
  const actions = document.getElementById("agenda-ai-actions");
  const feedback = document.getElementById("agenda-ai-feedback");
  if (close && panel) panel.classList.add("hidden");
  if (trigger) trigger.setAttribute("aria-expanded", close ? "false" : "true");
  if (comparison) comparison.classList.add("hidden");
  if (actions) actions.classList.add("hidden");
  if (feedback) feedback.textContent = "";
  const original = document.getElementById("agenda-ai-original");
  const suggestion = document.getElementById("agenda-ai-suggestion");
  if (original) original.value = "";
  if (suggestion) suggestion.value = "";
  definirCopilotoAgendaOcupado(false);
}

async function executarCopilotoAgenda({ retry = false } = {}) {
  if (copilotoAgendaEstado.ocupado) return;
  const kind = document.getElementById("agenda-ai-kind").value;
  const target = document.getElementById("agenda-ai-target").value;
  if (!COPILOTO_ASSISTENCIAS.includes(kind)) return;
  const currentText = campoAgendaDoCopiloto(target).value.trim();
  const text = retry ? copilotoAgendaEstado.original : currentText;
  const feedback = document.getElementById("agenda-ai-feedback");
  if (text.length < 2) {
    feedback.textContent = "Preencha o campo escolhido com pelo menos 2 caracteres.";
    campoAgendaDoCopiloto(target).focus();
    return;
  }
  await carregarStatusAssistente();
  if (!assistenteEstado.status?.connected) {
    feedback.textContent = "Nenhum modelo de IA está disponível.";
    return;
  }
  const consent = document.getElementById("agenda-ai-remote-consent");
  if (!assistenteEstado.status.isLocal && !consent.checked) {
    feedback.textContent = "Confirme o envio ao provedor remoto antes de gerar a sugestão.";
    consent.focus();
    return;
  }

  copilotoAgendaEstado.kind = kind;
  copilotoAgendaEstado.alvo = target;
  copilotoAgendaEstado.original = text;
  feedback.textContent = "Gerando sugestão sem alterar o formulário…";
  definirCopilotoAgendaOcupado(true);
  try {
    const response = await apiFetch(`${ASSISTENTE_BASE}/copilot`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind,
        text,
        ...(!assistenteEstado.status.isLocal ? { remote_consent: true } : {})
      })
    });
    const payload = await responsePayload(response);
    if (!response.ok) throw new Error(apiErrorMessage(payload, "Não foi possível gerar a sugestão."));
    const suggestion = String(payload.suggestion || "").trim();
    if (!suggestion) throw new Error("O modelo não retornou uma sugestão utilizável.");
    copilotoAgendaEstado.sugestao = suggestion;
    document.getElementById("agenda-ai-original").value = text;
    document.getElementById("agenda-ai-suggestion").value = suggestion;
    document.getElementById("agenda-ai-comparison").classList.remove("hidden");
    document.getElementById("agenda-ai-actions").classList.remove("hidden");
    feedback.textContent = "Compare as versões. O original permanece intacto até você aplicar.";
  } catch (error) {
    feedback.textContent = `${error.message} O conteúdo original foi preservado.`;
  } finally {
    definirCopilotoAgendaOcupado(false);
    if (consent) consent.checked = false;
  }
}

function aplicarCopilotoAgenda({ partial = false } = {}) {
  const targetField = campoAgendaDoCopiloto();
  let value = copilotoAgendaEstado.sugestao;
  if (partial) {
    const suggestion = document.getElementById("agenda-ai-suggestion");
    value = suggestion.value.slice(suggestion.selectionStart, suggestion.selectionEnd).trim();
    if (!value) {
      document.getElementById("agenda-ai-feedback").textContent =
        "Selecione na sugestão o trecho que deseja aplicar parcialmente.";
      suggestion.focus();
      return;
    }
  }
  if (!value) return;
  targetField.value = value;
  targetField.dispatchEvent(new Event("input", { bubbles: true }));
  document.getElementById("agenda-ai-feedback").textContent = partial
    ? "Trecho selecionado aplicado. Revise antes de salvar."
    : "Sugestão aplicada. Revise antes de salvar.";
  targetField.focus();
}

function initCopilotoAgenda() {
  if (copilotoAgendaEstado.iniciado) return;
  const trigger = document.getElementById("agenda-ai-trigger");
  if (!trigger) return;
  copilotoAgendaEstado.iniciado = true;
  if (canUseFeature("ai_assistant")) trigger.classList.remove("hidden");
  trigger.addEventListener("click", async () => {
    const panel = document.getElementById("agenda-ai-panel");
    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden", !opening);
    trigger.setAttribute("aria-expanded", String(opening));
    if (opening) {
      await carregarStatusAssistente();
      document.getElementById("agenda-ai-kind").focus();
    }
  });
  document.getElementById("agenda-ai-generate").addEventListener("click", () => executarCopilotoAgenda());
  document.getElementById("agenda-ai-apply").addEventListener("click", () => aplicarCopilotoAgenda());
  document
    .getElementById("agenda-ai-apply-partial")
    .addEventListener("click", () => aplicarCopilotoAgenda({ partial: true }));
  document
    .getElementById("agenda-ai-retry")
    .addEventListener("click", () => executarCopilotoAgenda({ retry: true }));
  document.getElementById("agenda-ai-discard").addEventListener("click", () => {
    resetarCopilotoAgenda({ close: false });
    document.getElementById("agenda-ai-feedback").textContent =
      "Sugestão descartada. O formulário original não foi alterado.";
  });
}

function initAssistente() {
  if (assistenteEstado.iniciado) return;
  const fab = document.getElementById("assistant-fab");
  if (!fab) return;
  assistenteEstado.iniciado = true;

  if (canUseFeature("ai_assistant")) fab.classList.remove("hidden");
  const painel = document.getElementById("assistant-panel");
  fab.addEventListener("click", abrirAssistente);
  document.getElementById("assistant-close").addEventListener("click", fecharAssistente);
  document.getElementById("assistant-form").addEventListener("submit", enviarMensagemAssistente);
  document.getElementById("assistant-stop").addEventListener("click", pararAssistente);
  document.getElementById("assistant-clear").addEventListener("click", limparHistoricoAssistente);
  document.getElementById("assistant-text").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      document.getElementById("assistant-form").requestSubmit();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !painel.classList.contains("hidden")) fecharAssistente();
  });
  initCopilotoAgenda();
}

document.addEventListener("DOMContentLoaded", async () => {
  // Guarda de autenticação: login obrigatório
  const authed = await checkAuthOrRedirect();
  if (!authed) return;

  try {
    await loadPlanCapabilities();
  } catch (error) {
    showToast(error.message || "Não foi possível validar os recursos do seu plano.", "warning");
  }

  initSidebar();
  initSearch();
  initProfile();
  initClock();
  initTimeframeControls();
  initCardModals();
  initAgendaModals();
  initLayoutSelector();
  initConfirmDeleteModal();
  initConfirmResetModal();
  initGoogleIntegration();
  initUsersAdmin();
  initPlansAdmin();
  initRewardModals();
  initTermometroEnergia();
  initMemoriaUsuario();
  initAssistente();
  applyRolePermissions();
  openRequestedSection();

  // Logout real (encerra sessão e volta ao login)
  const logoutBtn = document.getElementById("dropdown-logout-btn");
  if (logoutBtn) {
    const novo = logoutBtn.cloneNode(true); // remove listeners anteriores (tela de bloqueio)
    logoutBtn.parentNode.replaceChild(novo, logoutBtn);
    novo.addEventListener("click", doLogout);
  }
  document.getElementById("inline-agenda-close").addEventListener("click", closeInlineAgendaPanel);
  document.getElementById("focus-mode-close").addEventListener("click", closeFocusMode);
  document
    .getElementById("btn-add-agenda-event")
    .addEventListener("click", () => openAgendaModal());
  document
    .getElementById("btn-inline-add-event")
    .addEventListener("click", () => openAgendaModal());
  document.getElementById("settings-theme").addEventListener("change", saveSettingsFromTab);
  document.getElementById("settings-confetti").addEventListener("change", saveSettingsFromTab);
  document.getElementById("settings-sound").addEventListener("change", saveSettingsFromTab);
  document.getElementById("settings-live-interval").addEventListener("change", saveSettingsFromTab);
  document.getElementById("settings-db-reset").addEventListener("click", resetDatabase);
  document.getElementById("btn-focus-play-pause").addEventListener("click", toggleFocusTimer);
  document.getElementById("btn-focus-reset").addEventListener("click", resetFocusTimer);
  document.getElementById("btn-focus-complete").addEventListener("click", completeFocusTask);
  document.getElementById("focus-sound-select").addEventListener("change", function (e) {
    if (e.target.value === FEATURE_BINAURAL && !canUseBinauralSound()) {
      e.target.value = "nenhum";
      userProfile.focus_sound = "nenhum";
      stopFocusSound();
      showToast("Seu plano atual não inclui ondas binaurais.", "warning");
      return;
    }
    userProfile.focus_sound = e.target.value;
    if (pomodoroIsRunning) {
      startFocusSound(e.target.value);
    }
  });
  document.querySelectorAll("#focus-cycle-selector .layout-btn").forEach((btn) => {
    btn.addEventListener("click", () => setPomodoroCycle(parseInt(btn.dataset.cycle)));
  });
  await refreshData();
  await carregarTermometroEnergia();

  // Dashboard em tempo real: inicia o motor com o intervalo salvo do usuário.
  aoVivo.ultimaAtualizacao = new Date();
  iniciarAoVivo(userProfile.live_refresh_seconds || 20);
});

// ============================================================
// CONFIGURAÇÃO E ESTADO GLOBAL
// ============================================================

// Mapeamento de títulos do banco → cores CSS dos cards
const CARD_COLORS = {
  "Work": "orange",
  "Play": "blue",
  "Study": "red",
  "Exercise": "green",
  "Social": "purple",
  "Self Care": "yellow"
};

// Mapeamento de classes css para timeline por categoria
const TIMELINE_CLASSES = {
  "Work": "work",
  "Play": "play",
  "Study": "study",
  "Exercise": "exercise",
  "Social": "social",
  "Self Care": "selfcare"
};

// Pictogramas Emojis grandes para o layout inclusivo TDAH/TEA
const CATEGORY_PICTOGRAMS = {
  "Work": "💻",
  "Play": "🎮",
  "Study": "📚",
  "Exercise": "🏃",
  "Social": "👥",
  "Self Care": "💆"
};

// Tradução de títulos do banco → pt-BR
const TITLE_PT = {
  "Work": "Trabalho",
  "Play": "Lazer",
  "Study": "Estudos",
  "Exercise": "Exercícios",
  "Social": "Social",
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
  binaural: false
};

const ROLE_ADMIN = "administrador";
const FEATURE_BINAURAL = "binaural";

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

    const token = csrfToken || await loadCsrfToken();
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
  headers.set("Accept", "application/json");

  if (MUTATION_METHODS.has(method)) {
    headers.set("X-CSRF-Token", csrfToken || await loadCsrfToken());
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
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function formatDatePtBr(dateStr) {
  const [year, month, day] = dateStr.split('-');
  return `${day}/${month}/${year}`;
}

function getDayName(dateStr) {
  const date = new Date(dateStr + "T00:00:00");
  const days = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
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
    days.push(day.toISOString().split('T')[0]);
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

function createElement(tagName, {
  className = "",
  text = null,
  attributes = {},
  dataset = {},
  children = []
} = {}) {
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
      draw(createSvgElement("circle", { cx: 5, cy: 12, r: 1.5, fill: "currentColor", stroke: "none" }));
      draw(createSvgElement("circle", { cx: 12, cy: 12, r: 1.5, fill: "currentColor", stroke: "none" }));
      draw(createSvgElement("circle", { cx: 19, cy: 12, r: 1.5, fill: "currentColor", stroke: "none" }));
      break;
    case "edit":
      draw(createSvgElement("path", { d: "M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" }));
      draw(createSvgElement("path", { d: "M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" }));
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
      draw(createSvgElement("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }));
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
  dynamicStyleSheet = Array.from(document.styleSheets)
    .find(sheet => sheet.href && sheet.href.includes("/assets/css/app.css"));
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
  button.append(createIcon(iconType, { width: 16, height: 16, fill: "currentColor" }), document.createTextNode(` ${label}`));
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
  planCapabilities = { loaded: false, binaural: false };
  applyBinauralCapabilityToControls();

  const response = await apiFetch("/api/plans");
  const payload = await responsePayload(response);
  if (!response.ok || !payload?.matrix || !currentUser) {
    throw new Error(apiErrorMessage(payload, "Não foi possível validar os recursos do seu plano."));
  }

  const planFeatures = payload.matrix[currentUser.plan];
  planCapabilities = {
    loaded: true,
    binaural: currentUser.role === ROLE_ADMIN || Boolean(planFeatures?.[FEATURE_BINAURAL])
  };
  applyBinauralCapabilityToControls();
  return planCapabilities;
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
      body.appendChild(createElement("p", {
        className: "app-dialog-description",
        text: description,
        attributes: { id: descriptionId }
      }));
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
      fieldWrapper.appendChild(createElement("span", { className: "app-dialog-label", text: field.label }));

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
        const focusable = Array.from(modal.querySelectorAll(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => !element.hidden && element.getClientRects().length > 0);
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

    closeButton.addEventListener("click", () => closeActiveDialog({ confirmed: false, values: {} }));
    cancelButton.addEventListener("click", () => closeActiveDialog({ confirmed: false, values: {} }));
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
          errorBox.textContent = entry.input.validationMessage || `Revise o campo "${entry.config.label}".`;
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

// Correção do Bug de QA: populateCategorySelect definido de forma nativa e robusta
function populateCategorySelect(selectId, selectedId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  clearElement(select);
  activitiesData.forEach(activity => {
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
    const baseFreq = 200;   // portadora base (Hz)
    const beatFreq = 40;    // frequência Gamma alvo (Hz)

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
      output[i] = (lastOut + (0.02 * white)) / 1.02;
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
      g.connect(masterGain);   // via seco
      g.connect(convolver);    // via reverb
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
    selector.querySelectorAll(".layout-btn").forEach(b => {
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
  applyDynamicStyles(category, { color: `var(--${TIMELINE_CLASSES[event.activity_title] || "work"}-color)` });

  // Carregar som do perfil
  const select = document.getElementById("focus-sound-select");
  applyBinauralCapabilityToControls();
  const preferredSound = userProfile.focus_sound || "chuva";
  select.value = preferredSound === FEATURE_BINAURAL && !canUseBinauralSound()
    ? "nenhum"
    : preferredSound;

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
    const ratioDecorrido = pomodoroTotalSeconds > 0
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

function initSidebar() {
  const navItems = document.querySelectorAll(".nav-item");
  const hamburger = document.getElementById("hamburger");
  const sidebarNav = document.getElementById("sidebar-nav");
  const mobileOverlay = document.getElementById("mobile-overlay");

  // Navegação entre seções
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      const section = item.dataset.section;
      switchSection(section);

      // Fechar menu mobile se aberto
      sidebarNav.classList.remove("open");
      mobileOverlay.classList.remove("active");
      hamburger.classList.remove("active");

      // Atualizar estado visual dos botões
      navItems.forEach(n => n.classList.remove("active"));
      item.classList.add("active");
    });
  });

  // Hamburger
  hamburger.addEventListener("click", () => {
    const isOpen = sidebarNav.classList.toggle("open");
    mobileOverlay.classList.toggle("active", isOpen);
    hamburger.classList.toggle("active", isOpen);
  });

  // Fechar menu mobile via overlay
  mobileOverlay.addEventListener("click", () => {
    sidebarNav.classList.remove("open");
    mobileOverlay.classList.remove("active");
    hamburger.classList.remove("active");
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

  if (section === "agenda") {
    fetchAndRenderAgenda();
  } else if (section === "reports") {
    renderReports();
  } else if (section === "settings") {
    loadSettingsTab();
  } else if (section === "users") {
    renderUsersAdmin();
  } else if (section === "plans") {
    renderPlansAdmin();
  } else if (section === "dopamine") {
    renderDopamineAdmin();
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
  cards.forEach(card => {
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
document.getElementById("profile-avatar-input").addEventListener("change", function(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
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

async function savePreferencesModal() {
  const theme = document.getElementById("pref-theme").value;
  const enableConfetti = document.getElementById("pref-confetti").checked;

  try {
    await saveProfilePreferences({
      theme,
      focus_sound: userProfile.focus_sound || "chuva",
      enable_confetti: enableConfetti
    }, "Preferências aplicadas!");
    closeModal("modal-preferences-overlay");
  } catch (error) {
    showToast(error.message || "Erro ao salvar preferências.", "error");
  }
}

// ============================================================
// SIDEBAR — KPIs E RELÓGIO
// ============================================================

async function updateKPIs() {
  try {
    const response = await apiFetch("/api/dashboard/kpis");
    if (!response.ok) return;
    const kpis = await response.json();

    document.getElementById("kpi-daily-total").textContent = `${kpis.dailyTotal}hrs`;
    document.getElementById("kpi-weekly-percent").textContent = `${kpis.weeklyGoalPercent}%`;
    applyDynamicStyles(document.getElementById("kpi-weekly-bar"), { width: `${kpis.weeklyGoalPercent}%` });
    document.getElementById("kpi-activity-count").textContent = kpis.activityCount;
  } catch (err) {
    console.error("Erro ao atualizar KPIs:", err);
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

  activitiesData.forEach(activity => {
    const color = CARD_COLORS[activity.title] || "orange";
    const titlePt = TITLE_PT[activity.title] || activity.title;
    const config = TIMEFRAMES_CONFIG[activeTimeframe];
    const tf = activity.timeframes[activeTimeframe] || { current: 0, previous: 0 };
    const goalHours = activity.goals && activity.goals[activeTimeframe] ? activity.goals[activeTimeframe] : 0;

    const card = createElement("div", {
      className: `card ${color}`,
      dataset: { title: activity.title, id: activity.id }
    });

    let progressPercent = 0;
    let progressClass = "";
    if (goalHours > 0) {
      progressPercent = Math.min(Math.round((tf.current / goalHours) * 100), 100);
      if (tf.current > goalHours) progressClass = "exceeded";
    }

    const innerCard = createElement("div", { className: "inner-card" });
    const topSection = createElement("div", { className: "top-section" });
    topSection.appendChild(createElement("p", { text: titlePt }));

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
      { action: "details", label: "Ver Detalhes", icon: "details", danger: false },
      { action: "delete", label: "Excluir", icon: "delete", danger: true }
    ];

    actions.forEach((item, index) => {
      if (index === 3) {
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

  // Vincular clique no corpo do card (abrir painel expansível de agenda inline)
  document.querySelectorAll(".inner-card").forEach(innerCard => {
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
  document.querySelectorAll(".ellipsis-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      closeAllDropdowns();
      const dropdown = document.getElementById(`dropdown-${id}`);
      dropdown.classList.toggle("open");
    });
  });

  document.querySelectorAll(".dropdown-item").forEach(item => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      const action = item.dataset.action;
      const id = parseInt(item.dataset.id);
      const title = item.dataset.title;
      closeAllDropdowns();

      switch (action) {
        case "edit": openEditModal(id, title); break;
        case "goal": openGoalModal(id, title); break;
        case "details": openDetailsModal(id, title); break;
        case "delete": openDeleteModal(id, title); break;
      }
    });
  });
}

function closeAllDropdowns() {
  document.querySelectorAll(".card-dropdown.open").forEach(d => d.classList.remove("open"));
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
    "Work": "var(--work-color)",
    "Play": "var(--play-color)",
    "Study": "var(--study-color)",
    "Exercise": "var(--exercise-color)",
    "Social": "var(--social-color)",
    "Self Care": "var(--care-color)"
  };
  applyDynamicStyles(dot, { background: colorHex[title] || "var(--single-section)" });

  document.getElementById("inline-agenda-title").textContent = `Compromissos — ${titlePt}`;

  await renderInlineAgendaTable(activityId);

  panel.classList.remove("hidden");
  setTimeout(() => {
    panel.classList.add("open");
  }, 10);

  panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

      events.forEach(ev => {
        const tr = document.createElement("tr");
        const dateCell = createElement("td", { text: formatDatePtBr(ev.event_date) });
        const titleCell = document.createElement("td");
        titleCell.appendChild(createElement("strong", { text: ev.title }));
        const descriptionCell = createElement("td", { text: ev.description || "-" });
        const durationCell = document.createElement("td");
        durationCell.appendChild(createDurationBadge(`${ev.start_time} - ${ev.end_time} (${ev.duration_hours}h)`, ev.event_color || null));
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
  btns.forEach(btn => {
    btn.addEventListener("click", () => {
      btns.forEach(b => b.classList.remove("active"));
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
    default:
      renderLayoutAtual(container);
  }
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
  element.querySelectorAll(".quick-focus").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const ev = agendaEvents.find(item => item.id === parseInt(btn.dataset.id));
      if (ev) openFocusMode(ev);
    });
  });

  element.querySelectorAll(".quick-edit").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openAgendaModal(parseInt(btn.dataset.id));
    });
  });

  element.querySelectorAll(".quick-delete").forEach(btn => {
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

  const todayStr = new Date().toISOString().split('T')[0];
  const todayEvents = agendaEvents.filter(ev => ev.event_date === todayStr);

  // Calcular carga cognitiva total de hoje
  let totalCognitiveLoad = 0;
  todayEvents.forEach(ev => {
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
    advice = "Bateria esgotada! Altamente recomendado focar em relaxamento e pausas para evitar sobrecarga.";
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
    const emptyState = createStateMessage("Nenhuma atividade agendada para hoje. Aproveite para relaxar!");
    emptyState.classList.add("agenda-empty-state-featured");
    pecsGrid.appendChild(emptyState);
  } else {
    todayEvents.forEach(ev => {
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
        createElement("span", { className: `tdah-prio-badge ${ev.priority}`, text: ev.priority.toUpperCase() }),
        createElement("span", { className: "tdah-effort-indicator", text: effort, attributes: { title: "Carga Cognitiva" } })
      );

      const bodyRow = createElement("div", { className: "tdah-card-body-row" });
      const iconContainer = createElement("div", { className: "tdah-card-icon-container", text: emoji });
      applyDynamicStyles(iconContainer, {
        background: "rgba(255,255,255,0.04)",
        border: `1.5px solid ${ev.event_color || `var(--${evClass}-color)`}`
      });
      const content = createElement("div", { className: "tdah-card-body-copy" });
      const titleNode = createElement("div", { className: "tdah-card-title", text: ev.title });
      if (ev.is_completed) applyDynamicStyles(titleNode, { "text-decoration": "line-through" });
      content.append(
        titleNode,
        createElement("div", { className: "tdah-card-desc", text: ev.description || "Sem descrição adicional" })
      );
      bodyRow.append(iconContainer, content);

      const footer = createElement("div", { className: "tdah-card-footer" });
      const actionRow = createElement("div", { className: "tdah-card-actions" });
      actionRow.appendChild(createQuickActionsNode(ev.id));
      if (!ev.is_completed) {
        actionRow.appendChild(createElement("button", {
          className: "btn-focus",
          text: "🎯 Focar",
          attributes: { type: "button" }
        }));
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
  agendaEvents.forEach(ev => {
    if (!grouped[ev.event_date]) grouped[ev.event_date] = [];
    grouped[ev.event_date].push(ev);
  });

  const sortedDates = Object.keys(grouped).sort();

  sortedDates.forEach(dateStr => {
    const groupDiv = document.createElement("div");
    groupDiv.className = "timeline-group";

    const dateHeader = document.createElement("div");
    dateHeader.className = "timeline-date-header";
    dateHeader.textContent = formatDatePtBr(dateStr);
    groupDiv.appendChild(dateHeader);

    const containerEvents = document.createElement("div");
    containerEvents.className = "timeline-events-container";

    grouped[dateStr].forEach(ev => {
      const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
      const titlePt = TITLE_PT[ev.activity_title] || ev.activity_title;
      const effort = "⚡".repeat(ev.cognitive_load || 1);

      const card = document.createElement("div");
      card.className = `timeline-event-card ${evClass} ${ev.is_completed ? "completed" : ""}`;
      if (ev.event_color) {
        applyDynamicStyles(card, { "border-left-color": ev.event_color });
      }

      const timeInfo = createElement("div", { className: "event-time-info" });
      timeInfo.appendChild(createDurationBadge(`${ev.start_time} - ${ev.end_time}`, ev.event_color || null));

      const details = createElement("div", { className: "event-details" });
      if (ev.is_completed) {
        applyDynamicStyles(details, { "text-decoration": "line-through", opacity: "0.5" });
      }
      const titleRow = createElement("div", { className: "event-title event-title-row" });
      titleRow.append(
        document.createTextNode(ev.title),
        createElement("span", { className: `tdah-prio-badge ${ev.priority} tdah-prio-badge-inline`, text: ev.priority }),
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
const GOOGLE_COL_MIN = 90;   // px
const GOOGLE_COL_MAX = 600;  // px

// Lê as larguras salvas (array de 7 números em px) ou null se não personalizadas
function getGoogleColWidths() {
  try {
    const raw = localStorage.getItem(GOOGLE_COLS_KEY);
    if (!raw) return null;
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length === 7 && arr.every(n => typeof n === "number")) {
      return arr;
    }
  } catch (e) { /* ignora dados corrompidos */ }
  return null;
}

function saveGoogleColWidths(arr) {
  localStorage.setItem(GOOGLE_COLS_KEY, JSON.stringify(arr));
}

// Monta o grid-template-columns: 1ª coluna (Horário) fixa; dias em px ou minmax/1fr
function applyGoogleGridTemplate(grid, widths) {
  if (widths) {
    applyDynamicStyles(grid, {
      "grid-template-columns": `80px ${widths.map(w => `${w}px`).join(" ")}`,
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
  timeHeader.appendChild(createActionButton({
    className: "google-cols-reset",
    title: "Restaurar largura padrão das colunas",
    icon: createIcon("reset", { width: 10, height: 10, strokeWidth: 2.5 }),
    text: "Redefinir",
    attributes: { id: "google-cols-reset" }
  }));
  grid.appendChild(timeHeader);

  weekDays.forEach((dayStr, idx) => {
    const d = new Date(dayStr + "T00:00:00");
    const dayLabel = `${dayNamesShort[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
    const header = createElement("div", {
      className: "google-day-header",
      text: dayLabel,
      dataset: { colIndex: idx }
    });
    header.appendChild(createElement("span", {
      className: "google-col-resizer",
      dataset: { colIndex: idx },
      attributes: { title: "Arraste para redimensionar (duplo-clique para redefinir)" }
    }));
    grid.appendChild(header);
  });

  const timeSlots = ["07:00", "09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"];

  timeSlots.forEach(time => {
    grid.appendChild(createElement("div", { className: "google-time-cell", text: time }));

    weekDays.forEach(dayStr => {
      const cell = document.createElement("div");
      cell.className = "google-day-cell";

      const hourVal = parseInt(time.split(":")[0]);
      const dayEvents = agendaEvents.filter(ev => {
        if (ev.event_date !== dayStr) return false;
        const evStartHour = parseInt(ev.start_time.split(":")[0]);
        return evStartHour >= hourVal && evStartHour < hourVal + 2;
      });

      dayEvents.forEach(ev => {
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
    return headers.map(h => Math.round(h.getBoundingClientRect().width));
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
      const onTouchMove = (e) => { if (e.touches[0]) onMove(e.touches[0].clientX); };

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

    resizer.addEventListener("touchstart", (e) => {
      if (!e.touches[0]) return;
      e.preventDefault();
      e.stopPropagation();
      startDrag(e.touches[0].clientX);
    }, { passive: false });

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

  weekDays.forEach(dayStr => {
    const col = document.createElement("div");
    col.className = "ticktick-column";

    const d = new Date(dayStr + "T00:00:00");
    col.appendChild(createElement("div", {
      className: "ticktick-column-title",
      text: `${daysShort[d.getDay()]} — ${d.getDate()}/${d.getMonth()+1}`
    }));

    const dayEvents = agendaEvents.filter(ev => ev.event_date === dayStr);

    if (dayEvents.length === 0) {
      col.appendChild(createStateMessage("Sem compromissos", { compact: true }));
    } else {
      const listContainer = document.createElement("div");
      listContainer.className = "timeline-events-container";

      dayEvents.forEach(ev => {
        const card = document.createElement("div");
        card.className = `ticktick-task-card ${ev.is_completed ? "completed" : ""}`;
        if (ev.event_color) {
          applyDynamicStyles(card, { "border-left": `3px solid ${ev.event_color}` });
        }
        const checkboxContainer = createElement("div", { className: "ticktick-checkbox-container" });
        checkboxContainer.appendChild(createElement("span", {
          className: "ticktick-checkbox",
          attributes: { id: `check-${ev.id}` }
        }));
        const taskContent = createElement("div", { className: "ticktick-task-content" });
        taskContent.append(
          createElement("div", { className: "ticktick-task-title", text: ev.title }),
          createElement("div", { className: "ticktick-task-time", text: `${ev.start_time} - ${ev.end_time}` })
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
  const todayStr = today.toISOString().split('T')[0];

  const header = document.createElement("div");
  applyDynamicStyles(header, { "text-align": "center", "margin-bottom": "1rem" });
  header.appendChild(createElement("h4", {
    className: "morgen-heading",
    text: `Time-Blocking de Hoje (${formatDatePtBr(todayStr)})`
  }));
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

  const todayEvents = agendaEvents.filter(ev => ev.event_date === todayStr);

  todayEvents.forEach(ev => {
    const [startH, startM] = ev.start_time.split(':').map(Number);
    const [endH, endM] = ev.end_time.split(':').map(Number);

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
      createElement("div", { className: "morgen-event-time", text: `${ev.start_time} - ${ev.end_time}` })
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
  agendaEvents.forEach(ev => {
    if (!grouped[ev.activity_title]) grouped[ev.activity_title] = [];
    grouped[ev.activity_title].push(ev);
  });

  const todoistList = document.createElement("div");
  todoistList.className = "todoist-list";

  const colorHex = {
    "Work": "var(--work-color)",
    "Play": "var(--play-color)",
    "Study": "var(--study-color)",
    "Exercise": "var(--exercise-color)",
    "Social": "var(--social-color)",
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

    events.forEach(ev => {
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
        createElement("div", { className: "todoist-task-desc", text: ev.description || "Sem descrição" })
      );
      const meta = createElement("div", { className: "todoist-task-meta" });
      meta.append(
        createElement("div", { className: "todoist-task-date", text: formatDatePtBr(ev.event_date) }),
        createElement("span", { className: "todoist-task-time-badge", text: `${ev.start_time} - ${ev.end_time}` }),
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
  agendaEvents.forEach(ev => {
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

  columns.forEach(col => {
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
      eventsList.appendChild(createStateMessage("Nenhum compromisso nesta coluna", { compact: true }));
    } else {
      col.events.forEach(ev => {
        const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
        const titlePt = TITLE_PT[ev.activity_title] || ev.activity_title;
        const effort = "⚡".repeat(ev.cognitive_load || 1);

        const card = document.createElement("div");
        card.className = `kanban-event-card ${evClass} ${ev.is_completed ? "completed" : ""}`;
        
        if (ev.event_color) {
          applyDynamicStyles(card, { "border-left-color": ev.event_color });
        }

        const cardHeader = createElement("div", { className: "kanban-event-header" });
        cardHeader.appendChild(createElement("span", {
          className: "kanban-event-time",
          text: `${ev.start_time} - ${ev.end_time}`
        }));
        const checkboxWrap = createElement("div", { className: "ticktick-checkbox-container ticktick-checkbox-container-inline" });
        checkboxWrap.appendChild(createElement("span", {
          className: "ticktick-checkbox",
          attributes: { id: `kanban-check-${ev.id}` }
        }));
        cardHeader.appendChild(checkboxWrap);

        const titleNode = createElement("div", { className: "kanban-event-title", text: ev.title });
        const descNode = createElement("div", { className: "kanban-event-desc", text: ev.description || "Sem descrição" });
        if (ev.is_completed) {
          applyDynamicStyles(titleNode, { "text-decoration": "line-through", opacity: "0.6" });
          applyDynamicStyles(descNode, { opacity: "0.4" });
        }

        const footer = createElement("div", { className: "kanban-card-footer" });
        const categoryBadge = createElement("span", { className: "kanban-category-badge", text: titlePt });
        applyDynamicStyles(categoryBadge, { color: ev.event_color || `var(--${evClass}-color)` });
        const effortNode = createElement("span", { className: "event-effort-text", text: effort });
        const badge = createDurationBadge(`${formatDatePtBr(ev.event_date)} (${ev.duration_hours}h)`);
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
      throw new Error(apiErrorMessage(errorPayload, "Não foi possível alterar a conclusão do compromisso."));
    }

    // Motor de Recompensa Dopaminérgica ao concluir
    if (newState) {
      const ev = agendaEvents.find(e => e.id === eventId);
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
  const modal = document.getElementById("modal-agenda-overlay");
  const saveButton = document.getElementById("modal-agenda-save");

  if (eventId) {
    fetchEventDetailsAndOpenModal(eventId);
  } else {
    document.getElementById("modal-agenda-title").textContent = "Novo Compromisso";
    if (saveButton) saveButton.textContent = "Agendar";
    document.getElementById("agenda-title").value = "";
    document.getElementById("agenda-desc").value = "";
    document.getElementById("agenda-date").value = new Date().toISOString().split('T')[0];
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
    if (!response.ok) throw new Error(apiErrorMessage(events, "Não foi possível carregar o compromisso."));
    const ev = events.find(e => e.id === eventId);
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
    document.getElementById("agenda-load").value = ev.cognitive_load !== undefined ? String(ev.cognitive_load) : "2";
    document.getElementById("agenda-color").value = ev.event_color || "#7c6fff";

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

  const [startH, startM] = start_time.split(':').map(Number);
  const [endH, endM] = end_time.split(':').map(Number);
  if (endH * 60 + endM <= startH * 60 + startM) {
    showToast("A hora de término deve ser posterior à hora de início!", "warning");
    return;
  }

  const payload = { activity_id, title, description, event_date, start_time, end_time, priority, cognitive_load, event_color };
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

    showToast(currentAgendaEventId ? "Compromisso atualizado!" : "Compromisso agendado com sucesso!", "success");
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
  const ev = agendaEvents.find(e => e.id === eventId);
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
  document.getElementById("modal-confirm-delete-btn").addEventListener("click", performDeleteAgendaEvent);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
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

  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      activeTimeframe = btn.id;
      buttons.forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderCards();
    });
  });
}

// ============================================================
// MODAIS CARD — EDIÇÃO DE HORAS ACUMULADAS
// ============================================================

let currentEditId = null;

function openEditModal(id, title) {
  currentEditId = id;
  const activity = activitiesData.find(a => a.id === id);
  if (!activity) return;

  const tf = activity.timeframes[activeTimeframe] || { current: 0, previous: 0 };
  const titlePt = TITLE_PT[title] || title;
  const periodName = TIMEFRAMES_CONFIG[activeTimeframe].name;

  document.getElementById("modal-edit-title").textContent = `Editar Horas — ${titlePt} (${periodName})`;
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
  const activity = activitiesData.find(a => a.id === id);
  if (!activity) return;

  const titlePt = TITLE_PT[title] || title;
  const periodName = TIMEFRAMES_CONFIG[activeTimeframe].name;
  const currentGoal = activity.goals && activity.goals[activeTimeframe] ? activity.goals[activeTimeframe] : 0;

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

    periods.forEach(p => {
      const tf = data.timeframes[p.key] || { current: 0, previous: 0 };
      const goalH = data.goals && data.goals[p.key] ? data.goals[p.key] : 0;

      const card = document.createElement("div");
      card.className = "details-card";
      card.append(
        createElement("div", { className: "details-card-label", text: p.label }),
        createElement("div", { className: "details-card-value", text: `${tf.current}hrs` }),
        createElement("div", { className: "details-card-prev", text: `${p.prevLabel}: ${tf.previous}hrs` })
      );
      if (goalH > 0) {
        card.appendChild(createElement("div", { className: "details-card-prev", text: `Meta: ${goalH}hrs` }));
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
  document.querySelectorAll(".modal-overlay.open").forEach(m => m.classList.remove("open"));
}

function initCardModals() {
  document.getElementById("modal-edit-close").addEventListener("click", () => closeModal("modal-edit-overlay"));
  document.getElementById("modal-edit-save").addEventListener("click", saveEditModal);

  document.getElementById("modal-goal-close").addEventListener("click", () => closeModal("modal-goal-overlay"));
  document.getElementById("modal-goal-cancel").addEventListener("click", () => closeModal("modal-goal-overlay"));
  document.getElementById("modal-goal-save").addEventListener("click", saveGoalModal);

  document.getElementById("modal-delete-close").addEventListener("click", () => closeModal("modal-delete-overlay"));
  document.getElementById("modal-delete-cancel").addEventListener("click", () => closeModal("modal-delete-overlay"));
  document.getElementById("modal-delete-confirm").addEventListener("click", confirmDelete);

  document.getElementById("modal-details-close").addEventListener("click", () => closeModal("modal-details-overlay"));

  // Perfil e Preferências
  document.getElementById("modal-profile-close").addEventListener("click", () => closeModal("modal-profile-overlay"));
  document.getElementById("modal-profile-cancel").addEventListener("click", () => closeModal("modal-profile-overlay"));
  document.getElementById("modal-profile-save").addEventListener("click", saveProfileModal);

  document.getElementById("modal-preferences-close").addEventListener("click", () => closeModal("modal-preferences-overlay"));
  document.getElementById("modal-preferences-cancel").addEventListener("click", () => closeModal("modal-preferences-overlay"));
  document.getElementById("modal-preferences-save").addEventListener("click", savePreferencesModal);

  document.querySelectorAll(".modal-overlay").forEach(overlay => {
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
    "Work": "var(--work-color)",
    "Play": "var(--play-color)",
    "Study": "var(--study-color)",
    "Exercise": "var(--exercise-color)",
    "Social": "var(--social-color)",
    "Self Care": "var(--care-color)"
  };

  let topActivityTitle = "-";
  let maxHours = -1;
  let totalHours = 0;
  let totalCognitiveLoad = 0;
  let goalsCompleted = 0;
  let totalGoalsCount = 0;

  activitiesData.forEach(activity => {
    const titlePt = TITLE_PT[activity.title] || activity.title;
    const color = colorHex[activity.title] || "var(--pale-blue)";
    const tf = activity.timeframes.weekly || { current: 0, previous: 0 };
    const goalH = activity.goals && activity.goals.weekly ? activity.goals.weekly : 0;

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

    periods.forEach(p => {
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
  agendaEvents.forEach(ev => {
    totalCognitiveLoad += ev.cognitive_load || 1;
  });

  // Atualizar KPIs superiores dos Relatórios
  document.getElementById("report-kpi-top-activity").textContent = topActivityTitle;
  document.getElementById("report-kpi-mental-load").textContent = `${totalCognitiveLoad} ⚡`;
  
  const goalsRatio = totalGoalsCount > 0 ? Math.round((goalsCompleted / totalGoalsCount) * 100) : 0;
  document.getElementById("report-kpi-goals-ratio").textContent = `${goalsRatio}%`;

  // 2. Gráfico Radial SVG dinâmico
  renderRadialChart(totalHours, colorHex);
}

function renderRadialChart(totalHours, colorHex) {
  const chartContainer = document.getElementById("reports-chart-radial");
  const legendContainer = document.getElementById("reports-chart-legend");
  clearElement(chartContainer);
  clearElement(legendContainer);

  if (totalHours === 0) {
    chartContainer.appendChild(createElement("span", {
      className: "chart-empty-state",
      text: "Sem dados para gerar gráfico"
    }));
    return;
  }

  // Desenhar SVG do Donut
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("viewBox", "0 0 42 42");

  let accumulatedPercent = 0;

  activitiesData.forEach(activity => {
    const titlePt = TITLE_PT[activity.title] || activity.title;
    const color = colorHex[activity.title] || "var(--pale-blue)";
    const tf = activity.timeframes.weekly || { current: 0, previous: 0 };
    
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
      createElement("strong", { className: "legend-strong", text: `${tf.current}h (${Math.round(percent)}%)` })
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
  const soundSelect = document.getElementById("settings-sound");
  const preferredSound = userProfile.focus_sound || "chuva";
  soundSelect.value = preferredSound === FEATURE_BINAURAL && !canUseBinauralSound()
    ? "nenhum"
    : preferredSound;
  applyBinauralCapabilityToControls();
}

async function saveSettingsFromTab() {
  const theme = document.getElementById("settings-theme").value;
  const enableConfetti = document.getElementById("settings-confetti").checked;
  const focusSound = document.getElementById("settings-sound").value;

  try {
    await saveProfilePreferences({
      theme,
      focus_sound: focusSound,
      enable_confetti: enableConfetti
    }, "Configurações salvas!");
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
    document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
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
  document.getElementById("modal-confirm-reset-btn").addEventListener("click", performResetDatabase);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
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
  } catch (error) {
    console.error("Falha ao buscar atividades:", error);
    showToast("Erro ao carregar atividades", "error");
  }
}

async function refreshData() {
  await fetchProfileData();
  await fetchActivities();
  await updateKPIs();
}

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
      normal:  [523.25, 659.25],
      grande:  [523.25, 659.25, 783.99],
      bau:     [587.33, 739.99, 880.00],
      jackpot: [523.25, 659.25, 783.99, 1046.5, 1318.5]
    };
    const notas = escalas[tier] || escalas.normal;
    notas.forEach((f, i) => {
      const o = audioCtx.createOscillator(); const g = audioCtx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(f, now + i * 0.08);
      g.gain.setValueAtTime(0.0001, now + i * 0.08);
      g.gain.exponentialRampToValueAtTime(0.2 / (i + 1), now + i * 0.08 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.08 + 0.6);
      o.connect(g); g.connect(master); o.start(now + i * 0.08); o.stop(now + i * 0.08 + 0.7);
    });
    master.gain.exponentialRampToValueAtTime(0.9, now + 0.03);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 1.0);
  } catch (e) {}
}

// Vibração háptica (multissensorial — só mobile com suporte)
function vibrarHaptico(tier) {
  if (!navigator.vibrate) return;
  const padroes = { normal: [30], grande: [40, 30, 40], bau: [50, 40, 80], jackpot: [80, 40, 80, 40, 120] };
  navigator.vibrate(padroes[tier] || [30]);
}

// GANCHO CENTRAL: toda conclusão passa por aqui
async function celebrarConclusao(context = {}) {
  let reward = null;
  try {
    const res = await apiFetch("/api/rewards/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(context)
    });
    if (res.ok) reward = await res.json();
  } catch (e) { /* segue com celebração básica */ }

  // Fallback: se o motor não respondeu, mantém a celebração básica
  if (!reward) { triggerConfetti(); return; }

  // 1) Confete (intensidade variável por tier)
  if (userProfile.enable_confetti) triggerConfetti();

  // 2) Multissensorial: som + háptico (se ligado)
  if (reward.multissensorial) { playRewardSound(reward.tier); vibrarHaptico(reward.tier); }
  else { playCompletionBell(); }

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
    setTimeout(() => showToast(`🍽️ Dopamenu: que tal "${reward.dopamenu.label}"?`, "success"), 1600);
  }

  // 7) Surpresa (timing imprevisível)
  if (reward.surpresa) setTimeout(() => showToast(`🎉 Surpresa! ${reward.surpresa}`, "success"), 2400);
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
  if (!overlay) { pedirAvaliacaoPresente(reward.event_id, reward); return; }
  document.getElementById("reward-title").textContent = reward.jackpot ? "🎰 JACKPOT!" : "🎁 Baú de Recompensa!";
  document.getElementById("reward-coins").textContent = `+${reward.coins} moedas`;
  document.getElementById("reward-collectible").textContent = reward.collectible ? `Você ganhou: ${reward.collectible}` : "";
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
  document.getElementById("rating-context").textContent = reward && reward.collectible ? reward.collectible : "sua recompensa";
  overlay._eventId = eventId;
  overlay.querySelectorAll(".rating-star").forEach(s => s.classList.remove("sel"));
  overlay.classList.add("open");
}

async function enviarAvaliacao(eventId, rating) {
  try {
    await apiFetch("/api/rewards/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_id: eventId, rating })
    });
    showToast("Obrigado pela avaliação! 🧡", "success");
  } catch (e) {}
}

function initRewardModals() {
  const rewardOverlay = document.getElementById("modal-reward-overlay");
  if (rewardOverlay) {
    const fechar = () => {
      const eid = rewardOverlay._eventId, rw = rewardOverlay._reward;
      rewardOverlay.classList.remove("open");
      if (eid) setTimeout(() => pedirAvaliacaoPresente(eid, rw), 300);
    };
    const btn = document.getElementById("reward-close");
    if (btn) btn.addEventListener("click", fechar);
    rewardOverlay.addEventListener("click", (e) => { if (e.target === rewardOverlay) fechar(); });
  }
  const ratingOverlay = document.getElementById("modal-rating-overlay");
  if (ratingOverlay) {
    ratingOverlay.querySelectorAll(".rating-star").forEach(star => {
      star.addEventListener("click", async () => {
        const val = parseInt(star.dataset.val);
        ratingOverlay.querySelectorAll(".rating-star").forEach(s => s.classList.toggle("sel", parseInt(s.dataset.val) <= val));
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
  recompensa_variavel: "Recompensa Variável + Jackpot", bau_loot: "Baú / Loot Colecionável",
  combo: "Combo / Momentum", micro_conclusoes: "Micro-conclusões", antecipacao: "Antecipação Visível",
  mensagens_rpe: "Mensagens \"melhor que o esperado\"", multissensorial: "Celebração Multissensorial",
  dopamenu: "Dopamenu (cardápio pessoal)", surpresa: "Recompensa em Momento Surpresa"
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
      row.appendChild(createElement("span", {
        className: "admin-toggle-label",
        text: DOPAMINE_LABELS[key] || g.label
      }));
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
          const r = await apiFetch("/api/rewards/config", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ key, enabled }) });
          if (!r.ok) throw new Error(apiErrorMessage(await responsePayload(r), "Não foi possível atualizar o gerador."));
          updateSwitchButton(btn, enabled);
          showToast(`${DOPAMINE_LABELS[key]}: ${enabled?'ativado':'desativado'}`, "success");
        } catch (e) { showToast(e.message, "error"); }
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
      flags.forEach(f => {
        const on = ai[f.key];
        const row = document.createElement("div");
        row.className = "admin-toggle-row";
        row.appendChild(createElement("span", {
          className: "admin-toggle-label",
          text: `🤖 ${f.label}`
        }));
        const btn = createSwitchButton({
          className: "dopa-toggle dopa-toggle-ai",
          on: Boolean(on),
          variant: "brand",
          title: f.label
        });
        btn.addEventListener("click", async () => {
          const value = btn.dataset.on !== "1";
          try {
            const r = await apiFetch("/api/rewards/ai", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ key: f.key, value }) });
            if (!r.ok) throw new Error(apiErrorMessage(await responsePayload(r), "Não foi possível atualizar a configuração de IA."));
            updateSwitchButton(btn, value);
            showToast(`${f.label}: ${value?'ativado':'desativado'}`, "success");
          } catch (e) { showToast(e.message, "error"); }
        });
        row.appendChild(btn); aiBox.appendChild(row);
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
    const money = (n) => (n||0).toLocaleString('pt-BR');
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
    const bottomGrid = createElement("div", { className: "admin-metric-grid admin-metric-grid-bottom" });

    const top10Card = createAdminCard("🏆 Top 10 Usuários (premiar)");
    if (d.top10.length) {
      const table = createElement("table", { className: "agenda-table" });
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["#", "Usuário", "Conclusões", "Moedas", "Streak"].forEach((label) => headRow.appendChild(createElement("th", { text: label })));
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
      top10Card.appendChild(createElement("span", { className: "admin-inline-help", text: "Ainda sem dados de uso." }));
    }

    const effectivenessCard = createAdminCard("🎯 Eficácia das 9 dopaminas");
    if (d.generators.length) {
      d.generators.forEach((item) => {
        const row = createElement("div", { className: "admin-metric-row" });
        row.append(
          createElement("span", { className: "admin-metric-row-title", text: DOPAMINE_LABELS[item.generator] || item.generator || "—" }),
          createElement("span", { className: "admin-inline-help", text: `${item.usos} usos · ⭐${(item.satisfacao_media || 0).toFixed(1)}` })
        );
        effectivenessCard.appendChild(row);
      });
    } else {
      effectivenessCard.appendChild(createElement("span", { className: "admin-inline-help", text: "Sem eventos ainda." }));
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
        createElement("div", { className: `admin-retention-value admin-retention-${tone}`, text: String(value) }),
        createElement("div", { className: "admin-inline-help", text: label })
      );
      retentionGrid.appendChild(item);
    });
    retentionCard.appendChild(retentionGrid);

    const stickCard = createAdminCard("🧲 Stickiness (DAU/MAU)");
    stickCard.append(
      createElement("div", { className: "grad-nums admin-stickiness-value", text: `${metrics.stickiness.indice}%` }),
      createElement("div", { className: "admin-inline-help", text: `DAU ${metrics.stickiness.dau} / MAU ${metrics.stickiness.mau}` })
    );

    const abCard = createAdminCard("🧪 A/B Testing (recompensas)");
    if (metrics.ab_testing.length) {
      metrics.ab_testing.forEach((test) => {
        const row = createElement("div", { className: "admin-metric-row" });
        row.append(
          createElement("span", { className: "admin-metric-row-title admin-text-capitalize", text: test.tier }),
          createElement("span", { className: "admin-inline-help", text: `${test.ocorrencias}x · ⭐${test.satisfacao}` })
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
      ["Usuário", "R(dias)", "F", "V(moedas)"].forEach((label) => headRow.appendChild(createElement("th", { text: label })));
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
        churnCard.appendChild(createElement("div", {
          className: "admin-inline-help admin-warning-text",
          text: `⚠️ ${user.name} — ${user.ultima_atividade ? `inativo desde ${String(user.ultima_atividade).slice(0,10)}` : "nunca ativo"}`
        }));
      });
    } else {
      churnCard.appendChild(createElement("span", {
        className: "admin-inline-help admin-success-text",
        text: "Nenhum usuário em risco 🎉"
      }));
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

async function renderPlansAdmin() {
  const head = document.getElementById("plans-matrix-head");
  const body = document.getElementById("plans-matrix-body");
  if (!head || !body) return;
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
        th.appendChild(createElement("span", {
          className: "admin-inline-help",
          text: `R$${(plan.price / 100).toFixed(0)}`
        }));
      }
      if (!["free", "plus", "pro"].includes(plan.key)) {
        const planLabel = PLAN_LABELS[plan.key] || plan.name;
        th.appendChild(createActionButton({
          className: "plan-del admin-inline-delete",
          title: `Excluir plano ${planLabel}`,
          ariaLabel: `Excluir plano ${planLabel}`,
          dataset: { plan: plan.key },
          text: "×"
        }));
      }
      headRow.appendChild(th);
    });
    head.appendChild(headRow);

    clearElement(body);
    features.forEach(f => {
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
        cell.appendChild(createSwitchButton({
          className: "feat-toggle admin-plan-toggle",
          on,
          knobOn: "14px",
          knobOff: "2px",
          dataset: { plan: plan.key, feat: f.key, planLabel, featureLabel },
          title: label,
          ariaLabel: label
        }));
        tr.appendChild(cell);
      });
      body.appendChild(tr);
    });

    body.querySelectorAll(".feat-toggle").forEach(btn => {
      btn.addEventListener("click", async () => {
        const enabled = btn.dataset.on === "1" ? false : true;
        try {
          const r = await apiFetch("/api/plans/toggle", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ plan_key: btn.dataset.plan, feature_key: btn.dataset.feat, enabled })
          });
          const d = await responsePayload(r);
          if (!r.ok) throw new Error(apiErrorMessage(d, "Não foi possível alterar a funcionalidade."));
          updateSwitchButton(btn, enabled);
          const label = planFeatureToggleLabel(btn.dataset.featureLabel, btn.dataset.planLabel, enabled);
          btn.title = label;
          btn.setAttribute("aria-label", label);
        } catch (e) { showToast(e.message, "error"); }
      });
    });

    head.querySelectorAll(".plan-del").forEach(b => b.addEventListener("click", async () => {
      const dialog = await showAppDialog({
        title: "Excluir plano",
        description: "Deseja excluir permanentemente este plano? A operação só será permitida se nenhum usuário estiver vinculado a ele.",
        confirmText: "Excluir plano",
        tone: "danger"
      });
      if (!dialog.confirmed) return;
      try { const r = await apiFetch(`/api/plans/${b.dataset.plan}`, { method: "DELETE" }); const d = await responsePayload(r);
        if (!r.ok) throw new Error(apiErrorMessage(d, "Não foi possível excluir o plano.")); showToast("Plano excluído.", "success"); renderPlansAdmin();
      } catch (e) { showToast(e.message, "error"); }
    }));
    body.querySelectorAll(".feat-del").forEach(b => b.addEventListener("click", async () => {
      const dialog = await showAppDialog({
        title: "Excluir funcionalidade",
        description: "Excluir esta funcionalidade de todos os planos?",
        confirmText: "Excluir funcionalidade",
        tone: "danger"
      });
      if (!dialog.confirmed) return;
      try { const r = await apiFetch(`/api/features/${b.dataset.feat}`, { method: "DELETE" }); const d = await responsePayload(r);
        if (!r.ok) throw new Error(apiErrorMessage(d, "Não foi possível excluir a funcionalidade.")); showToast("Funcionalidade excluída.", "success"); renderPlansAdmin();
      } catch (e) { showToast(e.message, "error"); }
    }));
  } catch (e) {
    body.replaceChildren(createLoadingTableRow(e.message, "error", 8));
  }
}

function initPlansAdmin() {
  const btnPlan = document.getElementById("btn-add-plan");
  const btnFeat = document.getElementById("btn-add-feature");
  if (btnPlan) btnPlan.addEventListener("click", async () => {
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
          validate: (value) => /^[a-z0-9_]+$/.test(value) ? "" : "Use apenas letras minúsculas, números e underline na chave."
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
          validate: (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0
            ? ""
            : "Informe um preço inteiro em centavos, igual ou maior que zero."
        }
      ]
    });
    if (!dialog.confirmed) return;
    const { name, key, price } = dialog.values;
    try { const r = await apiFetch("/api/plans", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ key, name, price }) });
      const d = await responsePayload(r); if (!r.ok) throw new Error(apiErrorMessage(d, "Não foi possível criar o plano.")); showToast("Plano criado.", "success"); renderPlansAdmin();
    } catch (e) { showToast(e.message, "error"); }
  });
  if (btnFeat) btnFeat.addEventListener("click", async () => {
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
          validate: (value) => /^[a-z0-9_]+$/.test(value) ? "" : "Use apenas letras minúsculas, números e underline na chave."
        }
      ]
    });
    if (!dialog.confirmed) return;
    const { label, key } = dialog.values;
    try { const r = await apiFetch("/api/features", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify({ key, label }) });
      const d = await responsePayload(r); if (!r.ok) throw new Error(apiErrorMessage(d, "Não foi possível criar a funcionalidade.")); showToast("Funcionalidade criada.", "success"); renderPlansAdmin();
    } catch (e) { showToast(e.message, "error"); }
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

  // Exibe o perfil atual no dropdown
  const roleBadge = document.getElementById("profile-role-badge");
  if (roleBadge) {
    const roleName = currentUser.role === ROLE_ADMIN ? "Administrador" : "Usuário";
    const planName = currentUser.plan ? currentUser.plan.charAt(0).toUpperCase() + currentUser.plan.slice(1) : "";
    roleBadge.textContent = planName ? `${roleName} · ${planName}` : roleName;
  }
}

// Bloqueia a navegação para seções restritas conforme o perfil
function canAccessSection(section) {
  const isAdmin = currentUser && currentUser.role === ROLE_ADMIN;
  if ((section === "settings" || section === "users" || section === "plans" || section === "dopamine") && !isAdmin) return false;
  return true;
}

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
    if (!usersResponse.ok) throw new Error(apiErrorMessage(usersPayload, "Sem permissão para gerenciar usuários."));
    if (!plansResponse.ok) throw new Error(apiErrorMessage(plansPayload, "Não foi possível carregar os planos."));

    const users = Array.isArray(usersPayload) ? usersPayload : [];
    const plans = Array.isArray(plansPayload?.plans) ? plansPayload.plans : [];
    const roleOptions = [
      { value: "administrador", label: "Administrador" },
      { value: "usuario", label: "Usuário" }
    ];
    const planOptions = plans.map(plan => ({ value: plan.key, label: plan.name }));
    tbody.replaceChildren();

    users.forEach(u => {
      const tr = document.createElement("tr");
      const nameCell = document.createElement("td");
      nameCell.textContent = u.name;
      const emailCell = document.createElement("td");
      emailCell.textContent = u.email;
      const roleCell = document.createElement("td");
      roleCell.appendChild(createUserSelect(
        u.id,
        "user-role-select",
        roleOptions,
        u.role,
        `Perfil de acesso de ${u.name}`
      ));
      const planCell = document.createElement("td");
      planCell.appendChild(createUserSelect(
        u.id,
        "user-plan-select",
        planOptions,
        u.plan,
        `Plano comercial de ${u.name}`
      ));
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

    tbody.querySelectorAll(".user-role-select, .user-plan-select").forEach(sel => {
      sel.addEventListener("change", async () => {
        try {
          const field = sel.classList.contains("user-role-select") ? "role" : "plan";
          const r = await apiFetch(`/api/users/${sel.dataset.uid}`, {
            method: "PUT", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: sel.value })
          });
          const payload = await responsePayload(r);
          if (!r.ok) throw new Error(apiErrorMessage(payload, "Não foi possível atualizar o usuário."));
          showToast(field === "role" ? "Perfil atualizado." : "Plano atualizado.", "success");
          renderUsersAdmin();
        } catch (e) { showToast(e.message, "error"); renderUsersAdmin(); }
      });
    });

    // Excluir usuário
    tbody.querySelectorAll(".user-delete").forEach(btn => {
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
          if (!r.ok) throw new Error(apiErrorMessage(payload, "Não foi possível excluir o usuário."));
          showToast("Usuário excluído.", "success");
          renderUsersAdmin();
        } catch (e) { showToast(e.message, "error"); }
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
          throw new Error(apiErrorMessage(plansPayload, "Não foi possível carregar os planos disponíveis."));
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
            validate: (value) => /\S+@\S+\.\S+/.test(value) ? "" : "Informe um e-mail válido."
          },
          {
            name: "password",
            label: "Senha forte",
            required: true,
            type: "password",
            autocomplete: "new-password",
            minlength: 12,
            maxlength: 128,
            pattern: "(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,128}",
            validate: (value) => /^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9]).{12,128}$/.test(value)
              ? ""
              : "Use 12 a 128 caracteres com maiúscula, minúscula, número e símbolo."
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
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, password, role, plan })
        });
        const payload = await responsePayload(r);
        if (!r.ok) throw new Error(apiErrorMessage(payload, "Não foi possível criar o usuário."));
        showToast("Usuário criado.", "success");
        renderUsersAdmin();
      } catch (e) { showToast(e.message, "error"); }
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
      hint.textContent = "A biblioteca googleapis ainda não foi instalada. Rode \"npm install\" e reinicie o servidor.";
      setInlineActionVisibility(btnConnect, false);
      setInlineActionVisibility(btnSync, false);
      setInlineActionVisibility(btnDisc, false);
      return;
    }
    const data = await res.json();

    if (!data.configured) {
      setGoogleStatusState(dot, "warning");
      title.textContent = "Não configurada";
      desc.textContent = "Faltam credenciais no .env";
      hint.textContent = "Preencha GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI no arquivo .env (veja o .env.example) e reinicie o servidor.";
      setInlineActionVisibility(btnConnect, false);
      setInlineActionVisibility(btnSync, false);
      setInlineActionVisibility(btnDisc, false);
      return;
    }

    if (data.connected) {
      setGoogleStatusState(dot, "success");
      title.textContent = "Conectada";
      desc.textContent = data.email ? data.email : "Conta Google vinculada";
      hint.textContent = "Sincronização bidirecional ativa. Clique em \"Sincronizar agora\" para atualizar os compromissos nos dois sentidos.";
      setInlineActionVisibility(btnConnect, false);
      setInlineActionVisibility(btnSync, true);
      setInlineActionVisibility(btnDisc, true);
    } else {
      setGoogleStatusState(dot, "neutral");
      title.textContent = "Desconectada";
      desc.textContent = "Pronta para conectar";
      hint.textContent = "Conecte sua Google Agenda para sincronizar compromissos nos dois sentidos (criar, editar e excluir).";
      setInlineActionVisibility(btnConnect, true);
      setInlineActionVisibility(btnSync, false);
      setInlineActionVisibility(btnDisc, false);
    }
  } catch (e) {
    setGoogleStatusState(dot, "danger");
    title.textContent = "Indisponível";
    desc.textContent = "Erro ao consultar status";
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
    showToast(`Sincronizado! Enviados: ${s.pushed || 0} · Importados: ${s.pulled || 0} · Atualizados: ${s.updated || 0}`, "success");
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
  const btnConnect = document.getElementById("btn-google-connect");
  const btnSync = document.getElementById("btn-google-sync");
  const btnDisc = document.getElementById("btn-google-disconnect");
  if (btnConnect) btnConnect.addEventListener("click", connectGoogle);
  if (btnSync) btnSync.addEventListener("click", syncGoogle);
  if (btnDisc) btnDisc.addEventListener("click", disconnectGoogle);

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
  applyRolePermissions();

  // Logout real (encerra sessão e volta ao login)
  const logoutBtn = document.getElementById("dropdown-logout-btn");
  if (logoutBtn) {
    const novo = logoutBtn.cloneNode(true); // remove listeners anteriores (tela de bloqueio)
    logoutBtn.parentNode.replaceChild(novo, logoutBtn);
    novo.addEventListener("click", doLogout);
  }
  document.getElementById("inline-agenda-close").addEventListener("click", closeInlineAgendaPanel);
  document.getElementById("focus-mode-close").addEventListener("click", closeFocusMode);
  document.getElementById("btn-add-agenda-event").addEventListener("click", () => openAgendaModal());
  document.getElementById("btn-inline-add-event").addEventListener("click", () => openAgendaModal());
  document.getElementById("settings-theme").addEventListener("change", saveSettingsFromTab);
  document.getElementById("settings-confetti").addEventListener("change", saveSettingsFromTab);
  document.getElementById("settings-sound").addEventListener("change", saveSettingsFromTab);
  document.getElementById("settings-db-reset").addEventListener("click", resetDatabase);
  document.getElementById("btn-focus-play-pause").addEventListener("click", toggleFocusTimer);
  document.getElementById("btn-focus-reset").addEventListener("click", resetFocusTimer);
  document.getElementById("btn-focus-complete").addEventListener("click", completeFocusTask);
  document.getElementById("focus-sound-select").addEventListener("change", function(e) {
    if (e.target.value === FEATURE_BINAURAL && !canUseBinauralSound()) {
      e.target.value = "nenhum";
      userProfile.focus_sound = "nenhum";
      stopFocusSound();
      showToast("Seu plano atual não inclui ondas binaurais.", "warning");
      return;
    }
    userProfile.focus_sound = e.target.value;
    if (pomodoroIsRunning) { startFocusSound(e.target.value); }
  });
  document.querySelectorAll("#focus-cycle-selector .layout-btn").forEach(btn => {
    btn.addEventListener("click", () => setPomodoroCycle(parseInt(btn.dataset.cycle)));
  });
  await refreshData();
});

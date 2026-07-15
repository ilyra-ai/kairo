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
let activeTimeframe = "daily";
let activeSection = "dashboard";

// ============================================================
// UTILIDADES
// ============================================================

function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const icons = { success: "✓", error: "✕", warning: "!" };
  toast.innerHTML = `
    <div class="toast-icon">${icons[type] || "i"}</div>
    <span class="toast-message">${message}</span>
  `;

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

// ============================================================
// SIDEBAR — NAVEGAÇÃO
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
  activeSection = section;
  document.getElementById("section-dashboard").classList.toggle("hidden", section !== "dashboard");
  document.getElementById("section-reports").classList.toggle("hidden", section !== "reports");
  document.getElementById("section-settings").classList.toggle("hidden", section !== "settings");

  if (section === "reports") {
    renderReports();
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
    card.style.display = match ? "" : "none";
  });
}

// ============================================================
// SIDEBAR — PERFIL
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
}

// ============================================================
// SIDEBAR — KPIs E RELÓGIO
// ============================================================

async function updateKPIs() {
  try {
    const response = await fetch("/api/dashboard/kpis");
    if (!response.ok) return;
    const kpis = await response.json();

    document.getElementById("kpi-daily-total").textContent = `${kpis.dailyTotal}hrs`;
    document.getElementById("kpi-weekly-percent").textContent = `${kpis.weeklyGoalPercent}%`;
    document.getElementById("kpi-weekly-bar").style.width = `${kpis.weeklyGoalPercent}%`;
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
// CARDS — RENDERIZAÇÃO DINÂMICA
// ============================================================

function renderCards() {
  const gridSection = document.getElementById("grid-section");
  gridSection.innerHTML = "";

  activitiesData.forEach(activity => {
    const color = CARD_COLORS[activity.title] || "orange";
    const titlePt = TITLE_PT[activity.title] || activity.title;
    const config = TIMEFRAMES_CONFIG[activeTimeframe];
    const tf = activity.timeframes[activeTimeframe] || { current: 0, previous: 0 };
    const goalHours = activity.goals && activity.goals[activeTimeframe] ? activity.goals[activeTimeframe] : 0;

    const card = document.createElement("div");
    card.className = `card ${color}`;
    card.dataset.title = activity.title;
    card.dataset.id = activity.id;

    // Calcular progresso da meta
    let progressPercent = 0;
    let progressClass = "";
    if (goalHours > 0) {
      progressPercent = Math.min(Math.round((tf.current / goalHours) * 100), 100);
      if (tf.current > goalHours) progressClass = "exceeded";
    }

    card.innerHTML = `
      <div class="inner-card">
        <div class="top-section">
          <p>${titlePt}</p>
          <div style="position:relative;">
            <button class="ellipsis-btn" aria-label="Opções de ${titlePt}" data-id="${activity.id}" data-title="${activity.title}">
              <img src="./images/icon-ellipsis.svg" alt="opções">
            </button>
            <div class="card-dropdown" id="dropdown-${activity.id}">
              <button class="dropdown-item" data-action="edit" data-id="${activity.id}" data-title="${activity.title}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                Editar Horas
              </button>
              <button class="dropdown-item" data-action="goal" data-id="${activity.id}" data-title="${activity.title}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                Definir Meta
              </button>
              <button class="dropdown-item" data-action="details" data-id="${activity.id}" data-title="${activity.title}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                Ver Detalhes
              </button>
              <div class="dropdown-divider"></div>
              <button class="dropdown-item danger" data-action="delete" data-id="${activity.id}" data-title="${activity.title}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                Excluir
              </button>
            </div>
          </div>
        </div>
        <div class="time-duration">
          <h1>${tf.current}hrs</h1>
          <small>${config.label} - ${tf.previous}hrs</small>
        </div>
        <div class="goal-progress ${goalHours > 0 ? "visible" : ""}" id="progress-${activity.id}">
          <div class="goal-progress-label">
            <span>Meta: ${goalHours}hrs</span>
            <span>${progressPercent}%</span>
          </div>
          <div class="goal-progress-track">
            <div class="goal-progress-fill ${progressClass}" style="width: ${progressPercent}%"></div>
          </div>
        </div>
      </div>
    `;

    gridSection.appendChild(card);
  });

  // Vincular eventos dos dropdowns e ações
  initCardDropdowns();
}

// ============================================================
// CARDS — DROPDOWNS CONTEXTUAIS (3 pontos)
// ============================================================

function initCardDropdowns() {
  // Botões de reticências
  document.querySelectorAll(".ellipsis-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      closeAllDropdowns();
      const dropdown = document.getElementById(`dropdown-${id}`);
      dropdown.classList.toggle("open");
    });
  });

  // Ações do dropdown
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

// Fechar dropdowns ao clicar em qualquer lugar
document.addEventListener("click", () => closeAllDropdowns());

// Fechar dropdowns com Escape
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeAllDropdowns();
    closeAllModals();
  }
});

// ============================================================
// TIMEFRAME — CONTROLE DE PERÍODO
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
// MODAIS — EDIÇÃO DE HORAS
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

  const current = parseInt(document.getElementById("edit-current").value) || 0;
  const previous = parseInt(document.getElementById("edit-previous").value) || 0;

  try {
    const response = await fetch(`/api/activities/${currentEditId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeframe: activeTimeframe, current, previous })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error);
    }

    showToast("Horas atualizadas com sucesso!", "success");
    closeModal("modal-edit-overlay");
    await refreshData();
  } catch (error) {
    showToast(`Erro ao salvar: ${error.message}`, "error");
  }
}

// ============================================================
// MODAIS — DEFINIÇÃO DE META
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

  const targetHours = parseInt(document.getElementById("goal-target").value) || 0;

  try {
    const response = await fetch(`/api/activities/${currentGoalId}/goals`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timeframe: activeTimeframe, target_hours: targetHours })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error);
    }

    showToast("Meta definida com sucesso!", "success");
    closeModal("modal-goal-overlay");
    await refreshData();
  } catch (error) {
    showToast(`Erro ao definir meta: ${error.message}`, "error");
  }
}

// ============================================================
// MODAIS — VER DETALHES
// ============================================================

async function openDetailsModal(id, title) {
  const titlePt = TITLE_PT[title] || title;
  document.getElementById("modal-details-title").textContent = `Detalhes — ${titlePt}`;

  try {
    const response = await fetch(`/api/activities/${id}/details`);
    if (!response.ok) throw new Error("Erro ao buscar detalhes");
    const data = await response.json();

    const detailsGrid = document.getElementById("details-grid");
    detailsGrid.innerHTML = "";

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
      card.innerHTML = `
        <div class="details-card-label">${p.label}</div>
        <div class="details-card-value">${tf.current}hrs</div>
        <div class="details-card-prev">${p.prevLabel}: ${tf.previous}hrs</div>
        ${goalH > 0 ? `<div class="details-card-prev">Meta: ${goalH}hrs</div>` : ""}
      `;
      detailsGrid.appendChild(card);
    });

    openModal("modal-details-overlay");
  } catch (error) {
    showToast("Erro ao carregar detalhes", "error");
  }
}

// ============================================================
// MODAIS — EXCLUSÃO
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
    const response = await fetch(`/api/activities/${currentDeleteId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error);
    }

    showToast("Atividade excluída com sucesso!", "success");
    closeModal("modal-delete-overlay");
    await refreshData();
  } catch (error) {
    showToast(`Erro ao excluir: ${error.message}`, "error");
  }
}

// ============================================================
// MODAIS — UTILITÁRIOS
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

function initModals() {
  // Modal Editar
  document.getElementById("modal-edit-close").addEventListener("click", () => closeModal("modal-edit-overlay"));
  document.getElementById("modal-edit-cancel").addEventListener("click", () => closeModal("modal-edit-overlay"));
  document.getElementById("modal-edit-save").addEventListener("click", saveEditModal);

  // Modal Meta
  document.getElementById("modal-goal-close").addEventListener("click", () => closeModal("modal-goal-overlay"));
  document.getElementById("modal-goal-cancel").addEventListener("click", () => closeModal("modal-goal-overlay"));
  document.getElementById("modal-goal-save").addEventListener("click", saveGoalModal);

  // Modal Excluir
  document.getElementById("modal-delete-close").addEventListener("click", () => closeModal("modal-delete-overlay"));
  document.getElementById("modal-delete-cancel").addEventListener("click", () => closeModal("modal-delete-overlay"));
  document.getElementById("modal-delete-confirm").addEventListener("click", confirmDelete);

  // Modal Detalhes
  document.getElementById("modal-details-close").addEventListener("click", () => closeModal("modal-details-overlay"));

  // Fechar modais ao clicar no overlay
  document.querySelectorAll(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.classList.remove("open");
    });
  });
}

// ============================================================
// RELATÓRIOS
// ============================================================

function renderReports() {
  const grid = document.getElementById("reports-grid");
  grid.innerHTML = "";

  const colorDots = {
    "Work": "var(--work-color)",
    "Play": "var(--play-color)",
    "Study": "var(--study-color)",
    "Exercise": "var(--exercise-color)",
    "Social": "var(--social-color)",
    "Self Care": "var(--care-color)"
  };

  activitiesData.forEach(activity => {
    const titlePt = TITLE_PT[activity.title] || activity.title;
    const dotColor = colorDots[activity.title] || "var(--pale-blue)";

    const card = document.createElement("div");
    card.className = "report-card";

    let rowsHtml = "";
    const periods = [
      { key: "daily", label: "Diário" },
      { key: "weekly", label: "Semanal" },
      { key: "monthly", label: "Mensal" }
    ];

    periods.forEach(p => {
      const tf = activity.timeframes[p.key] || { current: 0, previous: 0 };
      const goalH = activity.goals && activity.goals[p.key] ? activity.goals[p.key] : null;
      rowsHtml += `
        <div class="report-row">
          <span class="report-row-label">${p.label}</span>
          <span class="report-row-value">${tf.current}hrs / ${tf.previous}hrs${goalH ? ` (Meta: ${goalH}hrs)` : ""}</span>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="report-card-title">
        <span class="color-dot" style="background: ${dotColor}"></span>
        ${titlePt}
      </div>
      ${rowsHtml}
    `;

    grid.appendChild(card);
  });
}

// ============================================================
// DADOS — FETCH E REFRESH
// ============================================================

async function fetchActivities() {
  try {
    const response = await fetch("/api/activities");
    if (!response.ok) throw new Error(`Erro: ${response.statusText}`);
    activitiesData = await response.json();
    renderCards();
  } catch (error) {
    console.error("Falha ao buscar atividades:", error);
    showToast("Erro ao carregar atividades", "error");
  }
}

async function refreshData() {
  await fetchActivities();
  await updateKPIs();
}

// ============================================================
// INICIALIZAÇÃO
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  initSidebar();
  initSearch();
  initProfile();
  initClock();
  initTimeframeControls();
  initModals();

  await refreshData();
});
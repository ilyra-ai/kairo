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
let activeAgendaLayout = "atual"; // atual, google, ticktick, morgen, todoist, kanban

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
  activeSection = section;
  document.getElementById("section-dashboard").classList.toggle("hidden", section !== "dashboard");
  document.getElementById("section-agenda").classList.toggle("hidden", section !== "agenda");
  document.getElementById("section-reports").classList.toggle("hidden", section !== "reports");
  document.getElementById("section-settings").classList.toggle("hidden", section !== "settings");

  if (section === "agenda") {
    fetchAndRenderAgenda();
  } else if (section === "reports") {
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
// CARDS — RENDERIZAÇÃO E CLIQUE EXPANSÍVEL (DASHBOARD)
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
  dot.style.background = colorHex[title] || "var(--single-section)";

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
  tableBody.innerHTML = "";

  try {
    const response = await fetch(`/api/activities/${activityId}/agenda`);
    if (!response.ok) throw new Error("Falha ao buscar agenda");
    const events = await response.json();

    if (events.length === 0) {
      emptyState.classList.remove("hidden");
      document.querySelector(".agenda-table").style.display = "none";
    } else {
      emptyState.classList.add("hidden");
      document.querySelector(".agenda-table").style.display = "";

      events.forEach(ev => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${formatDatePtBr(ev.event_date)}</td>
          <td><strong>${ev.title}</strong></td>
          <td>${ev.description || "-"}</td>
          <td><span class="event-duration-badge">${ev.start_time} - ${ev.end_time} (${ev.duration_hours}h)</span></td>
          <td>
            <div class="table-actions">
              <button class="btn-icon btn-edit" data-id="${ev.id}" aria-label="Editar evento">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn-icon btn-delete" data-id="${ev.id}" aria-label="Excluir evento">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
              </button>
            </div>
          </td>
        `;
        tableBody.appendChild(tr);
      });

      // Eventos das ações da tabela
      tableBody.querySelectorAll(".btn-edit").forEach(btn => {
        btn.addEventListener("click", () => openAgendaModal(parseInt(btn.dataset.id)));
      });

      tableBody.querySelectorAll(".btn-delete").forEach(btn => {
        btn.addEventListener("click", () => deleteAgendaEvent(parseInt(btn.dataset.id)));
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
    const response = await fetch("/api/agenda");
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
  container.innerHTML = "";

  switch (activeAgendaLayout) {
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

// ============================================================
// LAYOUT 1: TIMELINE VERTICAL (ATUAL)
// ============================================================

function renderLayoutAtual(container) {
  if (agendaEvents.length === 0) {
    container.innerHTML = `<div class="agenda-empty-state"><p>Nenhum compromisso agendado.</p></div>`;
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

      const card = document.createElement("div");
      card.className = `timeline-event-card ${evClass} ${ev.is_completed ? "completed" : ""}`;
      card.innerHTML = `
        <div class="event-time-info">
          <span class="event-duration-badge">${ev.start_time} - ${ev.end_time}</span>
        </div>
        <div class="event-details" style="${ev.is_completed ? "text-decoration: line-through; opacity: 0.5;" : ""}">
          <div class="event-title">${ev.title}</div>
          <div class="event-desc">${titlePt} ${ev.description ? `• ${ev.description}` : ""}</div>
        </div>
        <div style="display:flex; gap:0.25rem; position:relative; z-index:5;">
          <button class="btn-icon btn-edit" data-id="${ev.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="btn-icon btn-delete" data-id="${ev.id}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
          </button>
        </div>
      `;

      card.querySelector(".btn-edit").addEventListener("click", (e) => {
        e.stopPropagation();
        openAgendaModal(ev.id);
      });
      card.querySelector(".btn-delete").addEventListener("click", (e) => {
        e.stopPropagation();
        deleteAgendaEvent(ev.id);
      });
      card.addEventListener("click", () => openAgendaModal(ev.id));

      containerEvents.appendChild(card);
    });

    groupDiv.appendChild(containerEvents);
    container.appendChild(groupDiv);
  });
}

// ============================================================
// LAYOUT 2: GOOGLE AGENDA (Grade Semanal)
// ============================================================

function renderLayoutGoogle(container) {
  container.classList.remove("agenda-timeline");
  
  const weekDays = getWeekDays();
  const dayNamesShort = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const grid = document.createElement("div");
  grid.className = "google-calendar-grid";

  grid.innerHTML += `<div class="google-time-header">Horário</div>`;
  weekDays.forEach(dayStr => {
    const d = new Date(dayStr + "T00:00:00");
    const dayLabel = `${dayNamesShort[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
    grid.innerHTML += `<div class="google-day-header">${dayLabel}</div>`;
  });

  const timeSlots = ["07:00", "09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00"];

  timeSlots.forEach(time => {
    grid.innerHTML += `<div class="google-time-cell">${time}</div>`;

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
        block.style.opacity = ev.is_completed ? "0.5" : "1";
        block.style.textDecoration = ev.is_completed ? "line-through" : "none";

        block.innerHTML = `
          <strong>${ev.start_time}</strong> ${ev.title}
        `;
        block.addEventListener("click", (e) => {
          e.stopPropagation();
          openAgendaModal(ev.id);
        });
        cell.appendChild(block);
      });

      grid.appendChild(cell);
    });
  });

  container.appendChild(grid);
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
    col.innerHTML = `
      <div class="ticktick-column-title">
        ${daysShort[d.getDay()]} — ${d.getDate()}/${d.getMonth()+1}
      </div>
    `;

    const dayEvents = agendaEvents.filter(ev => ev.event_date === dayStr);

    if (dayEvents.length === 0) {
      col.innerHTML += `<div class="agenda-empty-state" style="padding:1rem 0; font-size:0.75rem;"><p>Sem compromissos</p></div>`;
    } else {
      const listContainer = document.createElement("div");
      listContainer.className = "timeline-events-container";

      dayEvents.forEach(ev => {
        const card = document.createElement("div");
        card.className = `ticktick-task-card ${ev.is_completed ? "completed" : ""}`;
        card.innerHTML = `
          <div class="ticktick-checkbox-container">
            <span class="ticktick-checkbox" id="check-${ev.id}"></span>
          </div>
          <div class="ticktick-task-content">
            <div class="ticktick-task-title">${ev.title}</div>
            <div class="ticktick-task-time">${ev.start_time} - ${ev.end_time}</div>
          </div>
        `;

        // Checkbox interativo TickTick
        const checkbox = card.querySelector(`.ticktick-checkbox`);
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
}

// ============================================================
// LAYOUT 4: MORGEN (Time-Blocking Diário)
// ============================================================

function renderLayoutMorgen(container) {
  container.classList.remove("agenda-timeline");

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const header = document.createElement("div");
  header.style.textAlign = "center";
  header.style.marginBottom = "1rem";
  header.innerHTML = `<h4 style="font-weight:400; font-size:0.95rem; color:var(--pale-blue);">Time-Blocking de Hoje (${formatDatePtBr(todayStr)})</h4>`;
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
    line.style.top = `${i * 60}px`;
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
    const heightPx = Math.max(30, endMinutes - startMinutes);

    const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
    const slot = document.createElement("div");
    slot.className = `morgen-event-slot ${evClass}`;
    slot.style.top = `${topPx}px`;
    slot.style.height = `${heightPx}px`;
    slot.style.opacity = ev.is_completed ? "0.5" : "1";
    slot.style.textDecoration = ev.is_completed ? "line-through" : "none";

    slot.innerHTML = `
      <div class="morgen-event-title">${ev.title}</div>
      <div class="morgen-event-time">${ev.start_time} - ${ev.end_time}</div>
    `;

    slot.addEventListener("click", () => openAgendaModal(ev.id));
    eventsCol.appendChild(slot);
  });

  const currentHour = today.getHours();
  const currentMinute = today.getMinutes();
  if (currentHour >= 7 && currentHour <= 22) {
    const currentPos = (currentHour - 7) * 60 + currentMinute;
    const indicator = document.createElement("div");
    indicator.className = "morgen-time-indicator";
    indicator.style.top = `${currentPos}px`;
    eventsCol.appendChild(indicator);
  }

  timeblocking.appendChild(eventsCol);
  container.appendChild(timeblocking);
}

// ============================================================
// LAYOUT 5: TODOIST (Lista por Categoria)
// ============================================================

function renderLayoutTodoist(container) {
  container.classList.remove("agenda-timeline");

  if (agendaEvents.length === 0) {
    container.innerHTML = `<div class="agenda-empty-state"><p>Sua lista de tarefas está limpa.</p></div>`;
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

    groupCard.innerHTML = `
      <div class="todoist-project-header">
        <span class="color-dot" style="background: ${color}"></span>
        ${titlePt}
      </div>
    `;

    const list = document.createElement("div");
    list.style.display = "flex";
    list.style.flexDirection = "column";

    events.forEach(ev => {
      const task = document.createElement("div");
      task.className = `todoist-task-item ${ev.is_completed ? "completed" : ""}`;
      task.style.opacity = ev.is_completed ? "0.5" : "1";
      task.style.textDecoration = ev.is_completed ? "line-through" : "none";

      task.innerHTML = `
        <div>
          <div class="todoist-task-name">${ev.title}</div>
          <div class="todoist-task-desc">${ev.description || "Sem descrição"}</div>
        </div>
        <div class="todoist-task-meta">
          <div class="todoist-task-date">${formatDatePtBr(ev.event_date)}</div>
          <span class="todoist-task-time-badge">${ev.start_time} - ${ev.end_time}</span>
        </div>
      `;

      task.addEventListener("click", () => openAgendaModal(ev.id));
      list.appendChild(task);
    });

    groupCard.appendChild(list);
    todoistList.appendChild(groupCard);
  });

  container.appendChild(todoistList);
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
    colDiv.innerHTML = `
      <div class="kanban-column-title">
        <span>${col.title}</span>
        <span class="kanban-count-badge">${col.events.length}</span>
      </div>
    `;

    const eventsList = document.createElement("div");
    eventsList.className = "timeline-events-container";

    if (col.events.length === 0) {
      eventsList.innerHTML = `<div class="agenda-empty-state" style="padding: 2rem 0; font-size:0.78rem;"><p>Nenhum compromisso nesta coluna</p></div>`;
    } else {
      col.events.forEach(ev => {
        const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
        const titlePt = TITLE_PT[ev.activity_title] || ev.activity_title;

        const card = document.createElement("div");
        card.className = `kanban-event-card ${evClass} ${ev.is_completed ? "completed" : ""}`;
        card.innerHTML = `
          <div class="kanban-event-header">
            <span class="kanban-event-time">${ev.start_time} - ${ev.end_time}</span>
            <div class="ticktick-checkbox-container" style="margin-left:auto; z-index:10;">
              <span class="ticktick-checkbox" id="kanban-check-${ev.id}"></span>
            </div>
          </div>
          <div class="kanban-event-title" style="${ev.is_completed ? "text-decoration: line-through; opacity:0.6;" : ""}">${ev.title}</div>
          <div class="kanban-event-desc" style="${ev.is_completed ? "opacity:0.4;" : ""}">${ev.description || "Sem descrição"}</div>
          <div class="kanban-card-footer">
            <span class="kanban-category-badge" style="color: var(--${evClass}-color)">${titlePt}</span>
            <span class="event-duration-badge" style="background: rgba(255,255,255,0.05); margin-top:0;">${formatDatePtBr(ev.event_date)} (${ev.duration_hours}h)</span>
          </div>
        `;

        // Checkbox de conclusão rápida dentro do card Kanban
        card.querySelector(".ticktick-checkbox").addEventListener("click", async (e) => {
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
}

// ============================================================
// CONEXAO PERSISTENTE: ALTERAR CONCLUSAO DE COMPROMISSO
// ============================================================

async function toggleEventCompletion(eventId, currentState) {
  const newState = !currentState;
  try {
    const response = await fetch(`/api/agenda/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_completed: newState })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error);
    }

    showToast(newState ? "Compromisso marcado como concluído!" : "Compromisso reaberto!", "success");
    
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

  if (eventId) {
    fetchEventDetailsAndOpenModal(eventId);
  } else {
    document.getElementById("modal-agenda-title").textContent = "Novo Compromisso";
    document.getElementById("agenda-title").value = "";
    document.getElementById("agenda-desc").value = "";
    document.getElementById("agenda-date").value = new Date().toISOString().split('T')[0];
    document.getElementById("agenda-start").value = "09:00";
    document.getElementById("agenda-end").value = "10:00";

    populateCategorySelect("agenda-activity", activeInlineActivityId);
    modal.classList.add("open");
  }
}

async function fetchEventDetailsAndOpenModal(eventId) {
  try {
    const response = await fetch("/api/agenda");
    const events = await response.json();
    const ev = events.find(e => e.id === eventId);
    if (!ev) return;

    document.getElementById("modal-agenda-title").textContent = "Editar Compromisso";
    populateCategorySelect("agenda-activity", ev.activity_id);
    document.getElementById("agenda-title").value = ev.title;
    document.getElementById("agenda-desc").value = ev.description;
    document.getElementById("agenda-date").value = ev.event_date;
    document.getElementById("agenda-start").value = ev.start_time;
    document.getElementById("agenda-end").value = ev.end_time;

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

  const payload = { activity_id, title, description, event_date, start_time, end_time };
  const method = currentAgendaEventId ? "PUT" : "POST";
  const url = currentAgendaEventId ? `/api/agenda/${currentAgendaEventId}` : "/api/agenda";

  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error);
    }

    showToast(currentAgendaEventId ? "Compromisso atualizado!" : "Compromisso agendado com sucesso!", "success");
    document.getElementById("modal-agenda-overlay").classList.remove("open");

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

async function deleteAgendaEvent(eventId) {
  if (!confirm("Deseja realmente remover este compromisso da agenda?")) return;

  try {
    const response = await fetch(`/api/agenda/${eventId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error);
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

function initAgendaModals() {
  document.getElementById("modal-agenda-close").addEventListener("click", () => {
    document.getElementById("modal-agenda-overlay").classList.remove("open");
  });
  document.getElementById("modal-agenda-cancel").addEventListener("click", () => {
    document.getElementById("modal-agenda-overlay").classList.remove("open");
  });
  document.getElementById("modal-agenda-save").addEventListener("click", saveAgendaModal);
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
// MODAIS CARD — VER DETALHES
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
    const response = await fetch(`/api/activities/${currentDeleteId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error);
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
  document.getElementById("modal-edit-cancel").addEventListener("click", () => closeModal("modal-edit-overlay"));
  document.getElementById("modal-edit-save").addEventListener("click", saveEditModal);

  document.getElementById("modal-goal-close").addEventListener("click", () => closeModal("modal-goal-overlay"));
  document.getElementById("modal-goal-cancel").addEventListener("click", () => closeModal("modal-goal-overlay"));
  document.getElementById("modal-goal-save").addEventListener("click", saveGoalModal);

  document.getElementById("modal-delete-close").addEventListener("click", () => closeModal("modal-delete-overlay"));
  document.getElementById("modal-delete-cancel").addEventListener("click", () => closeModal("modal-delete-overlay"));
  document.getElementById("modal-delete-confirm").addEventListener("click", confirmDelete);

  document.getElementById("modal-details-close").addEventListener("click", () => closeModal("modal-details-overlay"));

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
// INICIALIZAÇÃO DO APP
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
  initSidebar();
  initSearch();
  initProfile();
  initClock();
  initTimeframeControls();
  initCardModals();
  initAgendaModals();
  initLayoutSelector();

  document.getElementById("inline-agenda-close").addEventListener("click", closeInlineAgendaPanel);

  document.getElementById("btn-add-agenda-event").addEventListener("click", () => openAgendaModal());
  document.getElementById("btn-inline-add-event").addEventListener("click", () => openAgendaModal());

  await refreshData();
});
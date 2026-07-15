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
  username: "Jeremy Robson",
  email: "jeremy@example.com",
  avatar: null,
  theme: "escuro",
  focus_sound: "chuva",
  enable_confetti: 1
};

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

// Correção do Bug de QA: populateCategorySelect definido de forma nativa e robusta
function populateCategorySelect(selectId, selectedId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = "";
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
  if (userProfile.enable_confetti === 0) return;
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
  initAudioContext();

  if (type === "nenhum") return;

  // ----------------------------------------------------------------
  // ONDAS BINAURAIS 40Hz (GAMMA) — batida real por diferença de fase
  // Ex.: 200Hz no ouvido esquerdo + 240Hz no direito => batida de 40Hz.
  // Requer estéreo; usamos StereoPanner para isolar cada canal.
  // ----------------------------------------------------------------
  if (type === "binaural") {
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
    return;
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
  category.style.color = `var(--${TIMELINE_CLASSES[event.activity_title] || "work"}-color)`;

  // Carregar som do perfil
  const select = document.getElementById("focus-sound-select");
  select.value = userProfile.focus_sound || "chuva";

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
    btn.innerHTML = `<svg id="focus-play-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Retomar`;
  } else {
    // Iniciar
    pomodoroIsRunning = true;
    if (container) container.classList.add("running");
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pausar`;

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
        playCompletionBell();
        showToast("Ciclo de foco concluído! Excelente trabalho!", "success");
        triggerConfetti();
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
  btn.innerHTML = `<svg id="focus-play-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Iniciar`;
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
    ring.style.strokeDasharray = String(POMODORO_RING_CIRCUMFERENCE);
    ring.style.strokeDashoffset = String(offset);
  }
}

async function completeFocusTask() {
  if (!currentFocusEvent) return;
  playCompletionBell();
  if (userProfile.enable_confetti !== 0) triggerConfetti();
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
  activeSection = section;
  document.getElementById("section-dashboard").classList.toggle("hidden", section !== "dashboard");
  document.getElementById("section-agenda").classList.toggle("hidden", section !== "agenda");
  document.getElementById("section-reports").classList.toggle("hidden", section !== "reports");
  document.getElementById("section-settings").classList.toggle("hidden", section !== "settings");

  if (section === "agenda") {
    fetchAndRenderAgenda();
  } else if (section === "reports") {
    renderReports();
  } else if (section === "settings") {
    loadSettingsTab();
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
    const response = await fetch("/api/profile");
    if (!response.ok) return;
    const profile = await response.json();
    if (profile) {
      userProfile = profile;
      applyProfileData();
    }
  } catch (error) {
    console.error("Erro ao carregar perfil:", error);
  }
}

function applyProfileData() {
  const av = userProfile.avatar || "./images/image-jeremy.png";
  const un = userProfile.username || "Jeremy Robson";
  const em = userProfile.email || "jeremy@example.com";

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
  document.getElementById("pref-confetti").checked = userProfile.enable_confetti === 1;
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
    avatar: userProfile.avatar,
    theme: userProfile.theme,
    focus_sound: userProfile.focus_sound,
    enable_confetti: userProfile.enable_confetti
  };

  try {
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("Falha ao salvar perfil");
    const res = await response.json();
    userProfile = res.profile;
    applyProfileData();
    showToast("Dados do perfil atualizados!", "success");
    closeModal("modal-profile-overlay");
  } catch (error) {
    showToast("Erro ao salvar perfil", "error");
  }
}

async function savePreferencesModal() {
  const theme = document.getElementById("pref-theme").value;
  const enableConfetti = document.getElementById("pref-confetti").checked ? 1 : 0;

  const payload = {
    username: userProfile.username,
    email: userProfile.email,
    avatar: userProfile.avatar,
    theme,
    focus_sound: userProfile.focus_sound,
    enable_confetti: enableConfetti
  };

  try {
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("Erro ao salvar preferências");
    const res = await response.json();
    userProfile = res.profile;
    applyProfileData();
    showToast("Preferências aplicadas!", "success");
    closeModal("modal-preferences-overlay");
  } catch (error) {
    showToast("Erro ao salvar preferências", "error");
  }
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
          <td><span class="event-duration-badge" style="background:${ev.event_color || 'rgba(255, 255, 255, 0.05)'}; color: ${ev.event_color ? '#fff' : 'var(--pale-blue)'}">${ev.start_time} - ${ev.end_time} (${ev.duration_hours}h)</span></td>
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
        tr.querySelector(".btn-edit").addEventListener("click", () => openAgendaModal(ev.id));
        tr.querySelector(".btn-delete").addEventListener("click", () => deleteAgendaEvent(ev.id));
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
function createQuickActionsHtml(eventId) {
  return `
    <div class="quick-actions-container">
      <button class="quick-btn quick-focus" data-id="${eventId}" title="Iniciar Modo Foco (Pomodoro)">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/></svg>
      </button>
      <button class="quick-btn quick-edit" data-id="${eventId}" title="Editar compromisso">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
      <button class="quick-btn quick-delete" data-id="${eventId}" title="Excluir compromisso">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
      </button>
    </div>
  `;
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
  tdahContainer.innerHTML = `
    <div class="mental-battery-card">
      <div style="flex:1;">
        <h4 class="mental-battery-title">Bateria Mental para Hoje</h4>
        <p class="mental-battery-advice">${advice}</p>
      </div>
      <div class="mental-battery-graphic">
        <svg width="80" height="80" viewBox="0 0 36 36" style="transform: rotate(-90deg);">
          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="3" />
          <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="${batteryColor}" stroke-width="3.5" stroke-dasharray="${batteryPercent}, 100" stroke-linecap="round" style="transition: stroke-dasharray 0.5s ease-in-out;" />
        </svg>
        <span class="mental-battery-percent-text">${batteryPercent}%</span>
      </div>
    </div>
  `;

  // Grid de Cartões estilo PECS
  const pecsGrid = document.createElement("div");
  pecsGrid.className = "tdah-pecs-grid";

  if (todayEvents.length === 0) {
    pecsGrid.innerHTML = `
      <div class="agenda-empty-state" style="grid-column: 1 / -1; padding: 3rem 1rem;">
        <p style="font-size:1rem;">Nenhuma atividade agendada para hoje. Aproveite para relaxar!</p>
      </div>
    `;
  } else {
    todayEvents.forEach(ev => {
      const card = document.createElement("div");
      const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
      const titlePt = TITLE_PT[ev.activity_title] || ev.activity_title;
      const emoji = CATEGORY_PICTOGRAMS[ev.activity_title] || "📋";
      const effort = "⚡".repeat(ev.cognitive_load || 1);

      card.className = `tdah-pecs-card ${ev.is_completed ? "completed" : ""}`;
      card.style.opacity = ev.is_completed ? "0.5" : "1";
      card.style.borderLeft = `5px solid ${ev.event_color || `var(--${evClass}-color)`}`;
      
      card.innerHTML = `
        <div class="tdah-card-badge-row">
          <span class="tdah-prio-badge ${ev.priority}">${ev.priority.toUpperCase()}</span>
          <span class="tdah-effort-indicator" title="Carga Cognitiva">${effort}</span>
        </div>
        <div style="display:flex; align-items:center; gap:0.85rem;">
          <div class="tdah-card-icon-container" style="background: rgba(255,255,255,0.04); border: 1.5px solid ${ev.event_color || `var(--${evClass}-color)`}">
            ${emoji}
          </div>
          <div style="flex:1; min-width:0;">
            <div class="tdah-card-title" style="${ev.is_completed ? "text-decoration: line-through;" : ""}">${ev.title}</div>
            <div class="tdah-card-desc">${ev.description || "Sem descrição adicional"}</div>
          </div>
        </div>
        <div class="tdah-card-footer">
          <span class="event-duration-badge" style="background:rgba(255,255,255,0.05); margin-top:0;">${ev.start_time} - ${ev.end_time}</span>
          <div style="display:flex; gap:0.4rem; align-items:center;">
            ${createQuickActionsHtml(ev.id)}
            ${!ev.is_completed ? `<button class="btn-focus" id="btn-focus-${ev.id}">🎯 Focar</button>` : ""}
          </div>
        </div>
      `;

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
      const effort = "⚡".repeat(ev.cognitive_load || 1);

      const card = document.createElement("div");
      card.className = `timeline-event-card ${evClass} ${ev.is_completed ? "completed" : ""}`;
      if (ev.event_color) {
        card.style.borderLeftColor = ev.event_color;
      }

      card.innerHTML = `
        <div class="event-time-info">
          <span class="event-duration-badge" style="background:${ev.event_color || 'rgba(255,255,255,0.05)'}; color: ${ev.event_color ? '#fff' : 'var(--pale-blue)'}">${ev.start_time} - ${ev.end_time}</span>
        </div>
        <div class="event-details" style="${ev.is_completed ? "text-decoration: line-through; opacity: 0.5;" : ""}">
          <div class="event-title" style="display:flex; align-items:center; gap:0.5rem;">
            ${ev.title}
            <span class="tdah-prio-badge ${ev.priority}" style="font-size:0.6rem; padding:0.15rem 0.45rem;">${ev.priority}</span>
            <span style="font-size:0.7rem;">${effort}</span>
          </div>
          <div class="event-desc">${titlePt} ${ev.description ? `• ${ev.description}` : ""}</div>
        </div>
        <div style="display:flex; align-items:center; gap:0.4rem; z-index:10;">
          ${createQuickActionsHtml(ev.id)}
        </div>
      `;

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
    grid.style.gridTemplateColumns = `80px ${widths.map(w => `${w}px`).join(" ")}`;
    grid.style.width = "max-content";
  } else {
    grid.style.gridTemplateColumns = "80px repeat(7, minmax(140px, 1fr))";
    grid.style.width = "100%";
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
  grid.innerHTML += `
    <div class="google-time-header">
      Horário
      <button class="google-cols-reset" id="google-cols-reset" title="Restaurar largura padrão das colunas">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
        Redefinir
      </button>
    </div>`;

  weekDays.forEach((dayStr, idx) => {
    const d = new Date(dayStr + "T00:00:00");
    const dayLabel = `${dayNamesShort[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;
    // Handle de redimensionamento na borda direita de cada cabeçalho de dia
    grid.innerHTML += `
      <div class="google-day-header" data-col-index="${idx}">
        ${dayLabel}
        <span class="google-col-resizer" data-col-index="${idx}" title="Arraste para redimensionar (duplo-clique para redefinir)"></span>
      </div>`;
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

        if (ev.event_color) {
          block.style.background = `${ev.event_color}25`;
          block.style.color = ev.event_color;
          block.style.borderLeftColor = ev.event_color;
        }

        block.innerHTML = `
          <span style="min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;"><strong>${ev.start_time}</strong> ${ev.title}</span>
          ${createQuickActionsHtml(ev.id)}
        `;
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
        if (ev.event_color) {
          card.style.borderLeft = `3px solid ${ev.event_color}`;
        }
        card.innerHTML = `
          <div class="ticktick-checkbox-container">
            <span class="ticktick-checkbox" id="check-${ev.id}"></span>
          </div>
          <div class="ticktick-task-content">
            <div class="ticktick-task-title">${ev.title}</div>
            <div class="ticktick-task-time">${ev.start_time} - ${ev.end_time}</div>
          </div>
          ${createQuickActionsHtml(ev.id)}
        `;

        // Checkbox interativo real do TickTick
        const checkbox = card.querySelector(`.ticktick-checkbox`);
        if (ev.is_completed) {
          checkbox.style.background = "var(--success-color)";
          checkbox.style.borderColor = "var(--success-color)";
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
    const heightPx = Math.max(35, endMinutes - startMinutes);

    const evClass = TIMELINE_CLASSES[ev.activity_title] || "work";
    const slot = document.createElement("div");
    slot.className = `morgen-event-slot ${evClass}`;
    slot.style.top = `${topPx}px`;
    slot.style.height = `${heightPx}px`;
    slot.style.opacity = ev.is_completed ? "0.5" : "1";
    slot.style.textDecoration = ev.is_completed ? "line-through" : "none";

    if (ev.event_color) {
      slot.style.background = `${ev.event_color}25`;
      slot.style.color = ev.event_color;
      slot.style.borderLeftColor = ev.event_color;
    }

    slot.innerHTML = `
      <div style="min-width:0; overflow:hidden;">
        <div class="morgen-event-title" style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${ev.title}</div>
        <div class="morgen-event-time">${ev.start_time} - ${ev.end_time}</div>
      </div>
      ${createQuickActionsHtml(ev.id)}
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
  bindQuickActions(container);
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

      if (ev.event_color) {
        task.style.borderLeft = `3px solid ${ev.event_color}`;
        task.style.paddingLeft = "0.75rem";
      }

      task.innerHTML = `
        <div>
          <div class="todoist-task-name">${ev.title}</div>
          <div class="todoist-task-desc">${ev.description || "Sem descrição"}</div>
        </div>
        <div class="todoist-task-meta">
          <div class="todoist-task-date">${formatDatePtBr(ev.event_date)}</div>
          <span class="todoist-task-time-badge">${ev.start_time} - ${ev.end_time}</span>
          ${createQuickActionsHtml(ev.id)}
        </div>
      `;

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
        const effort = "⚡".repeat(ev.cognitive_load || 1);

        const card = document.createElement("div");
        card.className = `kanban-event-card ${evClass} ${ev.is_completed ? "completed" : ""}`;
        
        if (ev.event_color) {
          card.style.borderLeftColor = ev.event_color;
        }

        card.innerHTML = `
          <div class="kanban-event-header">
            <span class="kanban-event-time">${ev.start_time} - ${ev.end_time}</span>
            <div class="ticktick-checkbox-container" style="margin-left:auto; z-index:10; display:flex; align-items:center; gap:0.5rem;">
              <span class="ticktick-checkbox" id="kanban-check-${ev.id}"></span>
            </div>
          </div>
          <div class="kanban-event-title" style="${ev.is_completed ? "text-decoration: line-through; opacity:0.6;" : ""}">${ev.title}</div>
          <div class="kanban-event-desc" style="${ev.is_completed ? "opacity:0.4;" : ""}">${ev.description || "Sem descrição"}</div>
          <div class="kanban-card-footer">
            <span class="kanban-category-badge" style="color: ${ev.event_color || `var(--${evClass}-color)`}">${titlePt}</span>
            <span style="font-size:0.7rem; color:var(--pale-blue);">${effort}</span>
            <span class="event-duration-badge" style="background: rgba(255,255,255,0.05); margin-top:0;">${formatDatePtBr(ev.event_date)} (${ev.duration_hours}h)</span>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:0.25rem; margin-top:0.35rem;">
            ${createQuickActionsHtml(ev.id)}
          </div>
        `;

        // Checkbox de conclusão rápida do card Kanban
        const checkbox = card.querySelector(".ticktick-checkbox");
        if (ev.is_completed) {
          checkbox.style.background = "var(--success-color)";
          checkbox.style.borderColor = "var(--success-color)";
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
    const response = await fetch(`/api/agenda/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_completed: newState })
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error);
    }

    showToast(newState ? "Compromisso concluído!" : "Compromisso reaberto!", "success");
    
    // Disparar animação dopaminérgica se concluído
    if (newState) {
      triggerConfetti();
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

  if (eventId) {
    fetchEventDetailsAndOpenModal(eventId);
  } else {
    document.getElementById("modal-agenda-title").textContent = "Novo Compromisso";
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

// ID do compromisso aguardando confirmação de exclusão (modal premium)
let pendingDeleteEventId = null;

// Abre o modal premium de confirmação (substitui o confirm() nativo)
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
  document.getElementById("modal-agenda-close").addEventListener("click", () => {
    document.getElementById("modal-agenda-overlay").classList.remove("open");
  });
  document.getElementById("modal-agenda-cancel").addEventListener("click", () => {
    document.getElementById("modal-agenda-overlay").classList.remove("open");
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
}

// ============================================================
// RELATÓRIOS (Com Gráfico Radial SVG dinâmico)
// ============================================================

function renderReports() {
  // 1. Fichas de categorias
  const grid = document.getElementById("reports-grid");
  grid.innerHTML = "";

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

    let rowsHtml = "";
    const periods = [
      { key: "daily", label: "Diário" },
      { key: "weekly", label: "Semanal" },
      { key: "monthly", label: "Mensal" }
    ];

    periods.forEach(p => {
      const tfVal = activity.timeframes[p.key] || { current: 0, previous: 0 };
      const target = activity.goals && activity.goals[p.key] ? activity.goals[p.key] : null;
      rowsHtml += `
        <div class="report-row">
          <span class="report-row-label">${p.label}</span>
          <span class="report-row-value">${tfVal.current}h / ${tfVal.previous}h${target ? ` (Meta: ${target}h)` : ""}</span>
        </div>
      `;
    });

    card.innerHTML = `
      <div class="report-card-title">
        <span class="color-dot" style="background: ${color}"></span>
        ${titlePt}
      </div>
      ${rowsHtml}
    `;
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
  chartContainer.innerHTML = "";
  legendContainer.innerHTML = "";

  if (totalHours === 0) {
    chartContainer.innerHTML = `<span style="font-size:0.8rem; color:var(--pale-blue);">Sem dados para gerar gráfico</span>`;
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
    circle.setAttribute("style", "transition: stroke-dasharray 0.3s;");
    svg.appendChild(circle);

    accumulatedPercent += percent;

    // Adicionar legenda
    const legendItem = document.createElement("div");
    legendItem.className = "legend-item";
    legendItem.innerHTML = `
      <div class="legend-color-label">
        <span class="legend-color-dot" style="background: ${color}"></span>
        <span>${titlePt}</span>
      </div>
      <strong style="color:#fff;">${tf.current}h (${Math.round(percent)}%)</strong>
    `;
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
  totalLabel.style.position = "absolute";
  totalLabel.style.textAlign = "center";
  totalLabel.innerHTML = `
    <div style="font-size: 0.72rem; color: var(--pale-blue); text-transform: uppercase;">Total</div>
    <div style="font-size: 1.4rem; font-weight:300; color: #fff;">${totalHours}h</div>
  `;
  chartContainer.appendChild(totalLabel);
}

// ============================================================
// CONFIGURAÇÕES (Abas, Tema Claro e Restauração)
// ============================================================

function loadSettingsTab() {
  document.getElementById("settings-theme").value = userProfile.theme || "escuro";
  document.getElementById("settings-confetti").checked = userProfile.enable_confetti === 1;
  document.getElementById("settings-sound").value = userProfile.focus_sound || "chuva";
}

async function saveSettingsFromTab() {
  const theme = document.getElementById("settings-theme").value;
  const enableConfetti = document.getElementById("settings-confetti").checked ? 1 : 0;
  const focusSound = document.getElementById("settings-sound").value;

  const payload = {
    username: userProfile.username,
    email: userProfile.email,
    avatar: userProfile.avatar,
    theme,
    focus_sound: focusSound,
    enable_confetti: enableConfetti
  };

  try {
    const response = await fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) throw new Error("Erro ao aplicar preferências");
    const res = await response.json();
    userProfile = res.profile;
    applyProfileData();
    showToast("Configurações salvas!", "success");
  } catch (error) {
    showToast("Erro ao salvar configurações", "error");
  }
}


function resetDatabase() {
  document.getElementById("modal-confirm-reset-overlay").classList.add("open");
}

async function performResetDatabase() {
  document.getElementById("modal-confirm-reset-overlay").classList.remove("open");
  try {
    const response = await fetch("/api/settings/reset", { method: "POST" });
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
  await fetchProfileData();
  await fetchActivities();
  await updateKPIs();
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
    const res = await fetch("/api/google/status");
    if (res.status === 503) {
      dot.style.background = "var(--warning-color)";
      title.textContent = "Dependência ausente";
      desc.textContent = "Rode: npm install";
      hint.textContent = "A biblioteca googleapis ainda não foi instalada. Rode \"npm install\" e reinicie o servidor.";
      btnConnect.style.display = "none"; btnSync.style.display = "none"; btnDisc.style.display = "none";
      return;
    }
    const data = await res.json();

    if (!data.configured) {
      dot.style.background = "var(--warning-color)";
      title.textContent = "Não configurada";
      desc.textContent = "Faltam credenciais no .env";
      hint.textContent = "Preencha GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REDIRECT_URI no arquivo .env (veja o .env.example) e reinicie o servidor.";
      btnConnect.style.display = "none"; btnSync.style.display = "none"; btnDisc.style.display = "none";
      return;
    }

    if (data.connected) {
      dot.style.background = "var(--success-color)";
      title.textContent = "Conectada";
      desc.textContent = data.email ? data.email : "Conta Google vinculada";
      hint.textContent = "Sincronização bidirecional ativa. Clique em \"Sincronizar agora\" para atualizar os compromissos nos dois sentidos.";
      btnConnect.style.display = "none";
      btnSync.style.display = "inline-flex";
      btnDisc.style.display = "inline-flex";
    } else {
      dot.style.background = "var(--pale-blue)";
      title.textContent = "Desconectada";
      desc.textContent = "Pronta para conectar";
      hint.textContent = "Conecte sua Google Agenda para sincronizar compromissos nos dois sentidos (criar, editar e excluir).";
      btnConnect.style.display = "inline-flex";
      btnSync.style.display = "none";
      btnDisc.style.display = "none";
    }
  } catch (e) {
    dot.style.background = "var(--danger-color)";
    title.textContent = "Indisponível";
    desc.textContent = "Erro ao consultar status";
  }
}

async function connectGoogle() {
  try {
    const res = await fetch("/api/google/auth");
    const data = await res.json();
    if (res.ok && data.url) {
      window.location.href = data.url; // redireciona para o consentimento do Google
    } else {
      showToast(data.error || "Não foi possível iniciar a conexão.", "error");
    }
  } catch (e) {
    showToast("Erro ao iniciar a conexão com o Google.", "error");
  }
}

async function syncGoogle() {
  const icon = document.getElementById("google-sync-icon");
  const btn = document.getElementById("btn-google-sync");
  if (btn) btn.disabled = true;
  if (icon) icon.style.animation = "spin 1s linear infinite";
  showToast("Sincronizando com o Google Agenda…", "success");
  try {
    const res = await fetch("/api/google/sync", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha na sincronização.");
    const s = data.stats || {};
    showToast(`Sincronizado! Enviados: ${s.pushed || 0} · Importados: ${s.pulled || 0} · Atualizados: ${s.updated || 0}`, "success");
    await refreshData();
    if (activeSection === "agenda") await fetchAndRenderAgenda();
  } catch (e) {
    showToast(e.message, "error");
  } finally {
    if (btn) btn.disabled = false;
    if (icon) icon.style.animation = "";
  }
}

async function disconnectGoogle() {
  try {
    const res = await fetch("/api/google/disconnect", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Falha ao desconectar.");
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
    userProfile.focus_sound = e.target.value;
    if (pomodoroIsRunning) { startFocusSound(e.target.value); }
  });
  document.querySelectorAll("#focus-cycle-selector .layout-btn").forEach(btn => {
    btn.addEventListener("click", () => setPomodoroCycle(parseInt(btn.dataset.cycle)));
  });
  await refreshData();
});

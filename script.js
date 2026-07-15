// Mapeamento das categorias recebidas da API para os respectivos IDs do DOM
const categoryMap = {
  "Work": { hourId: "first-hour", prevId: "first-prev-week" },
  "Play": { hourId: "second-hour", prevId: "second-prev-week" },
  "Study": { hourId: "third-hour", prevId: "third-prev-week" },
  "Exercise": { hourId: "fourth-hour", prevId: "fourth-prev-week" },
  "Social": { hourId: "fifth-hour", prevId: "fifth-prev-week" },
  "Self Care": { hourId: "sixth-hour", prevId: "sixth-prev-week" }
};

// Configurações de tradução e rótulo de período anterior por timeframe
const timeframesConfig = {
  daily: {
    label: "Ontem",
    elementId: "daily"
  },
  weekly: {
    label: "Última semana",
    elementId: "weekly"
  },
  monthly: {
    label: "Último mês",
    elementId: "monthly"
  }
};

let activitiesData = [];
let activeTimeframe = "daily";

// Elementos dos botões de controle
const dailyBtn = document.getElementById("daily");
const weeklyBtn = document.getElementById("weekly");
const monthlyBtn = document.getElementById("monthly");
const controlButtons = [dailyBtn, weeklyBtn, monthlyBtn];

// Função para atualizar visualmente os dados no DOM com uma micro-animação de fade-in
function renderData() {
  activitiesData.forEach(activity => {
    const mapping = categoryMap[activity.title];
    if (!mapping) return;

    const hourElement = document.getElementById(mapping.hourId);
    const prevElement = document.getElementById(mapping.prevId);
    
    if (hourElement && prevElement) {
      const timeframeData = activity.timeframes[activeTimeframe];
      const currentHours = timeframeData ? timeframeData.current : 0;
      const prevHours = timeframeData ? timeframeData.previous : 0;
      const config = timeframesConfig[activeTimeframe];

      // Aplica animação de fade-out antes da atualização
      hourElement.style.opacity = 0;
      prevElement.style.opacity = 0;
      hourElement.style.transform = 'translateY(-5px)';
      
      setTimeout(() => {
        hourElement.textContent = `${currentHours}hrs`;
        prevElement.textContent = `${config.label} - ${prevHours}hrs`;
        
        // Aplica fade-in após atualizar o conteúdo
        hourElement.style.transition = 'all 0.3s ease';
        prevElement.style.transition = 'all 0.3s ease';
        hourElement.style.opacity = 1;
        prevElement.style.opacity = 1;
        hourElement.style.transform = 'translateY(0)';
      }, 150);
    }
  });
}

// Altera o estado do timeframe ativo e gerencia classes ativas no menu
function setTimeframe(timeframe) {
  activeTimeframe = timeframe;
  
  controlButtons.forEach(btn => {
    if (btn.id === timeframe) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });

  renderData();
}

// Configura os event listeners para alternância dos timeframes
function setupEventListeners() {
  dailyBtn.addEventListener("click", () => setTimeframe("daily"));
  weeklyBtn.addEventListener("click", () => setTimeframe("weekly"));
  monthlyBtn.addEventListener("click", () => setTimeframe("monthly"));
}

// Busca os dados da API local
async function fetchActivities() {
  try {
    const response = await fetch('/api/activities');
    if (!response.ok) {
      throw new Error(`Erro na requisição: ${response.statusText}`);
    }
    activitiesData = await response.json();
    renderData();
  } catch (error) {
    console.error("Falha ao buscar atividades da API:", error);
    // Em caso de falha, atualiza o status visual para informar o erro
    Object.values(categoryMap).forEach(mapping => {
      const prevElement = document.getElementById(mapping.prevId);
      if (prevElement) {
        prevElement.textContent = "Erro ao carregar dados";
        prevElement.style.color = "#ff5f5f";
      }
    });
  }
}

// Inicializa a aplicação
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  fetchActivities();
});
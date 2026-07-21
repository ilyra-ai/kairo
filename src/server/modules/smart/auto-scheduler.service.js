// ============================================================================
// Kairo — Agendador Autônomo "Auto-organizar meu dia" (Tarefa 35.2)
// ----------------------------------------------------------------------------
// SOLVER DETERMINÍSTICO (não LLM): aloca tarefas em janelas livres do dia
// respeitando janela de trabalho, eventos existentes (sem sobreposição), tamanho
// de bloco, folga mínima, prioridade, prazo e picos de energia. Produz uma PRÉVIA
// (nunca aplica sem confirmação). A IA é opcional apenas para interpretar o pedido
// em linguagem natural; o solver decide. Aplicar cria eventos reais e reversíveis.
// ============================================================================

import { unprocessable } from '../../shared/http-error.js';

const FEATURE_KEY = 'auto_scheduler';
const PRIORIDADE_ORDEM = { alta: 0, media: 1, baixa: 2 };

export function ensureAutoSchedulerSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auto_plan_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      plan_date TEXT NOT NULL,
      scheduled INTEGER NOT NULL DEFAULT 0,
      unscheduled INTEGER NOT NULL DEFAULT 0,
      applied INTEGER NOT NULL DEFAULT 0 CHECK (applied IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
  `);
}

function minutos(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
}

function paraHhmm(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function createAutoSchedulerService({
  db,
  smartFeaturesService,
  agendaService,
  now = () => new Date()
} = {}) {
  if (!db || !smartFeaturesService || !agendaService) {
    throw new Error('O agendador exige banco de dados, governança inteligente e agenda.');
  }
  ensureAutoSchedulerSchema(db);

  function validarData(date) {
    const alvo = date || now().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(alvo)) {
      throw unprocessable('Data inválida (use YYYY-MM-DD).', 'DATA_INVALIDA');
    }
    return alvo;
  }

  // Calcula as janelas livres do dia entre a jornada de trabalho, descontando os
  // eventos existentes e aplicando a folga mínima entre blocos.
  function janelasLivres(userId, date, params) {
    const inicio = minutos(params.inicio_trabalho || '09:00');
    const fim = minutos(params.fim_trabalho || '18:00');
    const folga = Number(params.folga_min) || 0;
    const eventos = db
      .all(
        'SELECT start_time, end_time FROM agenda_events WHERE user_id = ? AND event_date = ? ORDER BY start_time ASC',
        [userId, date]
      )
      .map((e) => ({ ini: minutos(e.start_time), fim: minutos(e.end_time) }))
      .sort((a, b) => a.ini - b.ini);

    const janelas = [];
    let cursor = inicio;
    for (const ev of eventos) {
      if (ev.ini > cursor) janelas.push({ ini: cursor, fim: Math.min(ev.ini, fim) });
      cursor = Math.max(cursor, ev.fim + folga);
    }
    if (cursor < fim) janelas.push({ ini: cursor, fim });
    return janelas.filter((j) => j.fim - j.ini > 0);
  }

  function ordenarTarefas(tarefas, prioridadeEnergia) {
    return [...tarefas].sort((a, b) => {
      const pa = PRIORIDADE_ORDEM[a.priority] ?? 1;
      const pb = PRIORIDADE_ORDEM[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      // Prazo mais próximo primeiro.
      const da = a.deadline || '9999-12-31';
      const dbb = b.deadline || '9999-12-31';
      if (da !== dbb) return da < dbb ? -1 : 1;
      // Com prioridade de energia: alocar maior carga cognitiva mais cedo.
      if (prioridadeEnergia) return (b.cognitive_load || 1) - (a.cognitive_load || 1);
      return 0;
    });
  }

  // Gera o plano proposto (prévia) — não persiste eventos.
  function preview(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const date = validarData(input.date);
    const params = smartFeaturesService.params(FEATURE_KEY);
    const blocoMin = Number(params.bloco_min) || 30;
    const folga = Number(params.folga_min) || 0;
    const tarefas = Array.isArray(input.tasks) ? input.tasks : [];
    if (tarefas.length === 0) {
      throw unprocessable('Informe as tarefas a organizar.', 'SEM_TAREFAS');
    }

    const janelas = janelasLivres(userId, date, params);
    const ordenadas = ordenarTarefas(tarefas, Boolean(params.prioriza_energia));
    const plano = [];
    const naoAlocadas = [];

    for (const tarefa of ordenadas) {
      const duracao = Math.max(
        blocoMin,
        Math.ceil((Number(tarefa.duration_min) || blocoMin) / blocoMin) * blocoMin
      );
      let alocada = false;
      for (const janela of janelas) {
        if (janela.fim - janela.ini >= duracao) {
          const ini = janela.ini;
          const fim = ini + duracao;
          plano.push({
            title: String(tarefa.title || 'Tarefa').trim(),
            activity_id: tarefa.activity_id,
            event_date: date,
            start_time: paraHhmm(ini),
            end_time: paraHhmm(fim),
            cognitive_load: Math.max(1, Math.min(3, Number(tarefa.cognitive_load) || 1)),
            priority: tarefa.priority || 'media'
          });
          // Consome a janela e aplica folga.
          janela.ini = fim + folga;
          alocada = true;
          break;
        }
      }
      if (!alocada)
        naoAlocadas.push({ title: tarefa.title, reason: 'Sem janela livre suficiente.' });
    }

    db.run(
      'INSERT INTO auto_plan_runs (user_id, plan_date, scheduled, unscheduled, applied) VALUES (?, ?, ?, ?, 0)',
      [userId, date, plano.length, naoAlocadas.length]
    );

    return { date, plan: plano, unscheduled: naoAlocadas };
  }

  // Aplica o plano criando eventos REAIS (reversíveis pela exclusão normal).
  function apply(userId, input = {}) {
    smartFeaturesService.assertEnabled(FEATURE_KEY);
    const itens = Array.isArray(input.plan) ? input.plan : [];
    if (itens.length === 0) throw unprocessable('Plano vazio.', 'PLANO_VAZIO');

    const criados = [];
    db.transaction(() => {
      for (const item of itens) {
        if (!item.activity_id) {
          throw unprocessable(
            'Cada item do plano precisa de uma atividade.',
            'ATIVIDADE_OBRIGATORIA'
          );
        }
        const evento = agendaService.create(userId, {
          activity_id: item.activity_id,
          title: item.title,
          event_date: item.event_date,
          start_time: item.start_time,
          end_time: item.end_time,
          cognitive_load: item.cognitive_load,
          priority: item.priority
        });
        criados.push(evento);
      }
      db.run(
        'UPDATE auto_plan_runs SET applied = 1 WHERE id = (SELECT MAX(id) FROM auto_plan_runs WHERE user_id = ?)',
        [userId]
      );
    });
    return { applied: criados.length, events: criados };
  }

  return { preview, apply };
}

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
// Aumentar o limite para suportar o upload de imagens em Base64 no perfil
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// Servindo arquivos estáticos do frontend
app.use(express.static(__dirname));

let db;

// ============================================================
// AUXILIARES DE DATA E HORA
// ============================================================

function calculateDuration(startTime, endTime) {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  
  const diffMinutes = endMinutes - startMinutes;
  return Math.max(0, parseFloat((diffMinutes / 60).toFixed(2)));
}

function parseLocalDate(dateStr) {
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getDatePeriodFlags(eventDateStr) {
  const eventDate = parseLocalDate(eventDateStr);
  const today = new Date();
  
  // Reseta horas para comparação exata de dias
  today.setHours(0, 0, 0, 0);
  eventDate.setHours(0, 0, 0, 0);

  const isToday = eventDate.getTime() === today.getTime();

  // Calcular início e fim da semana atual (Domingo a Sábado)
  const currentDayOfWeek = today.getDay();
  const startOfWeek = new Date(today);
  startOfWeek.setDate(today.getDate() - currentDayOfWeek);
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);

  startOfWeek.setHours(0, 0, 0, 0);
  endOfWeek.setHours(23, 59, 59, 999);
  
  const isThisWeek = eventDate.getTime() >= startOfWeek.getTime() && eventDate.getTime() <= endOfWeek.getTime();

  // Calcular início e fim do mês atual
  const isThisMonth = eventDate.getFullYear() === today.getFullYear() && eventDate.getMonth() === today.getMonth();

  return { isToday, isThisWeek, isThisMonth };
}

// ============================================================
// INICIALIZAÇÃO DO BANCO DE DADOS
// ============================================================

async function initializeDatabase() {
  db = await open({
    filename: path.join(__dirname, 'database.sqlite'),
    driver: sqlite3.Database
  });

  // Habilitar foreign keys no SQLite
  await db.run('PRAGMA foreign_keys = ON');

  // Tabela de atividades
  await db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT UNIQUE NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Tabela de períodos de tempo (timeframes)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS timeframes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      current INTEGER DEFAULT 0,
      previous INTEGER DEFAULT 0,
      FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
      UNIQUE(activity_id, type)
    );
  `);

  // Tabela de metas
  await db.exec(`
    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      target_hours INTEGER DEFAULT 0,
      FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE,
      UNIQUE(activity_id, type)
    );
  `);

  // Tabela de Perfil do Usuário
  await db.exec(`
    CREATE TABLE IF NOT EXISTS profile_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT DEFAULT 'Jeremy Robson',
      email TEXT DEFAULT 'jeremy@example.com',
      avatar TEXT DEFAULT NULL,
      theme TEXT DEFAULT 'escuro',
      focus_sound TEXT DEFAULT 'chuva',
      enable_confetti INTEGER DEFAULT 1
    );
  `);

  // Tabela de eventos da Agenda (Adicionados novos campos: priority, cognitive_load, event_color)
  await db.exec(`
    CREATE TABLE IF NOT EXISTS agenda_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      activity_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      event_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      duration_hours REAL NOT NULL,
      is_completed INTEGER DEFAULT 0,
      priority TEXT DEFAULT 'media',
      cognitive_load INTEGER DEFAULT 1,
      event_color TEXT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (activity_id) REFERENCES activities (id) ON DELETE CASCADE
    );
  `);

  // Migrações dinâmicas para adicionar novas colunas de controle se as tabelas já existirem
  const dbAlterations = [
    'ALTER TABLE agenda_events ADD COLUMN is_completed INTEGER DEFAULT 0;',
    "ALTER TABLE agenda_events ADD COLUMN priority TEXT DEFAULT 'media';",
    'ALTER TABLE agenda_events ADD COLUMN cognitive_load INTEGER DEFAULT 1;',
    'ALTER TABLE agenda_events ADD COLUMN event_color TEXT DEFAULT NULL;'
  ];

  for (const query of dbAlterations) {
    try {
      await db.exec(query);
    } catch (e) {
      // Ignorar erro de coluna já existente
    }
  }

  // Criar perfil padrão se a tabela de perfil estiver vazia
  const profileCount = await db.get('SELECT COUNT(*) as count FROM profile_data');
  if (profileCount.count === 0) {
    await db.run(`
      INSERT INTO profile_data (username, email, avatar, theme, focus_sound, enable_confetti)
      VALUES (?, ?, ?, ?, ?, ?)
    `, ['Jeremy Robson', 'jeremy@example.com', null, 'escuro', 'chuva', 1]);
  }

  // Seed inicial se o banco de atividades estiver vazio
  const count = await db.get('SELECT COUNT(*) as count FROM activities');
  if (count.count === 0) {
    console.log('Banco de dados vazio. Iniciando seed a partir de data.json e agenda de exemplo...');
    try {
      const rawData = await fs.readFile(path.join(__dirname, 'data.json'), 'utf-8');
      const data = JSON.parse(rawData);

      const activitiesMap = {};

      for (const item of data) {
        const result = await db.run(
          'INSERT OR IGNORE INTO activities (title) VALUES (?)',
          [item.title]
        );
        const activityId = result.lastID || (await db.get('SELECT id FROM activities WHERE title = ?', [item.title])).id;
        activitiesMap[item.title] = activityId;

        for (const [timeframe, values] of Object.entries(item.timeframes)) {
          await db.run(
            'INSERT OR REPLACE INTO timeframes (activity_id, type, current, previous) VALUES (?, ?, ?, ?)',
            [activityId, timeframe, values.current, values.previous]
          );
        }
      }

      // Inserir compromissos iniciais da Agenda (Seed consistente)
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      const otherDayThisWeek = new Date();
      otherDayThisWeek.setDate(today.getDate() - 2);
      const otherDayThisWeekStr = otherDayThisWeek.toISOString().split('T')[0];

      const seedEvents = [
        // TRABALHO (Work) -> 5h de Hoje
        {
          activity_id: activitiesMap["Work"],
          title: "Reunião Geral e Planejamento Sprint",
          description: "Alinhamento com a diretoria técnica e revisão do roadmap de desenvolvimento.",
          event_date: todayStr,
          start_time: "09:00",
          end_time: "11:00",
          duration_hours: 2.0,
          is_completed: 0,
          priority: "alta",
          cognitive_load: 3,
          event_color: null
        },
        {
          activity_id: activitiesMap["Work"],
          title: "Desenvolvimento Frontend Dashboard",
          description: "Codificação dos componentes reativos e integração com a API local.",
          event_date: todayStr,
          start_time: "13:30",
          end_time: "16:30",
          duration_hours: 3.0,
          is_completed: 0,
          priority: "media",
          cognitive_load: 2,
          event_color: null
        },
        // LAZER (Play) -> 1h de Hoje
        {
          activity_id: activitiesMap["Play"],
          title: "Partida de Futebol Online",
          description: "Sessão cooperativa com amigos para relaxamento mental.",
          event_date: todayStr,
          start_time: "19:30",
          end_time: "20:30",
          duration_hours: 1.0,
          is_completed: 0,
          priority: "baixa",
          cognitive_load: 1,
          event_color: null
        },
        // EXERCÍCIOS (Exercise) -> 1h de Hoje
        {
          activity_id: activitiesMap["Exercise"],
          title: "Treino Funcional Completo",
          description: "Sessão de cardio e calistenia.",
          event_date: todayStr,
          start_time: "07:00",
          end_time: "08:00",
          duration_hours: 1.0,
          is_completed: 0,
          priority: "media",
          cognitive_load: 2,
          event_color: null
        },
        // SOCIAL -> 1h de Hoje
        {
          activity_id: activitiesMap["Social"],
          title: "Jantar com Família",
          description: "Momento de lazer e confraternização familiar semanal.",
          event_date: todayStr,
          start_time: "21:00",
          end_time: "22:00",
          duration_hours: 1.0,
          is_completed: 0,
          priority: "baixa",
          cognitive_load: 1,
          event_color: null
        },
        // ESTUDOS (Study) -> 4h na semana
        {
          activity_id: activitiesMap["Study"],
          title: "Leitura de Arquitetura de Sistemas",
          description: "Estudos teóricos sobre escalabilidade e bancos relacionais.",
          event_date: otherDayThisWeekStr,
          start_time: "10:00",
          end_time: "12:00",
          duration_hours: 2.0,
          is_completed: 0,
          priority: "alta",
          cognitive_load: 3,
          event_color: null
        },
        {
          activity_id: activitiesMap["Study"],
          title: "Curso Online de UX/UI",
          description: "Estudos práticos de design system e micro-interações.",
          event_date: otherDayThisWeekStr,
          start_time: "15:00",
          end_time: "17:00",
          duration_hours: 2.0,
          is_completed: 0,
          priority: "media",
          cognitive_load: 2,
          event_color: null
        },
        // AUTOCUIDADO (Self Care) -> 2h na semana
        {
          activity_id: activitiesMap["Self Care"],
          title: "Sessão de Meditação e Relaxamento",
          description: "Prática diária de respiração e mindfulness.",
          event_date: otherDayThisWeekStr,
          start_time: "22:00",
          end_time: "23:00",
          duration_hours: 1.0,
          is_completed: 0,
          priority: "baixa",
          cognitive_load: 1,
          event_color: null
        },
        {
          activity_id: activitiesMap["Self Care"],
          title: "Skincare e Preparação Noturna",
          description: "Rotina noturna de cuidados pessoais e higiene do sono.",
          event_date: otherDayThisWeekStr,
          start_time: "23:00",
          end_time: "24:00",
          duration_hours: 1.0,
          is_completed: 0,
          priority: "baixa",
          cognitive_load: 1,
          event_color: null
        }
      ];

      for (const ev of seedEvents) {
        await db.run(`
          INSERT INTO agenda_events (activity_id, title, description, event_date, start_time, end_time, duration_hours, is_completed, priority, cognitive_load, event_color)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [ev.activity_id, ev.title, ev.description, ev.event_date, ev.start_time, ev.end_time, ev.duration_hours, ev.is_completed, ev.priority, ev.cognitive_load, ev.event_color]);
      }

      console.log('Seed do banco de dados e da agenda realizado com sucesso!');
    } catch (err) {
      console.error('Erro ao popular banco de dados:', err);
    }
  }
}

// ============================================================
// FUNÇÃO DE ATUALIZAÇÃO REATIVA DE TIMEFRAMES
// ============================================================

async function syncTimeframesForActivity(activityId) {
  const events = await db.all('SELECT event_date, duration_hours FROM agenda_events WHERE activity_id = ?', [activityId]);
  
  let dailySum = 0;
  let weeklySum = 0;
  let monthlySum = 0;

  events.forEach(ev => {
    const { isToday, isThisWeek, isThisMonth } = getDatePeriodFlags(ev.event_date);
    if (isToday) dailySum += ev.duration_hours;
    if (isThisWeek) weeklySum += ev.duration_hours;
    if (isThisMonth) monthlySum += ev.duration_hours;
  });

  dailySum = Math.round(dailySum);
  weeklySum = Math.round(weeklySum);
  monthlySum = Math.round(monthlySum);

  await db.run(
    'INSERT INTO timeframes (activity_id, type, current, previous) VALUES (?, ?, ?, 0) ON CONFLICT(activity_id, type) DO UPDATE SET current = ?',
    [activityId, 'daily', dailySum, dailySum]
  );
  await db.run(
    'INSERT INTO timeframes (activity_id, type, current, previous) VALUES (?, ?, ?, 0) ON CONFLICT(activity_id, type) DO UPDATE SET current = ?',
    [activityId, 'weekly', weeklySum, weeklySum]
  );
  await db.run(
    'INSERT INTO timeframes (activity_id, type, current, previous) VALUES (?, ?, ?, 0) ON CONFLICT(activity_id, type) DO UPDATE SET current = ?',
    [activityId, 'monthly', monthlySum, monthlySum]
  );
}

// ============================================================
// ENDPOINTS DA API REST
// ============================================================

// 1. GET /api/activities — Listar todas as atividades com timeframes e metas
app.get('/api/activities', async (req, res) => {
  try {
    const activities = await db.all('SELECT id, title FROM activities ORDER BY id');
    const result = [];

    for (const activity of activities) {
      const timeframes = await db.all(
        'SELECT type, current, previous FROM timeframes WHERE activity_id = ?',
        [activity.id]
      );
      const goals = await db.all(
        'SELECT type, target_hours FROM goals WHERE activity_id = ?',
        [activity.id]
      );

      const timeframesObj = {};
      timeframes.forEach(tf => {
        timeframesObj[tf.type] = { current: tf.current, previous: tf.previous };
      });

      const goalsObj = {};
      goals.forEach(g => {
        goalsObj[g.type] = g.target_hours;
      });

      result.push({
        id: activity.id,
        title: activity.title,
        timeframes: timeframesObj,
        goals: goalsObj
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Erro ao buscar atividades:', error);
    res.status(500).json({ error: 'Erro ao buscar atividades no banco de dados.' });
  }
});

// 2. GET /api/activities/:id/details — Detalhes completos de uma atividade
app.get('/api/activities/:id/details', async (req, res) => {
  const { id } = req.params;
  try {
    const activity = await db.get('SELECT id, title FROM activities WHERE id = ?', [id]);
    if (!activity) {
      return res.status(404).json({ error: 'Atividade não encontrada.' });
    }

    const timeframes = await db.all(
      'SELECT type, current, previous FROM timeframes WHERE activity_id = ?',
      [id]
    );
    const goals = await db.all(
      'SELECT type, target_hours FROM goals WHERE activity_id = ?',
      [id]
    );

    const timeframesObj = {};
    timeframes.forEach(tf => {
      timeframesObj[tf.type] = { current: tf.current, previous: tf.previous };
    });

    const goalsObj = {};
    goals.forEach(g => {
      goalsObj[g.type] = g.target_hours;
    });

    res.json({
      id: activity.id,
      title: activity.title,
      timeframes: timeframesObj,
      goals: goalsObj
    });
  } catch (error) {
    console.error('Erro ao buscar detalhes:', error);
    res.status(500).json({ error: 'Erro ao buscar detalhes da atividade.' });
  }
});

// 3. PUT /api/activities/:id — Atualizar horas agregadas de uma atividade de forma manual
app.put('/api/activities/:id', async (req, res) => {
  const { id } = req.params;
  const { timeframe, current, previous } = req.body;

  if (!timeframe || current === undefined || previous === undefined) {
    return res.status(400).json({ error: 'Parâmetros timeframe, current e previous são obrigatórios.' });
  }

  try {
    const activity = await db.get('SELECT id FROM activities WHERE id = ?', [id]);
    if (!activity) {
      return res.status(404).json({ error: 'Atividade não encontrada.' });
    }

    const result = await db.run(
      'UPDATE timeframes SET current = ?, previous = ? WHERE activity_id = ? AND type = ?',
      [current, previous, id, timeframe]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Timeframe não encontrado para esta atividade.' });
    }

    res.json({ message: 'Horas atualizadas com sucesso!' });
  } catch (error) {
    console.error('Erro ao atualizar horas:', error);
    res.status(500).json({ error: 'Erro ao atualizar dados no banco de dados.' });
  }
});

// 4. PUT /api/activities/:id/goals — Criar ou atualizar meta de uma atividade
app.put('/api/activities/:id/goals', async (req, res) => {
  const { id } = req.params;
  const { timeframe, target_hours } = req.body;

  if (!timeframe || target_hours === undefined) {
    return res.status(400).json({ error: 'Parâmetros timeframe e target_hours são obrigatórios.' });
  }

  try {
    const activity = await db.get('SELECT id FROM activities WHERE id = ?', [id]);
    if (!activity) {
      return res.status(404).json({ error: 'Atividade não encontrada.' });
    }

    await db.run(
      'INSERT INTO goals (activity_id, type, target_hours) VALUES (?, ?, ?) ON CONFLICT(activity_id, type) DO UPDATE SET target_hours = ?',
      [id, timeframe, target_hours, target_hours]
    );

    res.json({ message: 'Meta definida com sucesso!' });
  } catch (error) {
    console.error('Erro ao definir meta:', error);
    res.status(500).json({ error: 'Erro ao definir meta no banco de dados.' });
  }
});

// 5. DELETE /api/activities/:id — Excluir uma atividade e dados relacionados (CASCADE)
app.delete('/api/activities/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const activity = await db.get('SELECT id, title FROM activities WHERE id = ?', [id]);
    if (!activity) {
      return res.status(404).json({ error: 'Atividade não encontrada.' });
    }

    await db.run('DELETE FROM activities WHERE id = ?', [id]);

    res.json({ message: `Atividade "${activity.title}" excluída com sucesso!` });
  } catch (error) {
    console.error('Erro ao excluir atividade:', error);
    res.status(500).json({ error: 'Erro ao excluir atividade do banco de dados.' });
  }
});

// ============================================================
// ENDPOINTS DE PERFIL DO USUÁRIO
// ============================================================

// GET /api/profile — Obter dados do perfil
app.get('/api/profile', async (req, res) => {
  try {
    const profile = await db.get('SELECT * FROM profile_data ORDER BY id LIMIT 1');
    res.json(profile);
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    res.status(500).json({ error: 'Erro ao obter perfil do usuário.' });
  }
});

// PUT /api/profile — Atualizar dados do perfil
app.put('/api/profile', async (req, res) => {
  const { username, email, avatar, theme, focus_sound, enable_confetti } = req.body;
  try {
    const profile = await db.get('SELECT id FROM profile_data ORDER BY id LIMIT 1');
    if (!profile) {
      return res.status(404).json({ error: 'Perfil não encontrado.' });
    }

    await db.run(`
      UPDATE profile_data
      SET username = ?, email = ?, avatar = COALESCE(?, avatar), theme = ?, focus_sound = ?, enable_confetti = ?
      WHERE id = ?
    `, [username, email, avatar || null, theme, focus_sound, enable_confetti !== undefined ? (enable_confetti ? 1 : 0) : 1, profile.id]);

    const updatedProfile = await db.get('SELECT * FROM profile_data WHERE id = ?', [profile.id]);
    res.json({ message: 'Perfil atualizado com sucesso!', profile: updatedProfile });
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ error: 'Erro ao atualizar perfil do usuário.' });
  }
});

// ============================================================
// ENDPOINTS DA AGENDA
// ============================================================

// 6. GET /api/agenda — Listar todos os compromissos cronologicamente (retorna novos atributos)
app.get('/api/agenda', async (req, res) => {
  try {
    const events = await db.all(`
      SELECT 
        e.id,
        e.activity_id,
        e.title,
        e.description,
        e.event_date,
        e.start_time,
        e.end_time,
        e.duration_hours,
        e.is_completed,
        e.priority,
        e.cognitive_load,
        e.event_color,
        a.title as activity_title
      FROM agenda_events e
      JOIN activities a ON e.activity_id = a.id
      ORDER BY e.event_date ASC, e.start_time ASC
    `);
    res.json(events);
  } catch (error) {
    console.error('Erro ao buscar agenda:', error);
    res.status(500).json({ error: 'Erro ao buscar compromissos na agenda.' });
  }
});

// 7. GET /api/activities/:activity_id/agenda — Buscar compromissos de uma categoria
app.get('/api/activities/:activity_id/agenda', async (req, res) => {
  const { activity_id } = req.params;
  try {
    const events = await db.all(`
      SELECT 
        id,
        activity_id,
        title,
        description,
        event_date,
        start_time,
        end_time,
        duration_hours,
        is_completed,
        priority,
        cognitive_load,
        event_color
      FROM agenda_events
      WHERE activity_id = ?
      ORDER BY event_date ASC, start_time ASC
    `, [activity_id]);
    res.json(events);
  } catch (error) {
    console.error('Erro ao buscar compromissos da atividade:', error);
    res.status(500).json({ error: 'Erro ao buscar compromissos desta atividade.' });
  }
});

// 8. POST /api/agenda — Criar um compromisso na agenda (incluindo priority, load, color)
app.post('/api/agenda', async (req, res) => {
  const { activity_id, title, description, event_date, start_time, end_time, is_completed, priority, cognitive_load, event_color } = req.body;

  if (!activity_id || !title || !event_date || !start_time || !end_time) {
    return res.status(400).json({ error: 'Os campos activity_id, title, event_date, start_time e end_time são obrigatórios.' });
  }

  const durationHours = calculateDuration(start_time, end_time);
  const completedVal = is_completed ? 1 : 0;
  const prioVal = priority || 'media';
  const loadVal = cognitive_load !== undefined ? parseInt(cognitive_load) : 1;
  const colorVal = event_color || null;

  try {
    const result = await db.run(`
      INSERT INTO agenda_events (activity_id, title, description, event_date, start_time, end_time, duration_hours, is_completed, priority, cognitive_load, event_color)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [activity_id, title, description || '', event_date, start_time, end_time, durationHours, completedVal, prioVal, loadVal, colorVal]);

    // Sincronizar acumuladores de timeframes da atividade
    await syncTimeframesForActivity(activity_id);

    const newEvent = await db.get('SELECT * FROM agenda_events WHERE id = ?', [result.lastID]);
    res.status(201).json({ message: 'Compromisso agendado com sucesso!', event: newEvent });
  } catch (error) {
    console.error('Erro ao criar compromisso:', error);
    res.status(500).json({ error: 'Erro ao criar compromisso no banco de dados.' });
  }
});

// 9. PUT /api/agenda/:id — Atualizar compromisso na agenda (incluindo priority, load, color)
app.put('/api/agenda/:id', async (req, res) => {
  const { id } = req.params;
  const { title, description, event_date, start_time, end_time, is_completed, priority, cognitive_load, event_color } = req.body;

  try {
    const event = await db.get('SELECT activity_id FROM agenda_events WHERE id = ?', [id]);
    if (!event) {
      return res.status(404).json({ error: 'Compromisso não encontrado.' });
    }

    // Se vier apenas is_completed no payload (atualização rápida do checkbox)
    if (is_completed !== undefined && !title) {
      const completedVal = is_completed ? 1 : 0;
      await db.run('UPDATE agenda_events SET is_completed = ? WHERE id = ?', [completedVal, id]);
      const updatedEvent = await db.get('SELECT * FROM agenda_events WHERE id = ?', [id]);
      return res.json({ message: 'Status do compromisso atualizado!', event: updatedEvent });
    }

    // Atualização completa do modal
    if (!title || !event_date || !start_time || !end_time) {
      return res.status(400).json({ error: 'Os campos title, event_date, start_time e end_time são obrigatórios.' });
    }

    const durationHours = calculateDuration(start_time, end_time);
    const completedVal = is_completed ? 1 : 0;
    const prioVal = priority || 'media';
    const loadVal = cognitive_load !== undefined ? parseInt(cognitive_load) : 1;
    const colorVal = event_color || null;

    await db.run(`
      UPDATE agenda_events
      SET title = ?, description = ?, event_date = ?, start_time = ?, end_time = ?, duration_hours = ?, is_completed = ?, priority = ?, cognitive_load = ?, event_color = ?
      WHERE id = ?
    `, [title, description || '', event_date, start_time, end_time, durationHours, completedVal, prioVal, loadVal, colorVal, id]);

    // Sincronizar acumuladores de timeframes da atividade correspondente
    await syncTimeframesForActivity(event.activity_id);

    const updatedEvent = await db.get('SELECT * FROM agenda_events WHERE id = ?', [id]);
    res.json({ message: 'Compromisso atualizado com sucesso!', event: updatedEvent });
  } catch (error) {
    console.error('Erro ao atualizar compromisso:', error);
    res.status(500).json({ error: 'Erro ao atualizar compromisso no banco de dados.' });
  }
});

// 10. DELETE /api/agenda/:id — Excluir compromisso da agenda
app.delete('/api/agenda/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const event = await db.get('SELECT activity_id FROM agenda_events WHERE id = ?', [id]);
    if (!event) {
      return res.status(404).json({ error: 'Compromisso não encontrado.' });
    }

    await db.run('DELETE FROM agenda_events WHERE id = ?', [id]);

    // Recalcular horas agregadas da atividade
    await syncTimeframesForActivity(event.activity_id);

    res.json({ message: 'Compromisso removido com sucesso!' });
  } catch (error) {
    console.error('Erro ao excluir compromisso:', error);
    res.status(500).json({ error: 'Erro ao excluir compromisso do banco de dados.' });
  }
});

// 11. POST /api/settings/reset — Restaurar banco de dados original (Seed)
app.post('/api/settings/reset', async (req, res) => {
  try {
    // Apagar tabelas
    await db.exec('DROP TABLE IF EXISTS agenda_events');
    await db.exec('DROP TABLE IF EXISTS goals');
    await db.exec('DROP TABLE IF EXISTS timeframes');
    await db.exec('DROP TABLE IF EXISTS profile_data');
    await db.exec('DROP TABLE IF EXISTS activities');

    // Inicializar novamente
    await initializeDatabase();

    res.json({ message: 'Banco de dados restaurado com sucesso!' });
  } catch (error) {
    console.error('Erro ao resetar banco de dados:', error);
    res.status(500).json({ error: 'Erro ao restaurar o banco de dados.' });
  }
});

// ============================================================
// KPIS DO DASHBOARD
// ============================================================

app.get('/api/dashboard/kpis', async (req, res) => {
  try {
    const dailyTotal = await db.get(
      'SELECT COALESCE(SUM(current), 0) as total FROM timeframes WHERE type = ?',
      ['daily']
    );

    const weeklyTotal = await db.get(
      'SELECT COALESCE(SUM(current), 0) as total FROM timeframes WHERE type = ?',
      ['weekly']
    );

    const weeklyGoals = await db.get(
      'SELECT COALESCE(SUM(target_hours), 0) as total FROM goals WHERE type = ?',
      ['weekly']
    );

    const weeklyGoalPercent = weeklyGoals.total > 0
      ? Math.min(Math.round((weeklyTotal.total / weeklyGoals.total) * 100), 100)
      : 0;

    const activityCount = await db.get('SELECT COUNT(*) as count FROM activities');

    res.json({
      dailyTotal: dailyTotal.total,
      weeklyTotal: weeklyTotal.total,
      weeklyGoalPercent: weeklyGoalPercent,
      activityCount: activityCount.count
    });
  } catch (error) {
    console.error('Erro ao calcular KPIs:', error);
    res.status(500).json({ error: 'Erro ao calcular KPIs do dashboard.' });
  }
});

// Fallback — servir o index.html para demais rotas
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ============================================================
// INICIALIZAÇÃO
// ============================================================

initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor rodando com sucesso em http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Falha ao inicializar o banco de dados:', err);
});

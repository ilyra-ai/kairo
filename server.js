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
app.use(express.json());

// Servindo arquivos estáticos do frontend
app.use(express.static(__dirname));

let db;

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

  // Seed inicial se o banco estiver vazio
  const count = await db.get('SELECT COUNT(*) as count FROM activities');
  if (count.count === 0) {
    console.log('Banco de dados vazio. Iniciando seed a partir de data.json...');
    try {
      const rawData = await fs.readFile(path.join(__dirname, 'data.json'), 'utf-8');
      const data = JSON.parse(rawData);

      for (const item of data) {
        const result = await db.run(
          'INSERT OR IGNORE INTO activities (title) VALUES (?)',
          [item.title]
        );
        const activityId = result.lastID || (await db.get('SELECT id FROM activities WHERE title = ?', [item.title])).id;

        for (const [timeframe, values] of Object.entries(item.timeframes)) {
          await db.run(
            'INSERT OR REPLACE INTO timeframes (activity_id, type, current, previous) VALUES (?, ?, ?, ?)',
            [activityId, timeframe, values.current, values.previous]
          );
        }
      }
      console.log('Seed realizado com sucesso!');
    } catch (err) {
      console.error('Erro ao popular banco de dados:', err);
    }
  }
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

// 3. PUT /api/activities/:id — Atualizar horas de uma atividade
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

// 5. GET /api/activities/:id/goals — Obter metas de uma atividade
app.get('/api/activities/:id/goals', async (req, res) => {
  const { id } = req.params;
  try {
    const goals = await db.all(
      'SELECT type, target_hours FROM goals WHERE activity_id = ?',
      [id]
    );

    const goalsObj = {};
    goals.forEach(g => {
      goalsObj[g.type] = g.target_hours;
    });

    res.json(goalsObj);
  } catch (error) {
    console.error('Erro ao buscar metas:', error);
    res.status(500).json({ error: 'Erro ao buscar metas no banco de dados.' });
  }
});

// 6. DELETE /api/activities/:id — Excluir uma atividade e dados relacionados
app.delete('/api/activities/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const activity = await db.get('SELECT id, title FROM activities WHERE id = ?', [id]);
    if (!activity) {
      return res.status(404).json({ error: 'Atividade não encontrada.' });
    }

    // Exclusão em cascata (timeframes e goals são removidos automaticamente pela FK)
    await db.run('DELETE FROM activities WHERE id = ?', [id]);

    res.json({ message: `Atividade "${activity.title}" excluída com sucesso!` });
  } catch (error) {
    console.error('Erro ao excluir atividade:', error);
    res.status(500).json({ error: 'Erro ao excluir atividade do banco de dados.' });
  }
});

// 7. GET /api/dashboard/kpis — KPIs globais para o sidebar
app.get('/api/dashboard/kpis', async (req, res) => {
  try {
    // Total de horas diárias (hoje)
    const dailyTotal = await db.get(
      'SELECT COALESCE(SUM(current), 0) as total FROM timeframes WHERE type = ?',
      ['daily']
    );

    // Total de horas semanais
    const weeklyTotal = await db.get(
      'SELECT COALESCE(SUM(current), 0) as total FROM timeframes WHERE type = ?',
      ['weekly']
    );

    // Total de metas semanais definidas
    const weeklyGoals = await db.get(
      'SELECT COALESCE(SUM(target_hours), 0) as total FROM goals WHERE type = ?',
      ['weekly']
    );

    // Porcentagem de meta semanal cumprida
    const weeklyGoalPercent = weeklyGoals.total > 0
      ? Math.min(Math.round((weeklyTotal.total / weeklyGoals.total) * 100), 100)
      : 0;

    // Total de atividades cadastradas
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

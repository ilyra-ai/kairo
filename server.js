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

// Inicializa o banco de dados SQLite e realiza o Seed
async function initializeDatabase() {
  db = await open({
    filename: path.join(__dirname, 'database.sqlite'),
    driver: sqlite3.Database
  });

  // Criar tabelas reais e estruturadas
  await db.exec(`
    CREATE TABLE IF NOT EXISTS activities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT UNIQUE NOT NULL
    );
  `);

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

  // Seed se as atividades estiverem vazias
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

// Endpoints da API REST
// 1. Obter todas as atividades e seus respectivos timeframes
app.get('/api/activities', async (req, res) => {
  try {
    const rows = await db.all(`
      SELECT 
        a.id as activity_id,
        a.title,
        t.type,
        t.current,
        t.previous
      FROM activities a
      JOIN timeframes t ON a.id = t.activity_id
    `);

    // Estruturando os dados retornados no mesmo formato que o frontend espera (idêntico ao data.json original)
    const result = [];
    const activitiesMap = {};

    rows.forEach(row => {
      if (!activitiesMap[row.title]) {
        activitiesMap[row.title] = {
          id: row.activity_id,
          title: row.title,
          timeframes: {}
        };
        result.push(activitiesMap[row.title]);
      }
      activitiesMap[row.title].timeframes[row.type] = {
        current: row.current,
        previous: row.previous
      };
    });

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar atividades no banco de dados.' });
  }
});

// 2. Atualizar o tempo de uma atividade específica
app.put('/api/activities/:id', async (req, res) => {
  const { id } = req.params;
  const { timeframe, current, previous } = req.body;

  if (!timeframe || current === undefined || previous === undefined) {
    return res.status(400).json({ error: 'Parâmetros timeframe, current e previous são obrigatórios.' });
  }

  try {
    const result = await db.run(
      'UPDATE timeframes SET current = ?, previous = ? WHERE activity_id = ? AND type = ?',
      [current, previous, id, timeframe]
    );

    if (result.changes === 0) {
      return res.status(404).json({ error: 'Atividade ou timeframe não encontrados.' });
    }

    res.json({ message: 'Atividade atualizada com sucesso!' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao atualizar dados no banco de dados.' });
  }
});

// Tratamento padrão para servir o index.html nas demais rotas
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Inicializando banco e subindo servidor
initializeDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor rodando com sucesso em http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Falha ao inicializar o banco de dados:', err);
});

// ============================================================================
// Kairo — Construtor de gráficos personalizados por usuário (Tarefa 21)
// ============================================================================
//
// Persiste, por usuário, definições de gráficos (fonte, dimensão, métrica,
// agregação e visual) na tabela `user_charts`. A renderização e a prévia
// reutilizam o catálogo seguro e o executor do serviço de analytics — nenhuma
// expressão SQL vem do cliente.

import { CATALOGO_DE_GRAFICOS } from '../analytics/analytics.service.js';
import { conflict, notFound, unprocessable } from '../../shared/http-error.js';

const TIPOS_VISUAIS = Object.freeze(['bars', 'columns', 'donut', 'lines', 'kpi', 'funnel']);

export function ensureChartsSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_charts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 120),
      source TEXT NOT NULL,
      dimension TEXT NOT NULL,
      metric TEXT NOT NULL,
      aggregate TEXT NOT NULL,
      chart_type TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_charts_owner
      ON user_charts (user_id, position, id);
  `);
}

function validarDefinicao(definicao) {
  const fonte = CATALOGO_DE_GRAFICOS.sources[definicao.source];
  if (!fonte) throw unprocessable('Fonte de dados inválida.', 'FONTE_INVALIDA');
  if (!fonte.dimensions[definicao.dimension]) {
    throw unprocessable('Dimensão inválida para a fonte escolhida.', 'DIMENSAO_INVALIDA');
  }
  const metrica = fonte.metrics[definicao.metric];
  if (!metrica) {
    throw unprocessable('Métrica inválida para a fonte escolhida.', 'METRICA_INVALIDA');
  }
  if (!metrica.aggregates.includes(definicao.aggregate)) {
    throw unprocessable(
      'A agregação escolhida é incompatível com a métrica.',
      'AGREGACAO_INCOMPATIVEL'
    );
  }
  if (!TIPOS_VISUAIS.includes(definicao.chart_type)) {
    throw unprocessable('Tipo de gráfico inválido.', 'TIPO_GRAFICO_INVALIDO');
  }
}

function serialize(row) {
  return {
    id: Number(row.id),
    title: row.title,
    source: row.source,
    dimension: row.dimension,
    metric: row.metric,
    aggregate: row.aggregate,
    chart_type: row.chart_type,
    position: Number(row.position),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export function createChartsService({ db, analyticsService }) {
  ensureChartsSchema(db);

  function catalog() {
    // Expõe o catálogo em formato amigável ao frontend (sem expressões SQL).
    const sources = {};
    for (const [chave, fonte] of Object.entries(CATALOGO_DE_GRAFICOS.sources)) {
      sources[chave] = {
        label: fonte.label,
        dimensions: Object.fromEntries(
          Object.entries(fonte.dimensions).map(([k, v]) => [k, { label: v.label }])
        ),
        metrics: Object.fromEntries(
          Object.entries(fonte.metrics).map(([k, v]) => [
            k,
            { label: v.label, aggregates: v.aggregates }
          ])
        )
      };
    }
    return { sources, chart_types: TIPOS_VISUAIS };
  }

  function list(userId) {
    return db
      .all(`SELECT * FROM user_charts WHERE user_id = ? ORDER BY position ASC, id ASC`, [userId])
      .map(serialize);
  }

  // Renderiza o gráfico com dados reais e agregação segura.
  function render(userId, chartId) {
    const chart = db.get('SELECT * FROM user_charts WHERE id = ? AND user_id = ?', [
      chartId,
      userId
    ]);
    if (!chart) throw notFound('Gráfico não encontrado.', 'GRAFICO_NAO_ENCONTRADO');
    return { chart: serialize(chart), data: analyticsService.runChartQuery(userId, chart) };
  }

  // Prévia sem persistir — alimenta o construtor em tempo real.
  function preview(userId, definicao) {
    validarDefinicao(definicao);
    return { data: analyticsService.runChartQuery(userId, definicao) };
  }

  function create(userId, input) {
    validarDefinicao(input);
    const proximaPosicao = Number(
      db.get(
        'SELECT COALESCE(MAX(position), -1) + 1 AS proxima FROM user_charts WHERE user_id = ?',
        [userId]
      ).proxima
    );
    const result = db.run(
      `INSERT INTO user_charts
         (user_id, title, source, dimension, metric, aggregate, chart_type, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        input.title,
        input.source,
        input.dimension,
        input.metric,
        input.aggregate,
        input.chart_type,
        proximaPosicao
      ]
    );
    return serialize(db.get('SELECT * FROM user_charts WHERE id = ?', [result.lastID]));
  }

  function update(userId, chartId, input) {
    const atual = db.get('SELECT * FROM user_charts WHERE id = ? AND user_id = ?', [
      chartId,
      userId
    ]);
    if (!atual) throw notFound('Gráfico não encontrado.', 'GRAFICO_NAO_ENCONTRADO');

    const proxima = {
      title: input.title ?? atual.title,
      source: input.source ?? atual.source,
      dimension: input.dimension ?? atual.dimension,
      metric: input.metric ?? atual.metric,
      aggregate: input.aggregate ?? atual.aggregate,
      chart_type: input.chart_type ?? atual.chart_type
    };
    validarDefinicao(proxima);

    db.run(
      `UPDATE user_charts
          SET title = ?, source = ?, dimension = ?, metric = ?, aggregate = ?,
              chart_type = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?`,
      [
        proxima.title,
        proxima.source,
        proxima.dimension,
        proxima.metric,
        proxima.aggregate,
        proxima.chart_type,
        chartId,
        userId
      ]
    );
    return serialize(db.get('SELECT * FROM user_charts WHERE id = ?', [chartId]));
  }

  // Duplica um gráfico existente, posicionando-o ao final da lista.
  function duplicate(userId, chartId) {
    const original = db.get('SELECT * FROM user_charts WHERE id = ? AND user_id = ?', [
      chartId,
      userId
    ]);
    if (!original) throw notFound('Gráfico não encontrado.', 'GRAFICO_NAO_ENCONTRADO');
    return create(userId, {
      title: `${original.title} (cópia)`,
      source: original.source,
      dimension: original.dimension,
      metric: original.metric,
      aggregate: original.aggregate,
      chart_type: original.chart_type
    });
  }

  // Reordena os gráficos do usuário conforme a lista de ids fornecida.
  function reorder(userId, orderedIds) {
    const doUsuario = db
      .all('SELECT id FROM user_charts WHERE user_id = ?', [userId])
      .map((row) => Number(row.id));
    const conjunto = new Set(doUsuario);
    if (
      orderedIds.length !== doUsuario.length ||
      !orderedIds.every((id) => conjunto.has(Number(id)))
    ) {
      throw conflict(
        'A lista de reordenação não corresponde aos seus gráficos.',
        'REORDENACAO_INVALIDA'
      );
    }
    db.transaction(() => {
      orderedIds.forEach((id, indice) => {
        db.run(
          'UPDATE user_charts SET position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
          [indice, Number(id), userId]
        );
      });
    });
    return list(userId);
  }

  function remove(userId, chartId) {
    const existe = db.get('SELECT id FROM user_charts WHERE id = ? AND user_id = ?', [
      chartId,
      userId
    ]);
    if (!existe) throw notFound('Gráfico não encontrado.', 'GRAFICO_NAO_ENCONTRADO');
    db.run('DELETE FROM user_charts WHERE id = ? AND user_id = ?', [chartId, userId]);
    return { deleted: true };
  }

  return { catalog, create, duplicate, list, preview, remove, render, reorder, update };
}

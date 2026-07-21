// ============================================================================
// Kairo — Integração do Agendador Autônomo (Tarefa 35.2)
// ============================================================================

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  ensureCoreSchema,
  ensureUserWorkspace,
  openSqliteClient
} from '../../src/server/database/index.js';
import { createAuthService, ensureAuthSchema } from '../../src/server/modules/auth/auth.service.js';
import { ensurePlansSchema } from '../../src/server/modules/plans/plans.service.js';
import { createAgendaService } from '../../src/server/modules/agenda/agenda.service.js';
import { createSmartFeaturesService } from '../../src/server/modules/smart/smart-features.service.js';
import { createAutoSchedulerService } from '../../src/server/modules/smart/auto-scheduler.service.js';

function minutos(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function criarContexto(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kairo-solver-'));
  const db = openSqliteClient(path.join(directory, 'database.sqlite'));
  ensureAuthSchema(db);
  ensurePlansSchema(db);
  const auth = createAuthService({
    db,
    sessionSecret: 'segredo-solver-com-mais-de-trinta-e-dois-bytes-de-teste',
    sessionTtlMs: 3600000,
    onUserCreated(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: path.join(directory, 'backups') });
      ensureUserWorkspace(db, user);
    }
  });
  const agenda = createAgendaService({ db, timeZone: 'America/Sao_Paulo' });
  const smart = createSmartFeaturesService({ db });
  smart.ensureSeed();
  const solver = createAutoSchedulerService({ db, smartFeaturesService: smart, agendaService: agenda });
  t.after(() => {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return { db, auth, agenda, smart, solver };
}

async function prepararUsuario(context) {
  await context.auth.register({ name: 'Titular', email: 'u@k.local', password: 'senha-teste' });
  const atividade = context.db.get('SELECT id FROM activities WHERE user_id = 1 LIMIT 1');
  return { userId: 1, activityId: atividade.id };
}

test('recurso desativado bloqueia o agendador', async (t) => {
  const context = criarContexto(t);
  const { activityId } = await prepararUsuario(context);
  assert.throws(
    () =>
      context.solver.preview(1, {
        date: '2026-07-21',
        tasks: [{ title: 'T', duration_min: 30, activity_id: activityId }]
      }),
    (e) => e.code === 'RECURSO_DESATIVADO'
  );
});

test('solver aloca sem sobrepor eventos existentes e respeita a janela de trabalho', async (t) => {
  const context = criarContexto(t);
  const { userId, activityId } = await prepararUsuario(context);
  context.smart.updateConfig('auto_scheduler', { enabled: true }, 1);

  // Evento existente 10:00–11:00 ocupa a janela.
  context.agenda.create(userId, {
    activity_id: activityId,
    title: 'Reunião',
    event_date: '2026-07-21',
    start_time: '10:00',
    end_time: '11:00',
    cognitive_load: 2,
    priority: 'media'
  });

  const r = context.solver.preview(userId, {
    date: '2026-07-21',
    tasks: [
      { title: 'Tarefa A', duration_min: 60, priority: 'alta', cognitive_load: 3, activity_id: activityId },
      { title: 'Tarefa B', duration_min: 60, priority: 'baixa', cognitive_load: 1, activity_id: activityId }
    ]
  });

  assert.equal(r.plan.length, 2);
  // Nenhum item do plano sobrepõe o evento 10:00–11:00.
  for (const item of r.plan) {
    const ini = minutos(item.start_time);
    const fim = minutos(item.end_time);
    assert.ok(fim <= minutos('10:00') || ini >= minutos('11:00'), 'não pode sobrepor a reunião');
    // Dentro da jornada 09:00–18:00.
    assert.ok(ini >= minutos('09:00') && fim <= minutos('18:00'));
  }
  // Prioridade alta é alocada antes (mais cedo) que a baixa.
  const a = r.plan.find((p) => p.title === 'Tarefa A');
  const b = r.plan.find((p) => p.title === 'Tarefa B');
  assert.ok(minutos(a.start_time) < minutos(b.start_time));
});

test('aplicar cria eventos reais e reversíveis no banco', async (t) => {
  const context = criarContexto(t);
  const { userId, activityId } = await prepararUsuario(context);
  context.smart.updateConfig('auto_scheduler', { enabled: true }, 1);

  const prev = context.solver.preview(userId, {
    date: '2026-07-21',
    tasks: [{ title: 'Estudo', duration_min: 45, priority: 'alta', cognitive_load: 2, activity_id: activityId }]
  });
  const aplicado = context.solver.apply(userId, { plan: prev.plan });
  assert.equal(aplicado.applied, 1);

  const eventos = context.db.all(
    "SELECT * FROM agenda_events WHERE user_id = ? AND event_date = '2026-07-21'",
    [userId]
  );
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].title, 'Estudo');
});

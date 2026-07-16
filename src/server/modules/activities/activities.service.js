// ============================================================================
// Kairo — Serviço de atividades, períodos e metas isolados por usuário
// ============================================================================

import { conflict, notFound } from '../../shared/http-error.js';

const INITIAL_TIMEFRAMES_SQL = `
  INSERT INTO timeframes (activity_id, type, current, previous)
  SELECT activities.id, periods.type, 0, 0
  FROM activities
  CROSS JOIN (
    SELECT 'daily' AS type
    UNION ALL SELECT 'weekly'
    UNION ALL SELECT 'monthly'
  ) AS periods
  WHERE activities.id = ? AND activities.user_id = ?
`;

function activityNotFound() {
  return notFound('Atividade não encontrada.', 'ATIVIDADE_NAO_ENCONTRADA');
}

function emptyActivity(activity) {
  return {
    id: Number(activity.id),
    title: activity.title,
    timeframes: {},
    goals: {}
  };
}

function assembleActivities(activityRows, timeframeRows, goalRows) {
  const activitiesById = new Map(
    activityRows.map((activity) => {
      const serialized = emptyActivity(activity);
      return [serialized.id, serialized];
    })
  );

  for (const timeframe of timeframeRows) {
    const activity = activitiesById.get(Number(timeframe.activity_id));
    if (!activity) continue;
    activity.timeframes[timeframe.type] = {
      current: Number(timeframe.current),
      previous: Number(timeframe.previous)
    };
  }

  for (const goal of goalRows) {
    const activity = activitiesById.get(Number(goal.activity_id));
    if (!activity) continue;
    activity.goals[goal.type] = Number(goal.target_hours);
  }

  return [...activitiesById.values()];
}

function loadActivity(db, userId, activityId) {
  const activity = db.get(
    `SELECT activities.id, activities.title
     FROM activities
     WHERE activities.id = ? AND activities.user_id = ?`,
    [activityId, userId]
  );
  if (!activity) throw activityNotFound();

  const timeframes = db.all(
    `SELECT timeframes.activity_id, timeframes.type, timeframes.current, timeframes.previous
     FROM timeframes
     INNER JOIN activities ON activities.id = timeframes.activity_id
     WHERE activities.id = ? AND activities.user_id = ?
     ORDER BY timeframes.id`,
    [activityId, userId]
  );
  const goals = db.all(
    `SELECT goals.activity_id, goals.type, goals.target_hours
     FROM goals
     INNER JOIN activities ON activities.id = goals.activity_id
     WHERE activities.id = ? AND activities.user_id = ?
     ORDER BY goals.id`,
    [activityId, userId]
  );

  return assembleActivities([activity], timeframes, goals)[0];
}

function isDuplicateActivity(error) {
  return error?.code === 'SQLITE_CONSTRAINT_UNIQUE'
    && String(error.message).includes('activities.user_id')
    && String(error.message).includes('activities.title');
}

export function createActivitiesService(db) {
  function list(userId) {
    const activities = db.all(
      `SELECT activities.id, activities.title
       FROM activities
       WHERE activities.user_id = ?
       ORDER BY activities.id`,
      [userId]
    );
    const timeframes = db.all(
      `SELECT timeframes.activity_id, timeframes.type, timeframes.current, timeframes.previous
       FROM timeframes
       INNER JOIN activities ON activities.id = timeframes.activity_id
       WHERE activities.user_id = ?
       ORDER BY timeframes.activity_id, timeframes.id`,
      [userId]
    );
    const goals = db.all(
      `SELECT goals.activity_id, goals.type, goals.target_hours
       FROM goals
       INNER JOIN activities ON activities.id = goals.activity_id
       WHERE activities.user_id = ?
       ORDER BY goals.activity_id, goals.id`,
      [userId]
    );

    return assembleActivities(activities, timeframes, goals);
  }

  function getDetails(userId, activityId) {
    return loadActivity(db, userId, activityId);
  }

  function create(userId, input) {
    try {
      return db.transaction((transactionDb) => {
        const inserted = transactionDb.run(
          'INSERT INTO activities (user_id, title) VALUES (?, ?)',
          [userId, input.title]
        );
        const initialized = transactionDb.run(
          INITIAL_TIMEFRAMES_SQL,
          [inserted.lastID, userId]
        );
        if (initialized.changes !== 3) {
          throw new Error('A atividade não recebeu os três períodos iniciais obrigatórios.');
        }
        return loadActivity(transactionDb, userId, inserted.lastID);
      });
    } catch (error) {
      if (isDuplicateActivity(error)) {
        throw conflict(
          'Já existe uma atividade com este título na sua conta.',
          'ATIVIDADE_DUPLICADA'
        );
      }
      throw error;
    }
  }

  function updateTimeframe(userId, activityId, input) {
    const result = db.run(
      `INSERT INTO timeframes (activity_id, type, current, previous)
       SELECT activities.id, ?, ?, ?
       FROM activities
       WHERE activities.id = ? AND activities.user_id = ?
       ON CONFLICT(activity_id, type) DO UPDATE SET
         current = excluded.current,
         previous = excluded.previous`,
      [input.timeframe, input.current, input.previous, activityId, userId]
    );
    if (result.changes === 0) throw activityNotFound();

    return {
      activity_id: Number(activityId),
      type: input.timeframe,
      current: Number(input.current),
      previous: Number(input.previous)
    };
  }

  function updateGoal(userId, activityId, input) {
    const result = db.run(
      `INSERT INTO goals (activity_id, type, target_hours)
       SELECT activities.id, ?, ?
       FROM activities
       WHERE activities.id = ? AND activities.user_id = ?
       ON CONFLICT(activity_id, type) DO UPDATE SET
         target_hours = excluded.target_hours`,
      [input.timeframe, input.target_hours, activityId, userId]
    );
    if (result.changes === 0) throw activityNotFound();

    return {
      activity_id: Number(activityId),
      type: input.timeframe,
      target_hours: Number(input.target_hours)
    };
  }

  function remove(userId, activityId) {
    return db.transaction((transactionDb) => {
      const activity = transactionDb.get(
        `SELECT activities.id, activities.title
         FROM activities
         WHERE activities.id = ? AND activities.user_id = ?`,
        [activityId, userId]
      );
      if (!activity) throw activityNotFound();

      const linkedEvents = Number(transactionDb.get(
        `SELECT COUNT(*) AS total
         FROM agenda_events
         INNER JOIN activities
           ON activities.id = agenda_events.activity_id
          AND activities.user_id = agenda_events.user_id
         WHERE agenda_events.activity_id = ?
           AND agenda_events.user_id = ?
           AND activities.user_id = ?`,
        [activityId, userId, userId]
      ).total);

      const deleted = transactionDb.run(
        `DELETE FROM activities
         WHERE activities.id = ? AND activities.user_id = ?`,
        [activityId, userId]
      );
      if (deleted.changes !== 1) throw activityNotFound();

      return {
        id: Number(activity.id),
        title: activity.title,
        deleted_events: linkedEvents
      };
    });
  }

  return { create, getDetails, list, remove, updateGoal, updateTimeframe };
}

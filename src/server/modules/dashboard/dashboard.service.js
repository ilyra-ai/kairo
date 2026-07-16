// ============================================================================
// Kairo — Indicadores do dashboard isolados por usuário
// ============================================================================

export function createDashboardService(db) {
  function getKpis(userId) {
    const totals = db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN timeframes.type = 'daily' THEN timeframes.current ELSE 0 END), 0) AS daily_total,
         COALESCE(SUM(CASE WHEN timeframes.type = 'weekly' THEN timeframes.current ELSE 0 END), 0) AS weekly_total
       FROM activities
       LEFT JOIN timeframes ON timeframes.activity_id = activities.id
       WHERE activities.user_id = ?`,
      [userId]
    );
    const goals = db.get(
      `SELECT COALESCE(SUM(goals.target_hours), 0) AS weekly_goals
       FROM activities
       LEFT JOIN goals ON goals.activity_id = activities.id AND goals.type = 'weekly'
       WHERE activities.user_id = ?`,
      [userId]
    );
    const activities = db.get(
      'SELECT COUNT(*) AS activity_count FROM activities WHERE user_id = ?',
      [userId]
    );

    const weeklyTotal = Number(totals.weekly_total);
    const weeklyGoal = Number(goals.weekly_goals);
    return {
      dailyTotal: Number(totals.daily_total),
      weeklyTotal,
      weeklyGoalPercent:
        weeklyGoal > 0 ? Math.min(Math.round((weeklyTotal / weeklyGoal) * 100), 100) : 0,
      activityCount: Number(activities.activity_count)
    };
  }

  return { getKpis };
}

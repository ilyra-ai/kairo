// ============================================================================
// Kairo — Inicialização transacional dos serviços e do banco de dados
// ============================================================================

import path from 'node:path';
import { createApp } from './app.js';
import { env } from './config/env.js';
import { BACKUPS_DIR, PROJECT_ROOT, ensureRuntimeDirectories } from './config/paths.js';
import {
  ensureAllUserWorkspaces,
  ensureCoreSchema,
  ensureUserWorkspace,
  inspectCoreSchema,
  openKairoDatabase,
  resetUserWorkspace
} from './database/index.js';
import { relocateLegacyDatabase, resolveMigrationOwner } from './database/bootstrap.js';
import { createAuthenticationMiddleware } from './middleware/authentication.js';
import { createRateLimiters } from './middleware/rate-limit.js';
import { createActivitiesService } from './modules/activities/activities.service.js';
import { createAgendaService } from './modules/agenda/agenda.service.js';
import { createAiService } from './modules/ai/ai.service.js';
import { createAiTrainingService } from './modules/ai/ai-training.service.js';
import { createAnalyticsService } from './modules/analytics/analytics.service.js';
import { createChartsService } from './modules/charts/charts.service.js';
import { createAuthService, ensureAuthSchema } from './modules/auth/auth.service.js';
import { createDashboardService } from './modules/dashboard/dashboard.service.js';
import { createEnergyService } from './modules/energy/energy.service.js';
import { createGoogleCalendarService } from './modules/integrations/google-calendar/google-calendar.service.js';
import {
  createPlansService,
  ensurePlansSchema,
  normalizePlanFeaturePreferences
} from './modules/plans/plans.service.js';
import { createPrivacyService } from './modules/privacy/privacy.service.js';
import { createProfileService } from './modules/profile/profile.service.js';
import { createRewardsService, ensureRewardsSchema } from './modules/rewards/rewards.service.js';
import { HttpError } from './shared/http-error.js';

const GOOGLE_SERVICE_METHODS = Object.freeze([
  'createAuthorization',
  'deleteEvent',
  'disconnect',
  'getStatus',
  'handleCallback',
  'isConfigured',
  'pushEvent',
  'syncNow'
]);

function deferredGoogleCalendarService(getService) {
  return Object.freeze(
    Object.fromEntries(
      GOOGLE_SERVICE_METHODS.map((methodName) => [
        methodName,
        (...args) => getService()[methodName](...args)
      ])
    )
  );
}

export async function createKairoRuntime(options = {}) {
  const config = options.config ?? env;
  const logger = options.logger ?? console;
  await ensureRuntimeDirectories();

  const legacyDatabasePath = path.join(PROJECT_ROOT, 'database.sqlite');
  const relocation =
    options.relocateLegacy === false
      ? { relocated: false, skipped: true }
      : relocateLegacyDatabase({
          legacyDatabasePath,
          targetDatabasePath: config.databasePath,
          backupsDirectory: BACKUPS_DIR
        });

  const db = openKairoDatabase(PROJECT_ROOT, { filename: config.databasePath });
  let closed = false;

  try {
    ensureAuthSchema(db);
    ensurePlansSchema(db);

    const analyticsService = createAnalyticsService(db);
    const services = {
      activities: createActivitiesService(db),
      agenda: createAgendaService({ db, timeZone: config.google.timezone }),
      analytics: analyticsService,
      charts: createChartsService({ db, analyticsService }),
      dashboard: createDashboardService(db),
      energy: createEnergyService({ db }),
      ai: createAiService({
        db,
        encryptionKey: config.encryptionKey,
        remoteAllowlist: config.ai?.remoteAllowlist ?? []
      }),
      aiTraining: createAiTrainingService({ db }),
      plans: createPlansService(db),
      profile: createProfileService(db),
      rewards: createRewardsService({ db, timeZone: config.google.timezone })
    };

    let domainReady = false;
    let googleCalendarService = null;

    function initializeDomainForUser(user) {
      ensureCoreSchema(db, user.id, { backupDirectory: BACKUPS_DIR });
      const workspace = ensureUserWorkspace(db, user);
      normalizePlanFeaturePreferences(db);
      ensureRewardsSchema(db);
      if (!googleCalendarService) {
        googleCalendarService = createGoogleCalendarService({
          db,
          config: config.google,
          encryptionKey: config.encryptionKey,
          googleClient: options.googleClient,
          agendaService: services.agenda,
          logger
        });
      }
      domainReady = true;
      return workspace;
    }

    const migrationOwner = resolveMigrationOwner(db, config.migrationOwnerEmail);
    if (migrationOwner) {
      initializeDomainForUser(migrationOwner);
      ensureAllUserWorkspaces(db);
    }

    services.auth = createAuthService({
      db,
      sessionSecret: config.sessionSecret,
      sessionTtlMs: config.sessionTtlSeconds * 1000,
      onUserCreated: initializeDomainForUser,
      allowFirstUserBootstrap: true
    });

    // Semente automática do administrador padrão a cada inicialização: garante
    // que a conta administradora exista, esteja ativa e com acesso integral.
    if (config.seedAdmin?.enabled !== false) {
      try {
        const resultado = await services.auth.ensureSeedAdmin({
          name: config.seedAdmin?.name ?? 'Administrador',
          email: config.seedAdmin?.email ?? 'admin@admin.com',
          password: config.seedAdmin?.password ?? 'admin123'
        });
        if (resultado.created) {
          logger.info?.('[Kairo] Administrador padrão criado e ativado automaticamente.');
        }

        // Semente única do pacote inicial de competências de IA (Tarefa 27),
        // versionado, editável e publicado — nunca hardcode espalhado.
        try {
          const admin = db.get(
            "SELECT id FROM users WHERE role = 'administrador' ORDER BY id ASC LIMIT 1"
          );
          const seedComp = services.aiTraining.ensureSeedCompetencies(admin?.id ?? null);
          if (seedComp.seeded) {
            logger.info?.(`[Kairo] ${seedComp.count} competências de IA semeadas e publicadas.`);
          }
        } catch (error) {
          logger.error?.('[Kairo] Falha ao semear competências de IA:', error.message);
        }
      } catch (error) {
        logger.error?.('[Kairo] Falha ao garantir o administrador padrão:', error.message);
        throw error;
      }
    }

    services.privacy = createPrivacyService({
      db,
      authService: services.auth,
      googleCalendarService: {
        disconnect: (userId) => {
          if (!googleCalendarService) return null;
          return googleCalendarService.disconnect(userId);
        }
      }
    });

    services.googleCalendar = deferredGoogleCalendarService(() => {
      if (!googleCalendarService) {
        throw new HttpError(
          503,
          'CONFIGURACAO_INICIAL_NECESSARIA',
          'Conclua a criação da primeira conta administrativa antes de acessar integrações.'
        );
      }
      return googleCalendarService;
    });

    const authentication = createAuthenticationMiddleware({
      authService: services.auth,
      cookieName: config.cookie.name
    });
    const rateLimiters = createRateLimiters(options.rateLimits);

    function domainStatus() {
      const bootstrapRequired = services.auth.bootstrapRequired();
      const schema = inspectCoreSchema(db);
      return {
        bootstrapRequired,
        ready: domainReady && schema.valid
      };
    }

    const app = createApp({
      config,
      services,
      authentication,
      rateLimiters,
      resetWorkspace: (user) => resetUserWorkspace(db, user),
      domainStatus,
      logger
    });

    function close() {
      if (closed) return;
      closed = true;
      db.close();
    }

    return Object.freeze({
      app,
      close,
      config,
      db,
      domainStatus,
      relocation,
      services
    });
  } catch (error) {
    if (db.open) db.close();
    throw error;
  }
}

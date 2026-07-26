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
import { createAiMemoryService } from './modules/ai/ai-memory.service.js';
import { createAiGovernanceService } from './modules/ai/ai-governance.service.js';
import { createAiAssistantService } from './modules/ai/ai-assistant.service.js';
import { createSmartFeaturesService } from './modules/smart/smart-features.service.js';
import { createEnergyBudgetService } from './modules/smart/energy-budget.service.js';
import { createAutoSchedulerService } from './modules/smart/auto-scheduler.service.js';
import { createBrainDumpService } from './modules/smart/brain-dump.service.js';
import { createPassiveTrackingService } from './modules/smart/passive-tracking.service.js';
import { createTransitionBridgeService } from './modules/smart/transition-bridge.service.js';
import { createEscalatedRemindersService } from './modules/smart/escalated-reminders.service.js';
import { createNowModeService } from './modules/smart/now-mode.service.js';
import { createPredictiveCoachService } from './modules/smart/predictive-coach.service.js';
import { createFocusTimeMachineService } from './modules/smart/focus-time-machine.service.js';
import { createDigitalTwinService } from './modules/smart/digital-twin.service.js';
import { createEmotionalMapService } from './modules/smart/emotional-map.service.js';
import { createShutdownRitualService } from './modules/smart/shutdown-ritual.service.js';
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
import { createPaymentsService } from './modules/payments/payments.service.js';
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
      aiMemory: createAiMemoryService({ db, encryptionKey: config.encryptionKey }),
      aiGovernance: createAiGovernanceService({ db }),
      plans: createPlansService(db),
      profile: createProfileService(db),
      rewards: createRewardsService({ db, timeZone: config.google.timezone })
    };

    // Assistente de IA (Tarefa 16): depende do gateway, treino, memória,
    // governança e dos serviços de atividades/agenda do próprio usuário.
    services.aiAssistant = createAiAssistantService({
      db,
      encryptionKey: config.encryptionKey,
      aiService: services.ai,
      aiTrainingService: services.aiTraining,
      aiMemoryService: services.aiMemory,
      aiGovernanceService: services.aiGovernance,
      activitiesService: services.activities,
      agendaService: services.agenda,
      plansService: services.plans
    });

    // Pagamentos e aplicação real dos planos (Tarefa 13): Stripe Checkout,
    // webhook oficial com corpo bruto, reconciliação e segredos criptografados.
    services.payments = createPaymentsService({
      db,
      plansService: services.plans,
      encryptionKey: config.encryptionKey,
      environment: config.payments,
      stripeClientFactory: options.stripeClientFactory
    });

    // Suíte de Produtividade Inteligente (Tarefa 35): governança administrável.
    services.smartFeatures = createSmartFeaturesService({ db, aiService: services.ai });
    services.energyBudget = createEnergyBudgetService({
      db,
      smartFeaturesService: services.smartFeatures
    });
    services.autoScheduler = createAutoSchedulerService({
      db,
      smartFeaturesService: services.smartFeatures,
      agendaService: services.agenda
    });
    services.brainDump = createBrainDumpService({
      db,
      smartFeaturesService: services.smartFeatures,
      activitiesService: services.activities
    });
    services.passiveTracking = createPassiveTrackingService({
      db,
      smartFeaturesService: services.smartFeatures,
      activitiesService: services.activities
    });
    services.transitionBridge = createTransitionBridgeService({
      db,
      smartFeaturesService: services.smartFeatures
    });
    services.escalatedReminders = createEscalatedRemindersService({
      db,
      smartFeaturesService: services.smartFeatures
    });
    services.nowMode = createNowModeService({
      db,
      smartFeaturesService: services.smartFeatures
    });
    services.predictiveCoach = createPredictiveCoachService({
      db,
      smartFeaturesService: services.smartFeatures
    });
    services.focusTimeMachine = createFocusTimeMachineService({
      db,
      smartFeaturesService: services.smartFeatures
    });
    services.digitalTwin = createDigitalTwinService({
      db,
      smartFeaturesService: services.smartFeatures
    });
    services.emotionalMap = createEmotionalMapService({
      db,
      smartFeaturesService: services.smartFeatures
    });
    services.shutdownRitual = createShutdownRitualService({
      db,
      smartFeaturesService: services.smartFeatures
    });
    try {
      const semeado = services.smartFeatures.ensureSeed();
      if (semeado.seeded) {
        logger.info?.(`[Kairo] ${semeado.count} recursos inteligentes registrados.`);
      }
    } catch (error) {
      logger.error?.('[Kairo] Falha ao semear recursos inteligentes:', error.message);
    }

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
          const seedSkills = services.aiTraining.ensureSeedSkillsWorkflows(admin?.id ?? null);
          if (seedSkills.seeded) {
            logger.info?.(
              `[Kairo] ${seedSkills.count} skills/workflows de IA semeados e publicados.`
            );
          }
          const seedDominio = services.aiTraining.ensureSeedDomainSkills(admin?.id ?? null);
          if (seedDominio.seeded) {
            logger.info?.(
              `[Kairo] ${seedDominio.count} skills de domínio do Kairo semeadas e publicadas.`
            );
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
      },
      paymentsService: services.payments
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

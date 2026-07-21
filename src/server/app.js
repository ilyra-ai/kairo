// ============================================================================
// Kairo — Composição HTTP segura e independente da inicialização do processo
// ============================================================================

import path from 'node:path';
import cookieParser from 'cookie-parser';
import express from 'express';
import { PUBLIC_DIR } from './config/paths.js';
import { apiNotFound, errorHandler, requestIdMiddleware } from './middleware/error-handler.js';
import {
  additionalSecurityHeaders,
  apiNoStore,
  createCorsMiddleware,
  createHelmetMiddleware,
  rejectDisallowedOrigin,
  requireJsonBody
} from './middleware/http-security.js';
import { forbidden } from './shared/http-error.js';
import { createActivitiesRouter } from './modules/activities/activities.routes.js';
import { createAgendaRouter } from './modules/agenda/agenda.routes.js';
import { createAuthRouter } from './modules/auth/auth.routes.js';
import { createUsersRouter } from './modules/auth/users.routes.js';
import { createAnalyticsRouter } from './modules/analytics/analytics.routes.js';
import { createChartsRouter } from './modules/charts/charts.routes.js';
import { createEnergyRouter } from './modules/energy/energy.routes.js';
import { createDashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { createGoogleCalendarRouter } from './modules/integrations/google-calendar/google-calendar.routes.js';
import { createPlansRouter } from './modules/plans/plans.routes.js';
import { createPrivacyRouter } from './modules/privacy/privacy.routes.js';
import { createProfileRouter } from './modules/profile/profile.routes.js';
import { createRewardsRouter } from './modules/rewards/rewards.routes.js';
import { createSettingsRouter } from './modules/settings/settings.routes.js';

const HTML_FILES = Object.freeze({
  landing: path.join(PUBLIC_DIR, 'index.html'),
  login: path.join(PUBLIC_DIR, 'auth', 'index.html'),
  application: path.join(PUBLIC_DIR, 'app', 'index.html')
});

function cookieOptions(configuration) {
  const options = {
    secure: configuration.cookie.secure,
    httpOnly: true,
    sameSite: configuration.cookie.sameSite
  };
  if (configuration.cookie.domain) options.domain = configuration.cookie.domain;
  return options;
}

function htmlResponse(filename) {
  return function sendHtml(_req, res, next) {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(filename, { dotfiles: 'deny' }, (error) => {
      if (error) next(error);
    });
  };
}

function authenticatedPage(authService, cookieName) {
  return function requireAuthenticatedPage(req, res, next) {
    try {
      authService.authenticate(req.cookies?.[cookieName]);
      next();
    } catch {
      res.redirect(303, '/login');
    }
  };
}

function redirectAuthenticatedUser(authService, cookieName) {
  return function redirectIfAuthenticated(req, res, next) {
    try {
      authService.authenticate(req.cookies?.[cookieName]);
      res.redirect(303, '/app');
    } catch {
      next();
    }
  };
}

function featureAuthorization(plansService, featureKey) {
  return function requireFeature(req, _res, next) {
    if (!plansService.planCan(req.user.plan, featureKey, req.user.role)) {
      return next(
        forbidden('Seu plano atual não inclui esta funcionalidade.', 'FUNCIONALIDADE_NAO_INCLUIDA')
      );
    }
    next();
  };
}

export function createApp(options) {
  const {
    config,
    services,
    authentication,
    rateLimiters,
    resetWorkspace,
    domainStatus,
    logger = console
  } = options;

  if (!config || !services || !authentication || !rateLimiters) {
    throw new Error(
      'Configuração, serviços e middlewares são obrigatórios para criar a aplicação.'
    );
  }

  const app = express();
  const sessionCookieOptions = cookieOptions(config);
  const { requireAuth, requireAdmin, requireCsrf, requireRecentAuth } = authentication;

  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.set('json escape', true);
  app.set('query parser', 'simple');

  app.use(requestIdMiddleware);
  app.use(createHelmetMiddleware({ isProduction: config.isProduction }));
  app.use(additionalSecurityHeaders);
  app.use(cookieParser());

  app.use('/api', createCorsMiddleware(config.corsOrigins));
  app.use('/api', rejectDisallowedOrigin(config.corsOrigins));
  app.use('/api', apiNoStore);
  app.use('/api', rateLimiters.general);

  app.get('/api/health', (_req, res) => {
    const status = domainStatus();
    res.status(status.ready || status.bootstrapRequired ? 200 : 503).json({
      status: status.ready ? 'operacional' : 'configuracao_inicial',
      bootstrapRequired: status.bootstrapRequired,
      timestamp: new Date().toISOString()
    });
  });

  app.use(
    '/api/profile',
    express.json({ limit: config.limits.avatar, strict: true, type: 'application/json' }),
    requireJsonBody,
    createProfileRouter({
      profileService: services.profile,
      plansService: services.plans,
      authService: services.auth,
      requireAuth,
      requireCsrf,
      mutationLimiter: rateLimiters.mutation
    })
  );

  app.use(
    '/api',
    express.json({ limit: config.limits.json, strict: true, type: 'application/json' }),
    requireJsonBody
  );

  app.use(
    '/api/auth',
    createAuthRouter({
      authService: services.auth,
      requireAuth,
      requireCsrf,
      cookieName: config.cookie.name,
      cookieOptions: sessionCookieOptions,
      loginLimiter: rateLimiters.login,
      registerLimiter: rateLimiters.register
    })
  );

  app.use(
    '/api/users',
    createUsersRouter({
      authService: services.auth,
      requireAuth,
      requireAdmin,
      requireCsrf,
      // Único uso remanescente de reautenticação: a rota administrativa só
      // exige a senha novamente quando a operação altera a senha de alguém.
      requireRecentAuth,
      mutationLimiter: rateLimiters.mutation
    })
  );

  app.use(
    '/api/google',
    requireAuth,
    featureAuthorization(services.plans, 'google_calendar'),
    createGoogleCalendarRouter({
      googleCalendarService: services.googleCalendar,
      authService: services.auth,
      requireAuth,
      requireCsrf,
      mutationLimiter: rateLimiters.mutation,
      sensitiveLimiter: rateLimiters.sensitive,
      successRedirect: '/app',
      errorRedirect: '/app'
    })
  );

  app.use('/api/agenda', requireAuth, featureAuthorization(services.plans, 'agenda'));
  app.use(
    '/api/activities/:activity_id/agenda',
    requireAuth,
    featureAuthorization(services.plans, 'agenda')
  );
  app.use(
    '/api',
    createAgendaRouter({
      agendaService: services.agenda,
      requireAuth,
      requireCsrf,
      mutationLimiter: rateLimiters.mutation
    })
  );

  app.use(
    '/api/activities',
    requireAuth,
    featureAuthorization(services.plans, 'dashboard'),
    createActivitiesRouter({
      activitiesService: services.activities,
      authService: services.auth,
      requireAuth,
      requireCsrf,
      mutationLimiter: rateLimiters.mutation
    })
  );

  app.use(
    '/api/dashboard',
    requireAuth,
    featureAuthorization(services.plans, 'dashboard'),
    createDashboardRouter({ dashboardService: services.dashboard, requireAuth })
  );

  if (services.analytics) {
    app.use(
      '/api/analytics',
      requireAuth,
      featureAuthorization(services.plans, 'reports'),
      createAnalyticsRouter({ analyticsService: services.analytics, requireAuth })
    );
  }

  if (services.charts) {
    app.use(
      '/api/charts',
      requireAuth,
      featureAuthorization(services.plans, 'reports'),
      createChartsRouter({
        chartsService: services.charts,
        authService: services.auth,
        requireAuth,
        requireCsrf,
        mutationLimiter: rateLimiters.mutation
      })
    );
  }

  if (services.energy) {
    app.use(
      '/api/energy',
      requireAuth,
      createEnergyRouter({
        energyService: services.energy,
        authService: services.auth,
        requireAuth,
        requireCsrf,
        mutationLimiter: rateLimiters.mutation
      })
    );
  }

  app.use(
    '/api',
    createPlansRouter({
      plansService: services.plans,
      authService: services.auth,
      requireAuth,
      requireAdmin,
      requireCsrf,
      mutationLimiter: rateLimiters.mutation
    })
  );

  app.use(
    '/api',
    createRewardsRouter({
      rewardsService: services.rewards,
      authService: services.auth,
      requireAuth,
      requireAdmin,
      requireCsrf,
      mutationLimiter: rateLimiters.mutation
    })
  );

  if (services.privacy) {
    app.use(
      '/api/privacy',
      createPrivacyRouter({
        privacyService: services.privacy,
        requireAuth,
        requireAdmin,
        requireCsrf,
        sensitiveLimiter: rateLimiters.sensitive,
        mutationLimiter: rateLimiters.mutation,
        cookieName: config.cookie.name
      })
    );
  }

  app.use(
    '/api/settings',
    createSettingsRouter({
      resetWorkspace,
      authService: services.auth,
      requireAuth,
      requireCsrf,
      sensitiveLimiter: rateLimiters.sensitive
    })
  );

  app.use('/api', apiNotFound);

  app.use(
    '/assets',
    express.static(path.join(PUBLIC_DIR, 'assets'), {
      dotfiles: 'deny',
      etag: true,
      fallthrough: false,
      index: false,
      immutable: false,
      maxAge: config.isProduction ? '1h' : 0,
      redirect: false
    })
  );

  app.get('/landing.html', (_req, res) => res.redirect(308, '/'));
  app.get('/index.html', (_req, res) => res.redirect(308, '/app'));
  app.get('/login.html', (_req, res) => res.redirect(308, '/login'));
  app.get('/', htmlResponse(HTML_FILES.landing));
  app.get(
    '/login',
    redirectAuthenticatedUser(services.auth, config.cookie.name),
    htmlResponse(HTML_FILES.login)
  );
  app.get(
    '/app',
    authenticatedPage(services.auth, config.cookie.name),
    htmlResponse(HTML_FILES.application)
  );

  app.use((_req, res) => {
    res.status(404).type('text/plain; charset=utf-8').send('Página não encontrada.');
  });
  app.use(errorHandler({ logger, isDevelopment: config.nodeEnv === 'development' }));

  return app;
}

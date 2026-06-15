/**
 * Sentry scaffolding — currently inert. Setting `EXPO_PUBLIC_SENTRY_DSN`
 * (e.g. via app.json `extra` or an EAS env) flips reporting on without a
 * code change.
 *
 * The wrapper exists so callers don't have to null-check the DSN every
 * time they want to record a non-fatal — they get a stable API regardless.
 */

import * as Sentry from '@sentry/react-native';

const DSN =
  process.env.EXPO_PUBLIC_SENTRY_DSN ??
  process.env.SENTRY_DSN ??
  '';

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!DSN) {
    // No DSN configured — leave Sentry off. We still set the flag so a
    // later DSN-less init doesn't keep no-op logging.
    initialized = true;
    return;
  }
  Sentry.init({
    dsn: DSN,
    environment: process.env.EXPO_PUBLIC_SENTRY_ENV ?? 'development',
    enableAutoPerformanceTracking: true,
    tracesSampleRate: 0.1,
    // Don't capture PII unless explicitly asked. Beacon's threat model says
    // location data must not leak through error reports.
    sendDefaultPii: false,
  });
  initialized = true;
}

export function captureException(err: unknown, hint?: Record<string, unknown>) {
  if (!DSN) return;
  Sentry.captureException(err, hint ? { extra: hint } : undefined);
}

export function captureMessage(message: string, level: 'info' | 'warning' | 'error' = 'info') {
  if (!DSN) return;
  Sentry.captureMessage(message, level);
}

/** Drop-in replacement for React error boundaries. When Sentry is off,
 *  behaves like an inert wrapper. */
export const ErrorBoundary = Sentry.ErrorBoundary;

export type RuntimeHealth = 'healthy' | 'degraded' | 'stale' | 'paused' | 'blocked';

export interface RuntimeReliabilitySnapshot {
  health: RuntimeHealth;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  reason: string | null;
}

export interface RuntimeReliabilityInput {
  appActive: boolean;
  permissionGranted: boolean | null;
  consecutiveFailures: number;
  lastSuccessAt: number | null;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  lastError: string | null;
  now?: number;
}

const STALE_AFTER_MS = 20_000;
const EXPIRED_AFTER_MS = 120_000;
const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60_000;

export function classifyRuntimeReliability(input: RuntimeReliabilityInput): RuntimeReliabilitySnapshot {
  const now = input.now ?? Date.now();

  if (!input.appActive) {
    return {
      health: 'paused',
      consecutiveFailures: input.consecutiveFailures,
      lastSuccessAt: input.lastSuccessAt,
      lastAttemptAt: input.lastAttemptAt,
      nextRetryAt: null,
      reason: 'Beacon paused live presence while the app is in the background.',
    };
  }

  if (input.permissionGranted === false) {
    return {
      health: 'blocked',
      consecutiveFailures: input.consecutiveFailures,
      lastSuccessAt: input.lastSuccessAt,
      lastAttemptAt: input.lastAttemptAt,
      nextRetryAt: null,
      reason: 'Location permission is required for the live field.',
    };
  }

  if (input.lastSuccessAt == null) {
    return {
      health: input.consecutiveFailures > 0 ? 'degraded' : 'stale',
      consecutiveFailures: input.consecutiveFailures,
      lastSuccessAt: null,
      lastAttemptAt: input.lastAttemptAt,
      nextRetryAt: input.nextRetryAt,
      reason: input.lastError ?? 'Waiting for the first reliable presence fix.',
    };
  }

  const age = now - input.lastSuccessAt;
  if (age >= EXPIRED_AFTER_MS) {
    return {
      health: 'stale',
      consecutiveFailures: input.consecutiveFailures,
      lastSuccessAt: input.lastSuccessAt,
      lastAttemptAt: input.lastAttemptAt,
      nextRetryAt: input.nextRetryAt,
      reason: input.lastError ?? 'Live presence is stale and will refresh automatically.',
    };
  }

  if (input.consecutiveFailures > 0 || age >= STALE_AFTER_MS) {
    return {
      health: 'degraded',
      consecutiveFailures: input.consecutiveFailures,
      lastSuccessAt: input.lastSuccessAt,
      lastAttemptAt: input.lastAttemptAt,
      nextRetryAt: input.nextRetryAt,
      reason: input.lastError ?? 'Beacon is using the last reliable presence snapshot while reconnecting.',
    };
  }

  return {
    health: 'healthy',
    consecutiveFailures: 0,
    lastSuccessAt: input.lastSuccessAt,
    lastAttemptAt: input.lastAttemptAt,
    nextRetryAt: input.nextRetryAt,
    reason: null,
  };
}

export function computeRetryDelayMs(failureCount: number, random = Math.random): number {
  const exponent = Math.max(0, Math.min(6, failureCount - 1));
  const base = Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** exponent);
  const jitter = 0.8 + random() * 0.4;
  return Math.round(base * jitter);
}

export function shouldDiscardPresence(lastSuccessAt: number | null, now = Date.now()): boolean {
  return lastSuccessAt != null && now - lastSuccessAt >= EXPIRED_AFTER_MS;
}

export function describeRuntimeHealth(snapshot: RuntimeReliabilitySnapshot): string {
  switch (snapshot.health) {
    case 'healthy':
      return 'Live presence verified';
    case 'degraded':
      return 'Reconnecting with last verified state';
    case 'stale':
      return 'Presence refresh required';
    case 'paused':
      return 'Presence paused in background';
    case 'blocked':
      return 'Location access needed';
  }
}

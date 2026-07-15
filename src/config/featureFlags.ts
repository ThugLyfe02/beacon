export const FEATURE_FLAGS = {
  presenceEngine: true,
  spatialField: true,
  regretRecorder: false,
  opportunitySurge: true,
  opportunityWindowBanner: true,
  nextBestAction: false,
  vault: false,
  signalScarcity: false,
  limitedDrops: false,
  invisibleVip: false,
} as const;

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

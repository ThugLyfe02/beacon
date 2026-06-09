export const FEATURE_FLAGS = {
  presenceEngine: true,
  spatialField: true,
  regretRecorder: false,
};

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS;

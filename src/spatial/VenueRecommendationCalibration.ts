export interface VenueRecommendationCalibrationSample {
  commandId: string;
  confidence: number;
  measuredEffect: number;
  measuredAt: number;
}

export interface VenueCalibrationBin {
  lower: number;
  upper: number;
  sampleSize: number;
  meanConfidence: number;
  positiveRate: number;
  calibrationGap: number;
}

export interface VenueCommandCalibration {
  commandId: string;
  sampleSize: number;
  brierScore: number;
  calibrationGap: number;
  meanConfidence: number;
  positiveRate: number;
}

export type VenueCalibrationBand = 'immature' | 'calibrated' | 'watch' | 'miscalibrated';

export interface VenueRecommendationCalibrationState {
  band: VenueCalibrationBand;
  sampleSize: number;
  brierScore: number | null;
  expectedCalibrationError: number | null;
  meanConfidence: number | null;
  positiveRate: number | null;
  bins: VenueCalibrationBin[];
  commands: VenueCommandCalibration[];
  score: number;
  reasons: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function outcomeLabel(effect: number): number {
  return effect > 0.08 ? 1 : 0;
}

function brier(samples: VenueRecommendationCalibrationSample[]): number {
  if (samples.length === 0) return 1;
  return samples.reduce((sum, sample) => {
    const prediction = clamp01(sample.confidence);
    const outcome = outcomeLabel(sample.measuredEffect);
    return sum + (prediction - outcome) ** 2;
  }, 0) / samples.length;
}

function calibrationGap(samples: VenueRecommendationCalibrationSample[]): number {
  if (samples.length === 0) return 1;
  const confidence = samples.reduce((sum, sample) => sum + clamp01(sample.confidence), 0) / samples.length;
  const positiveRate = samples.reduce((sum, sample) => sum + outcomeLabel(sample.measuredEffect), 0) / samples.length;
  return Math.abs(confidence - positiveRate);
}

/**
 * Measures whether Beacon's recommendation confidence means what the UI implies.
 * If 80%-confidence recommendations only associate with positive measured
 * outcomes 45% of the time, the control surface is overconfident even if the
 * underlying recommendation ranking looks useful.
 *
 * The measured effect remains observational. Calibration evaluates the honesty
 * of confidence labels against measured outcomes; it does not prove the
 * recommendation caused the outcome.
 */
export function calibrateVenueRecommendations(
  rawSamples: VenueRecommendationCalibrationSample[],
  minimumMatureSamples = 20,
): VenueRecommendationCalibrationState {
  const samples = rawSamples
    .filter((sample) => Number.isFinite(sample.confidence) && Number.isFinite(sample.measuredEffect))
    .map((sample) => ({ ...sample, confidence: clamp01(sample.confidence) }))
    .sort((a, b) => a.measuredAt - b.measuredAt || a.commandId.localeCompare(b.commandId));

  const bins: VenueCalibrationBin[] = [];
  const binCount = 5;
  for (let index = 0; index < binCount; index += 1) {
    const lower = index / binCount;
    const upper = (index + 1) / binCount;
    const inBin = samples.filter((sample) =>
      sample.confidence >= lower && (index === binCount - 1 ? sample.confidence <= upper : sample.confidence < upper),
    );
    if (inBin.length === 0) continue;
    const meanConfidence = inBin.reduce((sum, sample) => sum + sample.confidence, 0) / inBin.length;
    const positiveRate = inBin.reduce((sum, sample) => sum + outcomeLabel(sample.measuredEffect), 0) / inBin.length;
    bins.push({
      lower,
      upper,
      sampleSize: inBin.length,
      meanConfidence,
      positiveRate,
      calibrationGap: Math.abs(meanConfidence - positiveRate),
    });
  }

  const expectedCalibrationError = samples.length === 0
    ? null
    : bins.reduce((sum, bin) => sum + bin.calibrationGap * (bin.sampleSize / samples.length), 0);
  const brierScore = samples.length === 0 ? null : brier(samples);
  const meanConfidence = samples.length === 0
    ? null
    : samples.reduce((sum, sample) => sum + sample.confidence, 0) / samples.length;
  const positiveRate = samples.length === 0
    ? null
    : samples.reduce((sum, sample) => sum + outcomeLabel(sample.measuredEffect), 0) / samples.length;

  const groups = new Map<string, VenueRecommendationCalibrationSample[]>();
  for (const sample of samples) groups.set(sample.commandId, [...(groups.get(sample.commandId) ?? []), sample]);
  const commands: VenueCommandCalibration[] = [...groups.entries()]
    .filter(([, group]) => group.length >= 5)
    .map(([commandId, group]) => {
      const groupMeanConfidence = group.reduce((sum, sample) => sum + sample.confidence, 0) / group.length;
      const groupPositiveRate = group.reduce((sum, sample) => sum + outcomeLabel(sample.measuredEffect), 0) / group.length;
      return {
        commandId,
        sampleSize: group.length,
        brierScore: brier(group),
        calibrationGap: calibrationGap(group),
        meanConfidence: groupMeanConfidence,
        positiveRate: groupPositiveRate,
      };
    })
    .sort((a, b) => b.calibrationGap - a.calibrationGap || b.sampleSize - a.sampleSize || a.commandId.localeCompare(b.commandId));

  let band: VenueCalibrationBand = 'immature';
  if (samples.length >= minimumMatureSamples && expectedCalibrationError !== null && brierScore !== null) {
    if (expectedCalibrationError <= 0.1 && brierScore <= 0.2) band = 'calibrated';
    else if (expectedCalibrationError <= 0.18 && brierScore <= 0.28) band = 'watch';
    else band = 'miscalibrated';
  }

  const maturity = clamp01(samples.length / Math.max(1, minimumMatureSamples));
  const calibrationQuality = expectedCalibrationError === null ? 0 : clamp01(1 - expectedCalibrationError / 0.3);
  const brierQuality = brierScore === null ? 0 : clamp01(1 - brierScore / 0.4);
  const score = clamp01(maturity * 0.35 + calibrationQuality * 0.4 + brierQuality * 0.25);

  const reasons: string[] = [];
  if (samples.length < minimumMatureSamples) reasons.push(`${samples.length}/${minimumMatureSamples} measured recommendation outcomes available for mature calibration`);
  if (expectedCalibrationError !== null && expectedCalibrationError > 0.18) reasons.push('confidence labels materially diverge from observed positive-outcome frequency');
  if (brierScore !== null && brierScore > 0.28) reasons.push('recommendation probability accuracy is outside the preferred operating band');
  const overconfidentCommands = commands.filter((command) => command.meanConfidence - command.positiveRate > 0.2);
  if (overconfidentCommands.length > 0) reasons.push(`${overconfidentCommands.length} command class${overconfidentCommands.length === 1 ? ' is' : 'es are'} materially overconfident`);
  if (reasons.length === 0) reasons.push('measured recommendation confidence is aligned with observed outcome frequency within the configured calibration band');

  return {
    band,
    sampleSize: samples.length,
    brierScore,
    expectedCalibrationError,
    meanConfidence,
    positiveRate,
    bins,
    commands,
    score,
    reasons,
  };
}

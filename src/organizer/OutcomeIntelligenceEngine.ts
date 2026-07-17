export type EventHealthState =
  | 'insufficient_data'
  | 'fragile'
  | 'forming'
  | 'healthy'
  | 'exceptional';

export interface EventOutcomeSnapshot {
  eventId: string;
  capturedAt: string;
  approvedParticipants: number;
  discoverableParticipants: number;
  verifiedRoleParticipants: number;
  protectedAccessParticipants: number;
  signalsSent: number;
  mutualsFormed: number;
  officeHoursRequested: number;
  officeHoursCompleted: number;
  dropsClaimed: number;
  dropsWaitlisted: number;
  vaultActionsOpen: number;
  vaultActionsCompleted: number;
  missedOpportunitiesRecorded: number;
  activationRate: number;
  signalToMutualRate: number;
  officeHoursCompletionRate: number;
  vaultFollowThroughRate: number;
  verifiedSupplyRate: number;
  beaconIndex: number;
  healthState: EventHealthState;
  confidence: number;
  diagnostics: string[];
  methodologyVersion: string;
}

export interface OutcomeFingerprint {
  activationStrength: number;
  relationshipConversion: number;
  accessConversion: number;
  followThrough: number;
  verifiedSupply: number;
  demandPressure: number;
  opportunityWaste: number;
}

export interface OutcomeDiagnostic {
  key:
    | 'insufficient_sample'
    | 'activation_constraint'
    | 'signal_quality_constraint'
    | 'access_fulfillment_constraint'
    | 'supply_constraint'
    | 'follow_through_constraint'
    | 'demand_overflow'
    | 'healthy_system';
  severity: 'info' | 'watch' | 'critical';
  headline: string;
  evidence: string;
  intervention: string;
  expectedEffect: string;
}

export interface EventComparison {
  indexDelta: number;
  confidenceDelta: number;
  improvedDimensions: Array<keyof OutcomeFingerprint>;
  regressedDimensions: Array<keyof OutcomeFingerprint>;
  unchangedDimensions: Array<keyof OutcomeFingerprint>;
  executiveSummary: string;
}

export interface SponsorProofSummary {
  isReportable: boolean;
  confidence: number;
  demandSignals: number;
  completedAccessMoments: number;
  waitlistPressure: number;
  privacyStatement: string;
  narrative: string;
}

const clamp = (value: number, min = 0, max = 1): number =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0));

const safeRate = (numerator: number, denominator: number): number =>
  denominator <= 0 ? 0 : clamp(numerator / denominator);

export function buildOutcomeFingerprint(
  snapshot: EventOutcomeSnapshot,
): OutcomeFingerprint {
  const totalDropDemand = snapshot.dropsClaimed + snapshot.dropsWaitlisted;
  const totalVaultActions = snapshot.vaultActionsOpen + snapshot.vaultActionsCompleted;

  return {
    activationStrength: clamp(snapshot.activationRate),
    relationshipConversion: clamp(snapshot.signalToMutualRate),
    accessConversion: clamp(snapshot.officeHoursCompletionRate),
    followThrough: clamp(snapshot.vaultFollowThroughRate),
    verifiedSupply: clamp(snapshot.verifiedSupplyRate),
    demandPressure: safeRate(snapshot.dropsWaitlisted, totalDropDemand),
    opportunityWaste: safeRate(
      snapshot.missedOpportunitiesRecorded,
      snapshot.signalsSent + snapshot.missedOpportunitiesRecorded,
    ),
  };
}

export function deriveOutcomeDiagnostics(
  snapshot: EventOutcomeSnapshot,
): OutcomeDiagnostic[] {
  const diagnostics: OutcomeDiagnostic[] = [];
  const sample = snapshot.approvedParticipants;

  if (sample < 8 || snapshot.confidence < 0.1) {
    diagnostics.push({
      key: 'insufficient_sample',
      severity: 'info',
      headline: 'The room is not yet statistically legible',
      evidence: `${sample} approved participants produced a confidence level of ${Math.round(
        snapshot.confidence * 100,
      )}%.`,
      intervention:
        'Increase activation density before changing the product mechanics. Use organizer stage direction, a 60-second Beacon brief, and a single visible use case.',
      expectedEffect:
        'A larger active sample allows Beacon to distinguish a product problem from a density problem.',
    });
    return diagnostics;
  }

  if (snapshot.activationRate < 0.45) {
    diagnostics.push({
      key: 'activation_constraint',
      severity: snapshot.activationRate < 0.25 ? 'critical' : 'watch',
      headline: 'The room has supply, but Beacon is not becoming the default behavior',
      evidence: `${Math.round(snapshot.activationRate * 100)}% of approved attendees became discoverable.`,
      intervention:
        'Move Beacon activation into the event ritual: stage announcement, timed QR exposure, staff-assisted VIP onboarding, and a visible first opportunity window within ten minutes.',
      expectedEffect:
        'Higher activation increases density nonlinearly because every additional participant expands the opportunity surface for everyone already active.',
    });
  }

  if (snapshot.signalsSent >= 5 && snapshot.signalToMutualRate < 0.12) {
    diagnostics.push({
      key: 'signal_quality_constraint',
      severity: snapshot.signalToMutualRate < 0.06 ? 'critical' : 'watch',
      headline: 'High-intent actions are being spent without enough reciprocal value',
      evidence: `${snapshot.signalsSent} signals produced ${snapshot.mutualsFormed} mutuals.`,
      intervention:
        'Reduce signal budgets, sharpen intent labels, require a reason for the final signal, and prioritize candidates with explicit availability or shared event goals.',
      expectedEffect:
        'Scarcer, better-explained signals should increase recipient trust and mutual conversion without increasing notification volume.',
    });
  }

  if (
    snapshot.officeHoursRequested >= 3 &&
    snapshot.officeHoursCompletionRate < 0.55
  ) {
    diagnostics.push({
      key: 'access_fulfillment_constraint',
      severity:
        snapshot.officeHoursCompletionRate < 0.3 ? 'critical' : 'watch',
      headline: 'Access demand exists, but the physical handoff is leaking value',
      evidence: `${snapshot.officeHoursRequested} Office Hours requests produced ${snapshot.officeHoursCompleted} completed sessions.`,
      intervention:
        'Tighten host capacity, add queue-quality ranking, confirm rooms before accepting requests, and require a one-tap completion or cancellation outcome.',
      expectedEffect:
        'Improved fulfillment protects VIP willingness to return and converts software intent into measurable real-world meetings.',
    });
  }

  if (snapshot.verifiedSupplyRate < 0.1 && sample >= 15) {
    diagnostics.push({
      key: 'supply_constraint',
      severity: snapshot.verifiedSupplyRate < 0.05 ? 'critical' : 'watch',
      headline: 'The room lacks enough trusted high-signal supply for Beacon to feel inevitable',
      evidence: `${snapshot.verifiedRoleParticipants} of ${sample} participants held an active verified role.`,
      intervention:
        'Pre-brief investors, speakers, mentors, and sponsors; offer Invisible VIP Mode by default; and open limited Office Hours only after controls are configured.',
      expectedEffect:
        'Protected verified supply increases perceived room value while reducing the risk that high-status participants opt out.',
    });
  }

  const totalVaultActions =
    snapshot.vaultActionsOpen + snapshot.vaultActionsCompleted;
  if (totalVaultActions >= 4 && snapshot.vaultFollowThroughRate < 0.35) {
    diagnostics.push({
      key: 'follow_through_constraint',
      severity: snapshot.vaultFollowThroughRate < 0.15 ? 'critical' : 'watch',
      headline: 'The event created opportunity, but the value is decaying after the room closes',
      evidence: `${snapshot.vaultActionsCompleted} of ${totalVaultActions} Vault actions were completed.`,
      intervention:
        'Collapse each Vault entry to one next action, prioritize expiring opportunities, and surface only the top three unresolved outcomes after the event.',
      expectedEffect:
        'Sharper follow-through converts event excitement into durable outcomes and makes Beacon useful after attendance ends.',
    });
  }

  const totalDropDemand = snapshot.dropsClaimed + snapshot.dropsWaitlisted;
  if (totalDropDemand >= 4 && snapshot.dropsWaitlisted > snapshot.dropsClaimed) {
    diagnostics.push({
      key: 'demand_overflow',
      severity: snapshot.dropsWaitlisted >= snapshot.dropsClaimed * 2 ? 'critical' : 'watch',
      headline: 'Scarce access is generating more qualified demand than the room can fulfill',
      evidence: `${snapshot.dropsClaimed} confirmed Drop claims and ${snapshot.dropsWaitlisted} waitlisted requests were recorded.`,
      intervention:
        'Increase supply only where completion quality remains high. Add a second controlled window, not a larger open queue, and preserve eligibility rules.',
      expectedEffect:
        'Selective supply expansion monetizes proven demand without destroying scarcity or VIP trust.',
    });
  }

  if (diagnostics.length === 0) {
    diagnostics.push({
      key: 'healthy_system',
      severity: 'info',
      headline: 'No dominant system constraint is visible at the current confidence level',
      evidence: `Beacon Index ${snapshot.beaconIndex} with ${Math.round(
        snapshot.confidence * 100,
      )}% confidence.`,
      intervention:
        'Preserve the current mechanics and run the same event design again before introducing a major product change.',
      expectedEffect:
        'Repeatability validates that the outcome was created by the system rather than a one-off room composition.',
    });
  }

  return diagnostics;
}

export function compareEventOutcomes(
  current: EventOutcomeSnapshot,
  previous: EventOutcomeSnapshot,
  tolerance = 0.03,
): EventComparison {
  const currentFingerprint = buildOutcomeFingerprint(current);
  const previousFingerprint = buildOutcomeFingerprint(previous);
  const keys = Object.keys(currentFingerprint) as Array<keyof OutcomeFingerprint>;
  const improvedDimensions: Array<keyof OutcomeFingerprint> = [];
  const regressedDimensions: Array<keyof OutcomeFingerprint> = [];
  const unchangedDimensions: Array<keyof OutcomeFingerprint> = [];

  keys.forEach((key) => {
    const delta = currentFingerprint[key] - previousFingerprint[key];
    if (key === 'opportunityWaste') {
      if (delta < -tolerance) improvedDimensions.push(key);
      else if (delta > tolerance) regressedDimensions.push(key);
      else unchangedDimensions.push(key);
      return;
    }

    if (delta > tolerance) improvedDimensions.push(key);
    else if (delta < -tolerance) regressedDimensions.push(key);
    else unchangedDimensions.push(key);
  });

  const indexDelta = current.beaconIndex - previous.beaconIndex;
  const executiveSummary =
    indexDelta >= 8
      ? 'The event design materially improved. Preserve the changed mechanics and isolate which intervention created the gain.'
      : indexDelta <= -8
        ? 'The event regressed enough to require a focused postmortem before repeating the same operating plan.'
        : improvedDimensions.length > regressedDimensions.length
          ? 'The system improved in more dimensions than it regressed, but the gain is not yet decisive.'
          : regressedDimensions.length > improvedDimensions.length
            ? 'Several outcome dimensions weakened even though the overall index remained relatively stable.'
            : 'The event performed similarly to the comparison event; repeatability is increasing, but no breakthrough is visible yet.';

  return {
    indexDelta,
    confidenceDelta: current.confidence - previous.confidence,
    improvedDimensions,
    regressedDimensions,
    unchangedDimensions,
    executiveSummary,
  };
}

export function buildSponsorProofSummary(
  snapshot: EventOutcomeSnapshot,
): SponsorProofSummary {
  const demandSignals =
    snapshot.officeHoursRequested +
    snapshot.dropsClaimed +
    snapshot.dropsWaitlisted;
  const completedAccessMoments =
    snapshot.officeHoursCompleted + snapshot.dropsClaimed;
  const isReportable = snapshot.approvedParticipants >= 10 && snapshot.confidence >= 0.12;

  const narrative = !isReportable
    ? 'The event has not produced enough aggregate activity for a responsible sponsor-impact claim.'
    : completedAccessMoments === 0
      ? 'Audience interest was measurable, but no completed sponsor-access moment was recorded.'
      : `${completedAccessMoments} completed or confirmed access moments emerged from ${demandSignals} aggregate demand signals without exposing individual attendee behavior.`;

  return {
    isReportable,
    confidence: snapshot.confidence,
    demandSignals,
    completedAccessMoments,
    waitlistPressure: safeRate(snapshot.dropsWaitlisted, snapshot.dropsClaimed + snapshot.dropsWaitlisted),
    privacyStatement:
      'This summary uses event-level aggregates only. It does not expose private signals, proximity trails, Vault contents, or attendee identities.',
    narrative,
  };
}

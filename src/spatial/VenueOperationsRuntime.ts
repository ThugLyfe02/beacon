import type { OrganizerCommand, SpatialOrganizerCommandState } from './SpatialOrganizerCommandEngine';
import {
  admitVenueControl,
  type VenueControlAdmissionResult,
  type VenueControlContext,
} from './VenueControlAdmission';
import type { VenueLayoutCompatibility } from './VenueLayoutVersioning';
import type { VenueTelemetryIntegrity } from './VenueTelemetryIntegrity';

export interface VenueAdmittedCommand {
  command: OrganizerCommand;
  admission: VenueControlAdmissionResult;
  visibleToOperator: boolean;
  actionReady: boolean;
}

export interface VenueOperationsRuntimeState {
  queue: VenueAdmittedCommand[];
  primary: VenueAdmittedCommand | null;
  actionableCount: number;
  reviewCount: number;
  blockedCount: number;
  frozen: boolean;
  narrative: string;
}

/**
 * Materializes the organizer decision queue after all upstream analysis. This is
 * where recommendation generation stops being equivalent to product exposure:
 * blocked commands remain inspectable for diagnostics, review-only commands stay
 * explicitly human-gated, and only admitted commands can become action-ready.
 */
export function buildVenueOperationsRuntime(
  commands: SpatialOrganizerCommandState,
  telemetry: VenueTelemetryIntegrity,
  layout: VenueLayoutCompatibility,
  context: VenueControlContext = {},
): VenueOperationsRuntimeState {
  const frozen = context.fallback?.mode === 'telemetry-hold'
    || context.loadShedding?.tier === 'freeze'
    || context.deployment?.stage === 'shadow';

  const queue = commands.commands.map<VenueAdmittedCommand>((command) => {
    const admission = admitVenueControl(command, telemetry, layout, context);
    const sponsorSuppressed = command.kind === 'sponsor'
      && (context.fallback?.allowSponsorEvidence === false || context.loadShedding?.suppressSponsorEvidence === true);
    const recommendationSuppressed = context.loadShedding?.suppressRecommendations === true;
    const operatorSurfaceAllowed = context.deployment?.allowOperatorSurface ?? true;
    const visibleToOperator = !sponsorSuppressed
      && !recommendationSuppressed
      && operatorSurfaceAllowed
      && admission.decision !== 'block';
    const actionReady = visibleToOperator
      && !frozen
      && admission.decision === 'allow'
      && (context.deployment?.allowActionReadyRecommendations ?? true);

    return { command, admission, visibleToOperator, actionReady };
  }).sort((left, right) => {
    const decisionRank: Record<VenueControlAdmissionResult['decision'], number> = { allow: 3, review: 2, block: 1 };
    if (left.actionReady !== right.actionReady) return left.actionReady ? -1 : 1;
    if (left.visibleToOperator !== right.visibleToOperator) return left.visibleToOperator ? -1 : 1;
    const decisionDelta = decisionRank[right.admission.decision] - decisionRank[left.admission.decision];
    if (decisionDelta !== 0) return decisionDelta;
    if (left.command.priority !== right.command.priority) return right.command.priority - left.command.priority;
    if (left.admission.score !== right.admission.score) return right.admission.score - left.admission.score;
    return left.command.id.localeCompare(right.command.id);
  });

  const primary = queue.find((item) => item.actionReady)
    ?? queue.find((item) => item.visibleToOperator)
    ?? null;
  const actionableCount = queue.filter((item) => item.actionReady).length;
  const reviewCount = queue.filter((item) => item.visibleToOperator && item.admission.decision === 'review').length;
  const blockedCount = queue.filter((item) => item.admission.decision === 'block').length;

  let narrative: string;
  if (frozen) {
    narrative = 'Venue recommendations are in a defensive hold. Beacon preserves truth-bearing venue state while preventing new action-ready guidance.';
  } else if (actionableCount > 0) {
    narrative = `${actionableCount} recommendation${actionableCount === 1 ? '' : 's'} cleared the current venue control boundary; ${reviewCount} require explicit review and ${blockedCount} remain blocked.`;
  } else if (reviewCount > 0) {
    narrative = `${reviewCount} recommendation${reviewCount === 1 ? '' : 's'} can be reviewed, but none currently clear the action-ready control boundary.`;
  } else {
    narrative = 'No organizer recommendation currently clears the venue operations policy. Beacon will not manufacture an action-ready command.';
  }

  return { queue, primary, actionableCount, reviewCount, blockedCount, frozen, narrative };
}

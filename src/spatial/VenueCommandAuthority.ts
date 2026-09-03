import type { OrganizerCommand } from './SpatialOrganizerCommandEngine';

export type VenueOperatorRole = 'viewer' | 'organizer' | 'venue-ops' | 'security' | 'admin';
export type VenueCommandAuthorityDecision = 'allow' | 'second-approval' | 'deny';

export interface VenueOperatorIdentity {
  operatorId: string;
  role: VenueOperatorRole;
  active: boolean;
  venueIds: string[];
}

export interface VenueCommandApproval {
  operatorId: string;
  role: VenueOperatorRole;
  commandId: string;
  approvedAt: number;
}

export interface VenueCommandAuthorityResult {
  decision: VenueCommandAuthorityDecision;
  requiredRoles: VenueOperatorRole[];
  distinctApprovalCount: number;
  reasons: string[];
}

const ROLE_ORDER: VenueOperatorRole[] = ['viewer', 'organizer', 'venue-ops', 'security', 'admin'];

function atLeast(actual: VenueOperatorRole, minimum: VenueOperatorRole): boolean {
  return ROLE_ORDER.indexOf(actual) >= ROLE_ORDER.indexOf(minimum);
}

function minimumRoleFor(command: OrganizerCommand): VenueOperatorRole {
  switch (command.kind) {
    case 'sponsor':
      return 'organizer';
    case 'programming':
      return 'organizer';
    case 'flow':
    case 'capacity':
      return 'venue-ops';
    case 'safety':
      return 'security';
    case 'follow-up':
      return 'organizer';
    default: {
      const exhaustive: never = command.kind;
      return exhaustive;
    }
  }
}

/**
 * Separates analytical admission from operator authorization. A recommendation
 * that clears model policy still must be executed by an operator with the right
 * venue scope and role. High-impact `safety` commands require two distinct
 * approvals so one client session cannot silently turn advisory software into a
 * unilateral physical-world control path.
 *
 * This client policy is defense in depth only. Server-side authorization must
 * enforce the same or stricter rules before persisting or dispatching actions.
 */
export function evaluateVenueCommandAuthority(
  command: OrganizerCommand,
  venueId: string,
  actor: VenueOperatorIdentity,
  approvals: VenueCommandApproval[] = [],
  now = Date.now(),
): VenueCommandAuthorityResult {
  const reasons: string[] = [];
  const minimumRole = minimumRoleFor(command);
  const requiredRoles = command.kind === 'safety'
    ? [minimumRole, 'venue-ops' as VenueOperatorRole]
    : [minimumRole];

  if (!actor.active) reasons.push('operator account is not active');
  if (!actor.venueIds.includes(venueId)) reasons.push('operator is not scoped to this venue');
  if (!atLeast(actor.role, minimumRole)) reasons.push(`command requires ${minimumRole} authority or higher`);

  if (reasons.length > 0) {
    return { decision: 'deny', requiredRoles, distinctApprovalCount: 0, reasons };
  }

  const validApprovals = approvals.filter((approval) =>
    approval.commandId === command.id
    && now - approval.approvedAt <= 5 * 60_000
    && approval.operatorId !== actor.operatorId,
  );
  const distinctApprovers = new Map<string, VenueCommandApproval>();
  for (const approval of validApprovals) distinctApprovers.set(approval.operatorId, approval);

  if (command.kind === 'safety') {
    const hasSecondQualifiedApproval = [...distinctApprovers.values()].some((approval) =>
      atLeast(approval.role, 'venue-ops'),
    );
    if (!hasSecondQualifiedApproval) {
      return {
        decision: 'second-approval',
        requiredRoles,
        distinctApprovalCount: distinctApprovers.size,
        reasons: ['high-impact safety-class venue command requires a recent second approval from a distinct qualified operator'],
      };
    }
  }

  return {
    decision: 'allow',
    requiredRoles,
    distinctApprovalCount: distinctApprovers.size + 1,
    reasons: ['operator venue scope, role, and required approval policy are satisfied'],
  };
}

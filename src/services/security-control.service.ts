import { supabase } from '../lib/supabase';

export type EventSecurityMode = 'normal' | 'restricted' | 'locked';
export type SecurityAction =
  | 'signal'
  | 'office_hours'
  | 'access_drop'
  | 'proximity_reveal'
  | 'organizer_export'
  | 'role_attestation'
  | 'vip_policy_change';

export interface EventSecurityControls {
  event_id: string;
  mode: EventSecurityMode;
  signals_enabled: boolean;
  office_hours_enabled: boolean;
  access_drops_enabled: boolean;
  proximity_reveal_enabled: boolean;
  organizer_exports_enabled: boolean;
  reason: string | null;
  locked_at: string | null;
  locked_by: string | null;
  updated_at: string;
}

export interface SensitiveActionAuthorization {
  allowed: boolean;
  reasonCode: string;
  securityMode: EventSecurityMode;
  evaluatedAt: string;
}

function buildNonce(): string {
  const random = Math.random().toString(36).slice(2);
  return `${Date.now().toString(36)}-${random}-${random.split('').reverse().join('')}`;
}

export async function getEventSecurityControls(
  eventId: string,
): Promise<EventSecurityControls | null> {
  const { data, error } = await supabase
    .rpc('ensure_event_security_controls', { p_event_id: eventId })
    .single<EventSecurityControls>();

  if (error) {
    console.error('[security-control.service] getEventSecurityControls error:', error);
    return null;
  }

  return data;
}

export async function authorizeSensitiveAction({
  eventId,
  action,
  targetId,
  metadata = {},
  nonce = buildNonce(),
}: {
  eventId: string;
  action: SecurityAction;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  nonce?: string;
}): Promise<SensitiveActionAuthorization> {
  const { data, error } = await supabase
    .rpc('authorize_sensitive_action', {
      p_event_id: eventId,
      p_action: action,
      p_nonce: nonce,
      p_target_id: targetId ?? null,
      p_metadata: metadata,
    })
    .single<{
      allowed: boolean;
      reason_code: string;
      security_mode: EventSecurityMode;
      evaluated_at: string;
    }>();

  if (error || !data) {
    console.error('[security-control.service] authorizeSensitiveAction error:', error);
    return {
      allowed: false,
      reasonCode: 'authorization_unavailable',
      securityMode: 'restricted',
      evaluatedAt: new Date().toISOString(),
    };
  }

  return {
    allowed: data.allowed,
    reasonCode: data.reason_code,
    securityMode: data.security_mode,
    evaluatedAt: data.evaluated_at,
  };
}

export async function updateEventSecurityControls(
  eventId: string,
  updates: Partial<
    Pick<
      EventSecurityControls,
      | 'mode'
      | 'signals_enabled'
      | 'office_hours_enabled'
      | 'access_drops_enabled'
      | 'proximity_reveal_enabled'
      | 'organizer_exports_enabled'
      | 'reason'
    >
  >,
): Promise<EventSecurityControls> {
  const { data, error } = await supabase
    .from('event_security_controls')
    .update(updates)
    .eq('event_id', eventId)
    .select('*')
    .single<EventSecurityControls>();

  if (error || !data) {
    console.error('[security-control.service] updateEventSecurityControls error:', error);
    throw new Error('Unable to update event security controls.');
  }

  return data;
}

export function explainSecurityDecision(reasonCode: string): string {
  switch (reasonCode) {
    case 'allowed':
      return 'The action passed Beacon’s event-scoped security checks.';
    case 'event_locked':
      return 'Sensitive actions are temporarily locked for this event.';
    case 'restricted_mode':
      return 'This action is unavailable while the event is operating in restricted mode.';
    case 'signals_disabled':
      return 'High-intent signals are temporarily disabled by the event security controls.';
    case 'office_hours_disabled':
      return 'Office Hours requests are temporarily disabled by the event security controls.';
    case 'access_drops_disabled':
      return 'Limited Access Drops are temporarily disabled by the event security controls.';
    case 'proximity_reveal_disabled':
      return 'Identity-bearing proximity reveals are temporarily disabled.';
    case 'organizer_exports_disabled':
      return 'Organizer exports are temporarily disabled to protect event data.';
    case 'blocked_relationship':
      return 'The action was blocked because one participant has blocked the other.';
    case 'nonce_reuse':
      return 'The action was rejected because the same secure request token was already used.';
    case 'burst_limit':
      return 'The action was slowed because sensitive requests are arriving too quickly.';
    case 'not_event_member':
      return 'Approved event participation is required for this action.';
    default:
      return 'Beacon could not verify the action safely. Please try again after refreshing your event state.';
  }
}

import { FEATURE_FLAGS } from '../config/featureFlags';
import {
  createDecisionProvenance,
  type DecisionProvenanceInput,
} from '../integrity/DecisionProvenanceEngine';
import { supabase } from '../lib/supabase';

export async function recordDecisionProvenance(
  input: DecisionProvenanceInput,
): Promise<boolean> {
  if (!FEATURE_FLAGS.decisionProvenance) return false;

  const envelope = createDecisionProvenance(input);
  const { error } = await supabase.rpc('record_opportunity_decision_receipt', {
    p_event_id: envelope.eventId,
    p_subject_id: envelope.subjectId ?? null,
    p_domain: envelope.domain,
    p_outcome: envelope.outcome,
    p_reason_codes: envelope.reasonCodes,
    p_policy_version: envelope.policyVersion,
    p_input_fingerprint: envelope.inputFingerprint,
    p_feature_flags: envelope.featureFlags ?? {},
    p_metadata: envelope.metadata ?? {},
    p_expires_at: envelope.expiresAt ?? null,
  });

  if (error) {
    // Provenance must never break the primary product action. The database remains
    // the source of truth for authorization; this ledger exists for explainability.
    console.warn('[decision-provenance.service] record failed:', error.message);
    return false;
  }

  return true;
}

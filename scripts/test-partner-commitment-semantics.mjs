import assert from 'node:assert/strict';

// Deterministic contract-model tests for the Partner Commitment Ledger.
//
// These tests intentionally do not pretend to replace database integration tests.
// They pin the semantic invariants that the SQL/RPC layer must preserve so a
// future refactor cannot quietly normalize away distinctions such as
// "measurement missing" vs "measured zero" or "amendment proposed" vs
// "contract amended".

function effectiveRevision(revisions) {
  return [...revisions]
    .filter((revision) => revision.acceptance === 'accepted')
    .filter((revision) => !['rejected', 'cancelled'].includes(revision.lifecycle))
    .sort((left, right) => right.revisionNo - left.revisionNo)[0] ?? null;
}

function pendingRevision(revisions) {
  const latest = [...revisions].sort((left, right) => right.revisionNo - left.revisionNo)[0] ?? null;
  if (!latest) return null;
  return latest.acceptance === 'awaiting-acceptance' && latest.lifecycle === 'proposed'
    ? latest
    : null;
}

function decisionIsActionable(revision) {
  return revision.acceptance === 'awaiting-acceptance' && revision.lifecycle === 'proposed';
}

function manualReviewState({ requiredRoles, submitterRole, latestDecisionByRole }) {
  let pending = false;
  for (const role of requiredRoles) {
    if (role === submitterRole) continue;
    const decision = latestDecisionByRole[role] ?? null;
    if (decision === 'disputed') return 'disputed';
    if (decision !== 'acknowledged') pending = true;
  }
  return pending ? 'pending' : 'acknowledged';
}

function measurementIsAdmissible(measurement) {
  if (!measurement) return false;
  if (!['measured', 'partial', 'manual-only'].includes(measurement.state)) return false;
  return ['not-required', 'acknowledged'].includes(measurement.manualReviewState);
}

function summarizeMeasurementCoverage(events) {
  const measured = events.filter((event) => measurementIsAdmissible(event.measurement));
  return {
    eventCount: events.length,
    measuredEventCount: measured.length,
    coverage: events.length === 0 ? 0 : measured.length / events.length,
    averageDelivered: measured.length === 0
      ? null
      : measured.reduce((sum, event) => sum + event.measurement.delivered, 0) / measured.length,
    averageUtilized: measured.length === 0
      ? null
      : measured.reduce((sum, event) => sum + event.measurement.utilized, 0) / measured.length,
    zeroUtilizationMeasuredEventCount: measured.filter(
      (event) => event.measurement.delivered > 0 && event.measurement.utilized === 0,
    ).length,
  };
}

function windowsOverlap(left, right) {
  if (left.scopeKind === 'program-template' || right.scopeKind === 'program-template') return true;
  return left.windowStart < right.windowEnd && right.windowStart < left.windowEnd;
}

function semanticCommitmentsOverlap(left, right) {
  return left.commitmentId !== right.commitmentId
    && left.scopeId === right.scopeId
    && left.partyKind === right.partyKind
    && left.communityId === right.communityId
    && left.type === right.type
    && left.domain === right.domain
    && windowsOverlap(left, right);
}

function canFinalizeFromMeasurement({ revision, effectiveRevisionId, measurement }) {
  if (revision.id !== effectiveRevisionId) return false;
  if (revision.acceptance !== 'accepted') return false;
  if (!measurementIsAdmissible(measurement)) return false;
  if (measurement.delivered >= revision.committed) return 'fulfilled';
  if (measurement.delivered > 0) return 'partially_fulfilled';
  return 'not_fulfilled';
}

// Accepted terms remain binding while an amendment is merely proposed.
{
  const revisions = [
    { id: 'r1', revisionNo: 1, acceptance: 'accepted', lifecycle: 'accepted', quantity: 8 },
    { id: 'r2', revisionNo: 2, acceptance: 'awaiting-acceptance', lifecycle: 'proposed', quantity: 12 },
  ];
  assert.equal(effectiveRevision(revisions)?.id, 'r1');
  assert.equal(pendingRevision(revisions)?.id, 'r2');
  assert.equal(decisionIsActionable(revisions[1]), true);
}

// Rejecting the amendment does not erase the accepted contract and must not
// re-surface a second accept/decline prompt.
{
  const revisions = [
    { id: 'r1', revisionNo: 1, acceptance: 'accepted', lifecycle: 'accepted', quantity: 8 },
    { id: 'r2', revisionNo: 2, acceptance: 'rejected', lifecycle: 'rejected', quantity: 12 },
  ];
  assert.equal(effectiveRevision(revisions)?.id, 'r1');
  assert.equal(pendingRevision(revisions), null);
  assert.equal(decisionIsActionable(revisions[1]), false);
}

// A withdrawn first proposal is terminal and never becomes actionable again.
{
  const revision = { id: 'r1', revisionNo: 1, acceptance: 'withdrawn', lifecycle: 'cancelled' };
  assert.equal(effectiveRevision([revision]), null);
  assert.equal(pendingRevision([revision]), null);
  assert.equal(decisionIsActionable(revision), false);
}

// Manual partner assertions are attributable but cannot finalize until every
// other required contractual role independently acknowledges them.
{
  const requiredRoles = ['community-a', 'community-b'];
  assert.equal(manualReviewState({
    requiredRoles,
    submitterRole: 'community-a',
    latestDecisionByRole: {},
  }), 'pending');
  assert.equal(manualReviewState({
    requiredRoles,
    submitterRole: 'community-a',
    latestDecisionByRole: { 'community-b': 'acknowledged' },
  }), 'acknowledged');
  assert.equal(manualReviewState({
    requiredRoles,
    submitterRole: 'community-a',
    latestDecisionByRole: { 'community-b': 'disputed' },
  }), 'disputed');
}

// A host commitment has three principals; one community acknowledgement is not
// enough to turn a host-entered quantity into a settled bilateral record.
{
  const requiredRoles = ['community-a', 'community-b', 'event-host'];
  assert.equal(manualReviewState({
    requiredRoles,
    submitterRole: 'event-host',
    latestDecisionByRole: { 'community-a': 'acknowledged' },
  }), 'pending');
  assert.equal(manualReviewState({
    requiredRoles,
    submitterRole: 'event-host',
    latestDecisionByRole: {
      'community-a': 'acknowledged',
      'community-b': 'acknowledged',
    },
  }), 'acknowledged');
}

// Missing evidence is not zero delivery. Only admissible measured events enter
// utilization averages, and the coverage denominator remains visible.
{
  const summary = summarizeMeasurementCoverage([
    { measurement: { state: 'measured', manualReviewState: 'not-required', delivered: 8, utilized: 6 } },
    { measurement: null },
    { measurement: { state: 'insufficient-evidence', manualReviewState: 'not-required', delivered: 0, utilized: 0 } },
    { measurement: { state: 'manual-only', manualReviewState: 'pending', delivered: 8, utilized: 0 } },
  ]);
  assert.equal(summary.eventCount, 4);
  assert.equal(summary.measuredEventCount, 1);
  assert.equal(summary.coverage, 0.25);
  assert.equal(summary.averageDelivered, 8);
  assert.equal(summary.averageUtilized, 6);
  assert.equal(summary.zeroUtilizationMeasuredEventCount, 0);
}

// Measured delivered-but-unused capacity remains a real operational observation;
// it is not equivalent to a missing measurement.
{
  const summary = summarizeMeasurementCoverage([
    { measurement: { state: 'measured', manualReviewState: 'not-required', delivered: 20, utilized: 0 } },
    { measurement: null },
  ]);
  assert.equal(summary.measuredEventCount, 1);
  assert.equal(summary.averageUtilized, 0);
  assert.equal(summary.zeroUtilizationMeasuredEventCount, 1);
}

// A pending/disputed manual assertion cannot be used to finalize the contract.
{
  const revision = { id: 'r1', acceptance: 'accepted', committed: 8 };
  assert.equal(canFinalizeFromMeasurement({
    revision,
    effectiveRevisionId: 'r1',
    measurement: { state: 'manual-only', manualReviewState: 'pending', delivered: 8, utilized: 6 },
  }), false);
  assert.equal(canFinalizeFromMeasurement({
    revision,
    effectiveRevisionId: 'r1',
    measurement: { state: 'manual-only', manualReviewState: 'disputed', delivered: 8, utilized: 6 },
  }), false);
  assert.equal(canFinalizeFromMeasurement({
    revision,
    effectiveRevisionId: 'r1',
    measurement: { state: 'manual-only', manualReviewState: 'acknowledged', delivered: 8, utilized: 6 },
  }), 'fulfilled');
}

// Evidence cannot continue accumulating on a stale accepted revision after an
// amendment becomes the effective contract.
{
  const staleRevision = { id: 'r1', acceptance: 'accepted', committed: 8 };
  assert.equal(canFinalizeFromMeasurement({
    revision: staleRevision,
    effectiveRevisionId: 'r2',
    measurement: { state: 'measured', manualReviewState: 'not-required', delivered: 8, utilized: 8 },
  }), false);
}

// Indistinguishable overlapping obligations are ambiguous because one activity
// could otherwise satisfy both promises. Different domain or disjoint time is a
// legitimately different contract.
{
  const base = {
    commitmentId: 'c1',
    scopeId: 'scope',
    scopeKind: 'event-exchange',
    partyKind: 'community',
    communityId: 'community-a',
    type: 'office_hours_slots',
    domain: null,
    windowStart: 100,
    windowEnd: 200,
  };
  assert.equal(semanticCommitmentsOverlap(base, { ...base, commitmentId: 'c2', windowStart: 150, windowEnd: 250 }), true);
  assert.equal(semanticCommitmentsOverlap(base, { ...base, commitmentId: 'c3', domain: 'product' }), false);
  assert.equal(semanticCommitmentsOverlap(base, { ...base, commitmentId: 'c4', windowStart: 200, windowEnd: 300 }), false);
}

console.log('Partner Commitment Ledger semantic scenario tests passed.');

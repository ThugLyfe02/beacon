import assert from 'node:assert/strict';

function effectiveRevision(revisions) {
  return [...revisions]
    .filter((revision) => revision.acceptance === 'accepted')
    .filter((revision) => !['rejected', 'cancelled'].includes(revision.lifecycle))
    .sort((left, right) => right.revisionNo - left.revisionNo)[0] ?? null;
}

function prefillTemplate(revisions) {
  const effective = effectiveRevision(revisions);
  if (!effective || effective.lifecycle !== 'accepted') return null;
  return {
    sourceTemplateRevisionId: effective.id,
    quantity: effective.quantity,
    lifecycle: 'proposed',
    accepted: false,
  };
}

function semanticOverlap(left, right) {
  const protectedStatuses = new Set([
    'accepted',
    'scheduled',
    'delivering',
    'fulfilled',
    'partially_fulfilled',
  ]);
  if (!protectedStatuses.has(left.lifecycle)) return false;
  if (left.scopeId !== right.scopeId) return false;
  if (left.partyKind !== right.partyKind || left.communityId !== right.communityId) return false;
  if (left.type !== right.type || left.domain !== right.domain) return false;
  if (left.scopeKind === 'program-template') return true;
  return left.windowStart < right.windowEnd && right.windowStart < left.windowEnd;
}

// Pending amendment: accepted configuration remains the reusable template.
{
  const copy = prefillTemplate([
    { id: 'template-r1', revisionNo: 1, acceptance: 'accepted', lifecycle: 'accepted', quantity: 8 },
    { id: 'template-r2', revisionNo: 2, acceptance: 'awaiting-acceptance', lifecycle: 'proposed', quantity: 12 },
  ]);
  assert.equal(copy?.sourceTemplateRevisionId, 'template-r1');
  assert.equal(copy?.quantity, 8);
  assert.equal(copy?.lifecycle, 'proposed');
  assert.equal(copy?.accepted, false);
}

// Once the amendment earns acceptance, the new configuration becomes effective.
{
  const copy = prefillTemplate([
    { id: 'template-r1', revisionNo: 1, acceptance: 'accepted', lifecycle: 'accepted', quantity: 8 },
    { id: 'template-r2', revisionNo: 2, acceptance: 'accepted', lifecycle: 'accepted', quantity: 12 },
  ]);
  assert.equal(copy?.sourceTemplateRevisionId, 'template-r2');
  assert.equal(copy?.quantity, 12);
  assert.equal(copy?.accepted, false, 'historical acceptance must never bind a new event');
}

// Rejected amendment cannot replace the previously accepted template.
{
  const copy = prefillTemplate([
    { id: 'template-r1', revisionNo: 1, acceptance: 'accepted', lifecycle: 'accepted', quantity: 8 },
    { id: 'template-r2', revisionNo: 2, acceptance: 'rejected', lifecycle: 'rejected', quantity: 12 },
  ]);
  assert.equal(copy?.sourceTemplateRevisionId, 'template-r1');
  assert.equal(copy?.quantity, 8);
}

// A fulfilled obligation still protects its evidence window from a semantic
// duplicate. Reaching terminal delivery state does not make the underlying real
// sessions available to satisfy a second indistinguishable promise.
{
  const completed = {
    scopeId: 'scope-1',
    scopeKind: 'event-exchange',
    partyKind: 'community',
    communityId: 'community-a',
    type: 'mentor_slots',
    domain: 'mentorship',
    windowStart: 100,
    windowEnd: 200,
    lifecycle: 'fulfilled',
  };
  const duplicate = { ...completed, lifecycle: 'proposed', windowStart: 150, windowEnd: 190 };
  assert.equal(semanticOverlap(completed, duplicate), true);
}

// Partial delivery carries the same evidence uniqueness protection.
{
  const partial = {
    scopeId: 'scope-1',
    scopeKind: 'event-exchange',
    partyKind: 'community',
    communityId: 'community-a',
    type: 'office_hours_slots',
    domain: null,
    windowStart: 100,
    windowEnd: 200,
    lifecycle: 'partially_fulfilled',
  };
  assert.equal(semanticOverlap(partial, { ...partial, lifecycle: 'proposed', windowStart: 199, windowEnd: 250 }), true);
}

// Cancelled obligations do not reserve evidence forever; a replacement can be
// accepted if the previous obligation never became a measured contribution.
{
  const cancelled = {
    scopeId: 'scope-1',
    scopeKind: 'event-exchange',
    partyKind: 'community',
    communityId: 'community-a',
    type: 'workshops',
    domain: 'technical',
    windowStart: 100,
    windowEnd: 200,
    lifecycle: 'cancelled',
  };
  assert.equal(semanticOverlap(cancelled, { ...cancelled, lifecycle: 'proposed' }), false);
}

// Different domains or disjoint windows remain independently measurable.
{
  const delivered = {
    scopeId: 'scope-1',
    scopeKind: 'event-exchange',
    partyKind: 'community',
    communityId: 'community-a',
    type: 'focus_windows',
    domain: 'product',
    windowStart: 100,
    windowEnd: 200,
    lifecycle: 'fulfilled',
  };
  assert.equal(semanticOverlap(delivered, { ...delivered, lifecycle: 'proposed', domain: 'hiring' }), false);
  assert.equal(semanticOverlap(delivered, { ...delivered, lifecycle: 'proposed', windowStart: 200, windowEnd: 300 }), false);
}

console.log('Partner Commitment Ledger template/evidence uniqueness tests passed.');

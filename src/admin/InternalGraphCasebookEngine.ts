import {
  analyzeInternalGraph,
  findInternalGraphPath,
  type InternalGraphPayload,
} from './InternalGraphEngine';
import { analyzeInternalGraphForensics } from './InternalGraphForensicsEngine';
import { analyzeInternalGraphMotifs } from './InternalGraphMotifEngine';
import { findPathsToTargetEcosystem } from './InternalGraphStrategyEngine';
import type {
  InternalGraphCase,
  InternalGraphCaseFindingClass,
} from './internalGraphCasebook.service';

export interface InternalGraphCaseEvaluationFinding {
  key: string;
  class: InternalGraphCaseFindingClass;
  summary: string;
  score: number;
  evidence: Record<string, unknown>;
}

export interface InternalGraphCaseEvaluation {
  caseId: string;
  evaluatedAt: string;
  findings: InternalGraphCaseEvaluationFinding[];
  pinnedPresent: number;
  pinnedMissing: number;
  summary: string[];
}

function nodeLabel(payload: InternalGraphPayload, nodeId: string): string {
  return payload.nodes.find((node) => node.id === nodeId)?.label ?? nodeId;
}

function stablePair(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

export function evaluateInternalGraphCase(input: {
  investigation: InternalGraphCase;
  payload: InternalGraphPayload;
  suppressions: Set<string>;
}): InternalGraphCaseEvaluation {
  const { investigation, payload, suppressions } = input;
  const analysis = analyzeInternalGraph(payload);
  const forensics = analyzeInternalGraphForensics(payload, analysis);
  const motifs = analyzeInternalGraphMotifs(payload, analysis);
  const nodeIds = new Set(payload.nodes.map((node) => node.id));
  const findings: InternalGraphCaseEvaluationFinding[] = [];
  let pinnedPresent = 0;
  let pinnedMissing = 0;

  for (const pin of investigation.pins) {
    if (nodeIds.has(pin.nodeId)) pinnedPresent += 1;
    else pinnedMissing += 1;
  }

  // Pinned-person brokerage / fragility findings.
  for (const pin of investigation.pins) {
    const broker = forensics.brokers.find((candidate) => candidate.nodeId === pin.nodeId);
    if (!broker) continue;
    if (broker.forensicScore > 0 || broker.articulation) {
      findings.push({
        key: `broker:${pin.nodeId}`,
        class: broker.articulation ? 'fragility' : 'broker',
        summary: broker.articulation
          ? `${pin.label} is currently an articulation point; removing this node fragments explainable reachability.`
          : `${pin.label} carries measurable cross-community brokerage with ${Math.round(broker.participationCoefficient * 100)}% participation dispersion.`,
        score: broker.forensicScore + (broker.articulation ? 5 : 0),
        evidence: {
          nodeId: pin.nodeId,
          forensicScore: broker.forensicScore,
          participationCoefficient: broker.participationCoefficient,
          effectiveSize: broker.effectiveSize,
          articulation: broker.articulation,
          crossCommunityCount: broker.crossCommunityCount,
        },
      });
    }
  }

  // Explainable paths between pinned nodes. Suppressed pairs are never suggested.
  for (let i = 0; i < investigation.pins.length; i += 1) {
    for (let j = i + 1; j < investigation.pins.length; j += 1) {
      const left = investigation.pins[i];
      const right = investigation.pins[j];
      if (!nodeIds.has(left.nodeId) || !nodeIds.has(right.nodeId)) continue;
      if (suppressions.has(stablePair(left.nodeId, right.nodeId))) continue;
      const path = findInternalGraphPath(payload, left.nodeId, right.nodeId);
      if (!path) continue;
      findings.push({
        key: `path:${stablePair(left.nodeId, right.nodeId)}`,
        class: 'path',
        summary: `${left.label} reaches ${right.label} through ${path.edgeIds.length} explainable hop${path.edgeIds.length === 1 ? '' : 's'}.`,
        score: 1 / Math.max(0.001, path.cost),
        evidence: { nodeIds: path.nodeIds, edgeIds: path.edgeIds, cost: path.cost },
      });
    }
  }

  // Target ecosystem reachability from pinned people first, otherwise strongest broker.
  if (investigation.targetQuery?.trim()) {
    const sources = investigation.pins
      .map((pin) => pin.nodeId)
      .filter((nodeId) => nodeIds.has(nodeId));
    if (sources.length === 0) sources.push(forensics.brokers[0]?.nodeId ?? analysis.brokerNodeIds[0] ?? '');

    const seenTargets = new Set<string>();
    for (const source of sources.filter(Boolean).slice(0, 6)) {
      const routes = findPathsToTargetEcosystem(payload, source, investigation.targetQuery, 4);
      for (const route of routes) {
        if (seenTargets.has(route.targetNodeId)) continue;
        seenTargets.add(route.targetNodeId);
        findings.push({
          key: `ecosystem:${source}:${route.targetNodeId}`,
          class: 'path',
          summary: `${nodeLabel(payload, source)} has an explainable route into “${investigation.targetQuery}” via ${route.path.edgeIds.length} hops.`,
          score: 1 / Math.max(0.001, route.path.cost),
          evidence: {
            sourceNodeId: source,
            targetNodeId: route.targetNodeId,
            targetLabel: route.targetLabel,
            targetKind: route.targetKind,
            nodeIds: route.path.nodeIds,
            edgeIds: route.path.edgeIds,
            cost: route.path.cost,
          },
        });
      }
    }

    if (seenTargets.size === 0) {
      findings.push({
        key: `ecosystem_gap:${investigation.targetQuery.toLowerCase()}`,
        class: 'ecosystem_gap',
        summary: `No current explainable path reaches the target ecosystem “${investigation.targetQuery}”; this is a genuine coverage gap in the authorized graph.`,
        score: 2,
        evidence: { targetQuery: investigation.targetQuery },
      });
    }
  }

  // Case-relevant bridge frontier: any structural-hole candidate touching a pin.
  const pinIds = new Set(investigation.pins.map((pin) => pin.nodeId));
  for (const candidate of analysis.bridgeCandidates) {
    if (!pinIds.has(candidate.source) && !pinIds.has(candidate.target) && !pinIds.has(candidate.via)) continue;
    if (suppressions.has(stablePair(candidate.source, candidate.target))) continue;
    findings.push({
      key: `bridge:${stablePair(candidate.source, candidate.target)}:${candidate.via}`,
      class: 'bridge',
      summary: `A case-linked structural hole exists between ${nodeLabel(payload, candidate.source)} and ${nodeLabel(payload, candidate.target)} via ${nodeLabel(payload, candidate.via)}.`,
      score: candidate.score,
      evidence: {
        source: candidate.source,
        target: candidate.target,
        via: candidate.via,
        rationale: candidate.why,
      },
    });
  }

  // Motifs matter when they are strong enough to describe the broader case environment.
  for (const motif of motifs.filter((candidate) => candidate.count > 0).slice(0, 6)) {
    findings.push({
      key: `motif:${motif.key}`,
      class: 'motif',
      summary: `${motif.key.replaceAll('_', ' ')} appears ${motif.count} time${motif.count === 1 ? '' : 's'} in the current case scope.`,
      score: motif.strength,
      evidence: { motifKey: motif.key, motifClass: motif.class, count: motif.count, strength: motif.strength },
    });
  }

  findings.sort((left, right) => right.score - left.score || left.key.localeCompare(right.key));
  const summary: string[] = [];
  if (pinnedMissing > 0) summary.push(`${pinnedMissing} pinned node${pinnedMissing === 1 ? ' is' : 's are'} absent from the current retained graph`);
  const critical = findings.filter((finding) => finding.class === 'fragility').length;
  const gaps = findings.filter((finding) => finding.class === 'ecosystem_gap').length;
  if (critical > 0) summary.push(`${critical} pinned structural-dependence warning${critical === 1 ? '' : 's'} require review`);
  if (gaps > 0) summary.push('Target ecosystem remains unreachable through current authorized evidence');
  if (summary.length === 0) summary.push('Case evidence re-evaluated without a new critical gap');

  return {
    caseId: investigation.id,
    evaluatedAt: new Date().toISOString(),
    findings: findings.slice(0, 40),
    pinnedPresent,
    pinnedMissing,
    summary,
  };
}

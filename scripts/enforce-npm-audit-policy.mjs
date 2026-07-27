import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const [auditPath = 'npm-audit.json', policyPath = 'security/npm-audit-policy.json'] = process.argv.slice(2);

const severityRank = {
  info: 0,
  low: 1,
  moderate: 2,
  high: 3,
  critical: 4,
};

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(resolve(process.cwd(), path), 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not read ${label} at ${path}: ${message}`);
  }
}

function assertPolicy(policy) {
  if (policy.schemaVersion !== 1) throw new Error('Unsupported npm audit policy schema');
  if (!severityRank.hasOwnProperty(policy.minimumBlockingSeverity)) {
    throw new Error(`Unknown minimumBlockingSeverity: ${policy.minimumBlockingSeverity}`);
  }

  const expiry = Date.parse(`${policy.expiresOn}T23:59:59.999Z`);
  if (!Number.isFinite(expiry)) throw new Error('npm audit policy has an invalid expiresOn date');
  if (Date.now() > expiry) {
    throw new Error(`npm audit policy expired on ${policy.expiresOn}; review the mobile toolchain advisories before extending it`);
  }
}

const audit = readJson(auditPath, 'npm audit report');
const policy = readJson(policyPath, 'npm audit policy');
assertPolicy(policy);

if (!audit.vulnerabilities || typeof audit.vulnerabilities !== 'object') {
  throw new Error('npm audit report does not contain a vulnerabilities object');
}

const vulnerabilities = audit.vulnerabilities;
const toolchainOnly = new Set(policy.toolchainOnlyPackages ?? []);
const runtimeNeverExempt = new Set(policy.runtimePackagesNeverExempt ?? []);
const minimumRank = severityRank[policy.minimumBlockingSeverity];

function vulnerabilityNames(vulnerability) {
  return (vulnerability.via ?? []).filter((entry) => typeof entry === 'string');
}

function containsDirectAdvisory(vulnerability) {
  return (vulnerability.via ?? []).some((entry) => typeof entry === 'object' && entry !== null);
}

function isToolchainOnlyPath(name, stack = new Set()) {
  if (runtimeNeverExempt.has(name)) return false;
  if (toolchainOnly.has(name)) return true;
  if (stack.has(name)) return false;

  const vulnerability = vulnerabilities[name];
  if (!vulnerability || containsDirectAdvisory(vulnerability)) return false;

  const dependencies = vulnerabilityNames(vulnerability);
  if (dependencies.length === 0) return false;

  const nextStack = new Set(stack);
  nextStack.add(name);
  return dependencies.every((dependency) => isToolchainOnlyPath(dependency, nextStack));
}

const blockers = [];
const acknowledgedToolchain = [];

for (const [name, vulnerability] of Object.entries(vulnerabilities)) {
  const rank = severityRank[vulnerability.severity] ?? -1;
  if (rank < minimumRank) continue;

  if (vulnerability.severity === 'critical' && policy.alwaysBlockCritical) {
    blockers.push({ name, vulnerability, reason: 'critical findings always block' });
    continue;
  }

  if (isToolchainOnlyPath(name)) {
    acknowledgedToolchain.push({ name, vulnerability });
    continue;
  }

  blockers.push({
    name,
    vulnerability,
    reason: runtime reachable, directly advised, or outside the explicit toolchain boundary,
  });
}

const summary = {
  policy: policy.policyName,
  expiresOn: policy.expiresOn,
  blockingThreshold: policy.minimumBlockingSeverity,
  acknowledgedToolchainFindings: acknowledgedToolchain.map(({ name, vulnerability }) => ({
    name,
    severity: vulnerability.severity,
    direct: Boolean(vulnerability.isDirect),
    via: vulnerabilityNames(vulnerability),
  })),
  blockers: blockers.map(({ name, vulnerability, reason }) => ({
    name,
    severity: vulnerability.severity,
    direct: Boolean(vulnerability.isDirect),
    reason,
    via: vulnerabilityNames(vulnerability),
  })),
};

console.log(JSON.stringify(summary, null, 2));

if (blockers.length > 0) {
  console.error('\nProduction dependency policy failed:');
  for (const blocker of blockers) {
    console.error(`- ${blocker.name} (${blocker.vulnerability.severity}): ${blocker.reason}`);
  }
  process.exit(1);
}

console.log(`\nProduction dependency policy passed with ${acknowledgedToolchain.length} expiring toolchain-only finding(s).`);

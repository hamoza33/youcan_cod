import { GmcStatus } from '@prisma/client';

export type GmcDisplayState =
  | 'NOT_SUBMITTED'
  | 'QUEUED'
  | 'PENDING'
  | 'APPROVED'
  | 'LIMITED'
  | 'DISAPPROVED'
  | 'ERROR'
  | 'EXCLUDED';

export type GmcStatusDetails = {
  state: GmcDisplayState;
  summary: string;
  issueCount: number;
  destinations: string[];
};

type UnknownRecord = Record<string, unknown>;

/** Derive the operator-facing state from Merchant API data without changing the DB enum. */
export function deriveGmcStatusDetails(input: {
  response?: unknown;
  destinationStatuses?: unknown;
  issues?: unknown;
  fallback?: GmcStatus | string;
}): GmcStatusDetails {
  const response = record(input.response);
  const productStatus = record(response.productStatus);
  const storedIssues = record(input.issues);
  const destinationStatuses = array(input.destinationStatuses ?? response.destinationStatuses ?? productStatus.destinationStatuses ?? storedIssues.destinationStatuses);
  const issues = array(
    Array.isArray(input.issues)
      ? input.issues
      : storedIssues.itemLevelIssues ?? response.itemLevelIssues ?? response.issues ?? productStatus.itemLevelIssues,
  );
  const impactfulIssues = issues.filter(isImpactfulIssue);
  const destinations = destinationStatuses.map(destinationName).filter((value): value is string => Boolean(value));
  const issueSummaries = impactfulIssues.map(issueSummary).filter(Boolean);
  const text = JSON.stringify({ destinationStatuses, issues: impactfulIssues }).toLowerCase();

  const disapproved = destinationStatuses.some((status) => array(record(status).disapprovedCountries).length > 0)
    || /disapproved|rejected/.test(text);
  const pending = destinationStatuses.some((status) => array(record(status).pendingCountries).length > 0)
    || /pending|under_review|processing/.test(text);
  const approved = destinationStatuses.some((status) => array(record(status).approvedCountries).length > 0)
    || /approved/.test(JSON.stringify(destinationStatuses).toLowerCase());
  const limited = /limited|demoted|restricted/.test(text)
    || (impactfulIssues.length > 0 && (approved || (!disapproved && !pending)))
    || (approved && (disapproved || pending));

  let state = normalizeFallback(input.fallback);
  if (/error|failed/.test(text)) state = 'ERROR';
  else if (limited) state = 'LIMITED';
  else if (disapproved) state = 'DISAPPROVED';
  else if (pending) state = 'PENDING';
  else if (approved) state = 'APPROVED';

  const summary = issueSummaries.length
    ? issueSummaries.slice(0, 3).join(' · ')
    : destinations.length
      ? `Destinations: ${destinations.join(', ')}`
      : state === 'NOT_SUBMITTED' ? 'Not submitted to Merchant Center.' : 'No Merchant issues reported.';

  return { state, summary, issueCount: impactfulIssues.length, destinations };
}

/** LIMITED is intentionally represented by APPROVED in the legacy DB enum; UI derives LIMITED from details. */
export function persistedGmcStatus(details: GmcStatusDetails): GmcStatus {
  if (details.state === 'LIMITED') return GmcStatus.APPROVED;
  return Object.values(GmcStatus).includes(details.state as GmcStatus) ? details.state as GmcStatus : GmcStatus.PENDING;
}

export function merchantIssues(response: unknown) {
  const value = record(response);
  return value.itemLevelIssues ?? value.issues ?? record(value.productStatus).itemLevelIssues ?? null;
}

function destinationName(value: unknown) {
  const destination = record(value);
  return string(destination.reportingContext) ?? string(destination.destination) ?? string(destination.name);
}

function issueSummary(value: unknown) {
  const issue = record(value);
  const title = string(issue.title) ?? string(issue.description) ?? string(issue.code) ?? 'Merchant issue';
  const severity = string(issue.severity);
  return severity ? `${title} (${severity.toLowerCase()})` : title;
}

function isImpactfulIssue(value: unknown) {
  const severity = String(record(value).severity ?? '').toUpperCase();
  return severity !== 'NOT_IMPACTED';
}

function normalizeFallback(value: GmcStatus | string | undefined): GmcDisplayState {
  const normalized = String(value ?? 'NOT_SUBMITTED') as GmcDisplayState;
  return ['NOT_SUBMITTED', 'QUEUED', 'PENDING', 'APPROVED', 'LIMITED', 'DISAPPROVED', 'ERROR', 'EXCLUDED'].includes(normalized)
    ? normalized
    : 'PENDING';
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function string(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

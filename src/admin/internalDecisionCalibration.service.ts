import { analyzeInternalDecisionCalibration, type InternalDecisionCalibrationReport } from './InternalDecisionCalibrationEngine';
import { loadInternalDecisionJournal } from './internalDecisionJournal.service';

/**
 * Loads the caller's private falsifiable decision history and derives a replayable
 * calibration report. No calibration aggregate is persisted separately, preventing
 * stale policy snapshots from drifting away from the underlying resolved journal.
 */
export async function loadInternalDecisionCalibrationReport(
  eventId?: string | null,
): Promise<InternalDecisionCalibrationReport> {
  const journal = await loadInternalDecisionJournal(eventId ?? null);
  return analyzeInternalDecisionCalibration(journal.entries);
}

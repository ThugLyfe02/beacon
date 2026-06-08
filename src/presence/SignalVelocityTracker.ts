/**
 * Beacon Signal Velocity Tracker
 *
 * Tracks short-horizon activity so the Surge Engine can measure *momentum*,
 * not just instantaneous state.
 *
 * Design constraints:
 * - In-memory only. No persistent storage. No Supabase. No network.
 * - Deterministic: every method accepts an explicit `now` (defaults to
 *   Date.now()) so behaviour is fully reproducible in tests.
 * - Rolling 5-minute window. Entries older than the window are pruned lazily
 *   on every read/write, so memory stays bounded to recent activity.
 */

export const VELOCITY_WINDOW_MS = 5 * 60 * 1000; // rolling 5-minute window

export interface VelocitySnapshot {
  /** Signals sent within the rolling 5-minute window. */
  signalsPer5Min: number;
  /** Mutual matches formed within the rolling 5-minute window. */
  mutualsPer5Min: number;
  /** Office hours activations within the rolling 5-minute window. */
  officeHoursActivations: number;
  /**
   * Recent signal velocity as consumed by the Surge Engine. Defined as the
   * number of outbound signals in the trailing window (signals / 5 min).
   */
  recentSignalVelocity: number;
}

export class SignalVelocityTracker {
  private signals: number[] = [];
  private mutuals: number[] = [];
  private officeHours: number[] = [];

  private readonly windowMs: number;

  constructor(windowMs: number = VELOCITY_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /** Record an outbound signal at `now`. */
  recordSignal(now: number = Date.now()): void {
    this.signals.push(now);
    this.prune(now);
  }

  /** Record `count` outbound signals at `now` (used for cumulative deltas). */
  recordSignals(count: number, now: number = Date.now()): void {
    for (let i = 0; i < count; i++) this.signals.push(now);
    this.prune(now);
  }

  /** Record a mutual match at `now`. */
  recordMutual(now: number = Date.now()): void {
    this.mutuals.push(now);
    this.prune(now);
  }

  /** Record `count` mutual matches at `now` (used for cumulative deltas). */
  recordMutuals(count: number, now: number = Date.now()): void {
    for (let i = 0; i < count; i++) this.mutuals.push(now);
    this.prune(now);
  }

  /** Record an office hours activation at `now`. */
  recordOfficeHoursActivation(now: number = Date.now()): void {
    this.officeHours.push(now);
    this.prune(now);
  }

  /** Read the current rolling snapshot without mutating intent. */
  snapshot(now: number = Date.now()): VelocitySnapshot {
    this.prune(now);
    const signalsPer5Min = this.signals.length;
    return {
      signalsPer5Min,
      mutualsPer5Min: this.mutuals.length,
      officeHoursActivations: this.officeHours.length,
      recentSignalVelocity: signalsPer5Min,
    };
  }

  /** Clear all tracked activity (e.g. on event exit). */
  reset(): void {
    this.signals = [];
    this.mutuals = [];
    this.officeHours = [];
  }

  /** Drop entries that have aged out of the rolling window. */
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    this.signals = this.signals.filter((t) => t > cutoff);
    this.mutuals = this.mutuals.filter((t) => t > cutoff);
    this.officeHours = this.officeHours.filter((t) => t > cutoff);
  }
}

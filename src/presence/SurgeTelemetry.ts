/**
 * Surge Telemetry (internal only)
 *
 * Console logging for surge behaviour. No UI dashboard, no network, no
 * persistence. Tracks just enough in-memory aggregate to report rates.
 *
 * Logged events:
 * - Surge transitions
 * - Window activations
 * - Window conversion rate
 * - Missed surge activations
 * - Premium conversion during peak
 */

import type { SurgeLevel } from "./SurgeEngine";

const TAG = "[Surge]";

export class SurgeTelemetry {
  private windowsOpened = 0;
  private windowsConverted = 0;
  private missedActivations = 0;
  private premiumPeakConversions = 0;

  constructor(private readonly eventId: string) {}

  surgeTransition(from: SurgeLevel, to: SurgeLevel, surgeScore: number): void {
    if (from === to) return;
    console.log(`${TAG} transition`, {
      eventId: this.eventId,
      from,
      to,
      surgeScore,
    });
  }

  windowActivated(kind: SurgeLevel, durationSeconds: number): void {
    this.windowsOpened += 1;
    console.log(`${TAG} window.activated`, {
      eventId: this.eventId,
      kind,
      durationSeconds,
      windowsOpened: this.windowsOpened,
    });
  }

  /**
   * Resolve a window when it closes. `converted` = the user engaged (sent a
   * signal or formed a mutual) during the window. Also updates the running
   * conversion rate and missed-activation tally.
   */
  windowResolved(kind: SurgeLevel, converted: boolean): void {
    if (converted) {
      this.windowsConverted += 1;
    } else {
      this.missedActivations += 1;
    }
    console.log(`${TAG} window.resolved`, {
      eventId: this.eventId,
      kind,
      converted,
      conversionRate: this.conversionRate(),
      missedActivations: this.missedActivations,
    });
  }

  premiumConversionDuringPeak(level: SurgeLevel): void {
    this.premiumPeakConversions += 1;
    console.log(`${TAG} premium.peakConversion`, {
      eventId: this.eventId,
      level,
      premiumPeakConversions: this.premiumPeakConversions,
    });
  }

  /** Window conversion rate in [0, 1]; 0 when no windows have opened. */
  conversionRate(): number {
    if (this.windowsOpened === 0) return 0;
    return Math.round((this.windowsConverted / this.windowsOpened) * 100) / 100;
  }
}

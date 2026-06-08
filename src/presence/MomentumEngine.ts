export function computeMomentumScore({
  signalsSent,
  mutualMatches,
  officeHoursActive
}: {
  signalsSent: number;
  mutualMatches: number;
  officeHoursActive: boolean;
}) {
  let score = signalsSent * 2 + mutualMatches * 5;
  if (officeHoursActive) score += 10;
  return Math.min(score, 100);
}

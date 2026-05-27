// Registry of Higgsfield-generated MP4 clips.
// Drop your generated files into assets/motion/ then uncomment the matching
// `require(...)` below. When a key is null, the screen falls back to the
// animated GridBackground — so missing files are not a crash, just a downgrade.
//
// Generation specs + Higgsfield prompts live in assets/motion/README.md.

export const motionAssets = {
  /** Background loop for the OTP / sign-in screen. */
  otp: null as number | null,
  // otp: require('../../assets/motion/otp.mp4') as number | null,

  /** Background loop for the Map empty state ("The room is quiet."). */
  mapQuiet: null as number | null,
  // mapQuiet: require('../../assets/motion/map-quiet.mp4') as number | null,

  /** Background loop behind the Radar disc. */
  radar: null as number | null,
  // radar: require('../../assets/motion/radar.mp4') as number | null,
};

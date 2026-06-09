// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @livekit/react-native (and other modern RN libs) ship a `package.json#exports`
// map whose `react-native` condition points at the correct entry. Without this
// flag, Metro falls back to the legacy `react-native` top-level field which
// points at `src/index` (no extension) and fails to resolve.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;

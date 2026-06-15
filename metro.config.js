// Learn more https://docs.expo.dev/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// @livekit/react-native (and other modern RN libs) ship a `package.json#exports`
// map whose `react-native` condition points at the correct entry. Without this
// flag, Metro falls back to the legacy `react-native` top-level field which
// points at `src/index` (no extension) and fails to resolve.
config.resolver.unstable_enablePackageExports = true;

// `three@0.184` ships static class blocks in its CJS bundle (three.cjs).
// Metro's babel transform skips node_modules by default, so Hermes chokes
// on the unsupported syntax. Prefer the ESM bundle, which lowers to syntax
// Hermes already speaks.
const path = require('path');
const threeEsm = path.join(
  __dirname,
  'node_modules/three/build/three.module.js'
);
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'three') {
    return { type: 'sourceFile', filePath: threeEsm };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;

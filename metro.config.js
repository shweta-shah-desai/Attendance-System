// Learn more: https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// expo-sqlite runs on web through a wa-sqlite WASM build, which Metro only
// bundles if .wasm is treated as an asset.
config.resolver.assetExts.push('wasm');

// wa-sqlite needs SharedArrayBuffer, which browsers only expose to
// cross-origin-isolated pages. Required for `expo start --web`.
config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};

module.exports = config;

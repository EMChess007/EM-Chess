const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Same as Expo's default Metro config, plus Sentry's debug-ID injection so source maps uploaded
// at build/export time can be matched to the exact bundle that produced a crash report.
const config = getSentryExpoConfig(__dirname);

module.exports = config;

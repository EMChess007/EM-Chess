// app.json stays the one place the app is described; this only adds the build identifier (scripts/build-info.cjs, command #27d) to `extra` when the configuration is read - at bundle time.
const { getBuildInfo } = require('./scripts/build-info.cjs');

module.exports = ({ config }) => ({
  ...config,
  extra: { ...config.extra, buildInfo: getBuildInfo() },
});

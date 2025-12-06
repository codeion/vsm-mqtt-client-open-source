const { logger, consoleTransport } = require('react-native-logs');

const LOG = logger.createLogger({
  enabled: true,
  transport: consoleTransport,
  severity: 'debug',
  levels: {
    info: 0,
    get: 1,
    post: 2,
    warn: 3,
    error: 4,
  },
  transportOptions: {
    colors: {
      info: 'white',
      get: 'greenBright',
      post: 'greenBright',
      warn: 'yellowBright',
      error: 'redBright',
    },
    extensionColors: {
      munin: 'blue',
    },
  },
  printDate: false,
});

module.exports = LOG.extend('munin');

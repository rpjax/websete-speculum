'use strict';
process.env.CHROME_EXECUTABLE = process.env.CHROME_EXECUTABLE || '/usr/bin/google-chrome';
const { runPageProjectionSessionUnitTests } = require('../../../../dist/browser/mirror/projection/session/pageProjectionSession.unit.js');
runPageProjectionSessionUnitTests()
  .then(() => {
    console.log('SESSION_UNITS_OK');
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });

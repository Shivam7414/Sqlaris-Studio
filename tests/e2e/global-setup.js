// Makes the sqlaris_e2e database and the config the test server signs in with.
const { execFileSync } = require('node:child_process');

module.exports = () => {
  execFileSync('php', ['tests/e2e/setup.php'], { stdio: 'inherit' });
};

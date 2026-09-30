// Drops the sqlaris_e2e database and the config again.
const { execFileSync } = require('node:child_process');

module.exports = () => {
  execFileSync('php', ['tests/e2e/setup.php', 'drop'], { stdio: 'inherit' });
};

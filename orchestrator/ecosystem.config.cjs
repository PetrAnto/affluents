const path = require('path');

module.exports = {
  apps: [
    {
      name: 'affluents-orchestrator',
      cwd: __dirname,
      script: 'src/index.ts',
      interpreter: path.join(__dirname, '..', 'node_modules', '.bin', 'tsx'),
      max_restarts: 50,
      restart_delay: 5000,
      out_file: path.join(__dirname, 'logs', 'out.log'),
      error_file: path.join(__dirname, 'logs', 'error.log'),
      merge_logs: true,
      time: false,
    },
  ],
};

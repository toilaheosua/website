/** PM2: pm2 start deploy/ecosystem.config.cjs && pm2 save */
module.exports = {
  apps: [
    {
      name: 'site-autopilot',
      cwd: __dirname + '/..',
      script: 'dist/index.js',
      node_args: '--env-file-if-exists=.env',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '600M',
      env: { NODE_ENV: 'production' },
      out_file: './data/pm2-out.log',
      error_file: './data/pm2-err.log',
      merge_logs: true,
      time: true,
    },
  ],
};

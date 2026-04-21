// PM2 process config — CommonJS (.cjs) because the project uses "type":"module"
module.exports = {
  apps: [
    {
      name: 'mediko-chat-api',
      script: 'src/app.js',
      interpreter: 'node',

      // Single instance required — WebSocket state (agentConnections, widgetSubscribers)
      // lives in-memory, so cluster mode would split connections across workers.
      instances: 1,
      exec_mode: 'fork',

      // Restart policy
      max_memory_restart: '512M',
      restart_delay: 3000,
      max_restarts: 10,

      // Logging
      out_file: 'logs/out.log',
      error_file: 'logs/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Watch (off in prod — let CI/CD handle restarts)
      watch: false,

      env: {
        NODE_ENV: 'development',
      },
      env_production: {
        NODE_ENV: 'production',
        LOG_LEVEL: 'warn',
      },
    },
  ],
}

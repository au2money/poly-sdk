module.exports = {
  apps: [
    {
      name: 'auto-copy-trading',
      script: 'node',
      args: [
        '--import', 'tsx/esm',
        'scripts/smart-money/auto-copy-trading.ts'
      ],
      // 自动重启配置
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',

      // 环境变量 (可选，如果不在 .env 中配置)
      env: {
        NODE_ENV: 'production',
      },

      // 日志配置
      error_file: './logs/auto-copy-trading-error.log',
      out_file: './logs/auto-copy-trading-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // 进程管理
      instances: 1,
      exec_mode: 'fork',

      // 崩溃重启延迟
      restart_delay: 4000,

      // 最大重启次数（防止无限循环重启）
      max_restarts: 10,
      min_uptime: '10s',
    }
  ]
};

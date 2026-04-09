/**
 * PM2 Ecosystem Configuration — Phase 3 #16
 * 
 * Single-process SPOF protection. PM2 provides:
 * - Automatic restart on crash
 * - Cluster mode for multi-core utilization (when DB sessions are active)
 * - Log rotation and structured JSON logging
 * - Zero-downtime reloads via `pm2 reload resumexray`
 * 
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 reload resumexray        # Zero-downtime restart
 *   pm2 logs resumexray          # Tail logs
 *   pm2 monit                    # Dashboard
 * 
 * IMPORTANT: Cluster mode requires Phase 3 #13 (DB sessions) to be complete
 * since in-memory Maps are not shared across workers.
 */

module.exports = {
  apps: [{
    name: 'resumexray',
    script: 'server.js',
    
    // §14.1: Pin to 2 workers for Hostinger KVS 2 (2 vCPU / 8 GB).
    // 'max' is dangerous — leaves zero CPU for Caddy, cron, and system processes.
    instances: process.env.PM2_INSTANCES || 2,
    exec_mode: 'cluster',
    
    // Restart policies
    max_restarts: 10,
    min_uptime: '10s',
    // §14.1: Exponential backoff prevents restart storms (100ms → 200ms → 400ms → ...)
    exp_backoff_restart_delay: 100,
    
    // Auto-restart on memory threshold (prevents OOM)
    // §14.1: 750MB per worker × 2 = 1.5GB — within systemd's 4GB MemoryMax
    max_memory_restart: process.env.PM2_MAX_MEMORY || '750M',
    
    // §14.1: Limit V8 heap to match max_memory_restart — prevents V8 from
    // growing beyond what PM2 can detect (RSS vs heap discrepancy)
    node_args: '--max-old-space-size=700',
    
    // Phase 6 Wave 2: Graceful shutdown — 30s allows SSE streams and LLM calls to drain
    kill_timeout: 30000,
    listen_timeout: 10000,
    shutdown_with_message: true,
    wait_ready: true,         // Server sends process.send('ready') when fully initialized
    
    // Environment
    env: {
      NODE_ENV: 'development',
      PORT: 3000,
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    
    // Logging
    log_type: 'json',
    merge_logs: true,
    log_date_format: 'YYYY-MM-DDTHH:mm:ssZ',
    error_file: './logs/pm2-error.log',
    out_file: './logs/pm2-out.log',
    
    // Watch (dev only — disable in production)
    watch: false,
    ignore_watch: ['node_modules', 'db', 'tmp_uploads', 'logs', '.git'],
    
    // Source map support for stack traces
    source_map_support: true,
  }]
};

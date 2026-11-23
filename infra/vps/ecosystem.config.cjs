// TechX LMS processes under pm2 (installed as /opt/lms/ecosystem.config.cjs). cwd is the current release.
const cwd = '/opt/lms/current/apps/api';
const node = '/opt/node24/bin/node';
// Production ignores .env files (ConfigModule), so Node loads the server's private env file into process.env.
const node_args = '--env-file=/opt/lms/shared/.env';
module.exports = {
  apps: [
    { name: 'lms-api', cwd, script: 'dist/main.js', interpreter: node, node_args, env: { NODE_ENV: 'production' }, max_memory_restart: '1G' },
    { name: 'lms-worker', cwd, script: 'dist/worker.js', interpreter: node, node_args, env: { NODE_ENV: 'production' }, max_memory_restart: '1G' },
  ],
};

const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const nextBin = require.resolve('next/dist/bin/next');
const command = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!command) {
  process.stderr.write('Usage: node scripts/hapos-next.js <build|start> [...args]\n');
  process.exit(1);
}

const env = { ...process.env };
if (!env.HAPOS_DIST_DIR) {
  env.HAPOS_DIST_DIR = '.hapos-build';
}

const child = spawn(process.execPath, [nextBin, command, ...extraArgs], {
  cwd: projectRoot,
  stdio: 'inherit',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

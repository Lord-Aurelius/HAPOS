const path = require('node:path');
const { spawn } = require('node:child_process');

const projectRoot = path.resolve(__dirname, '..');
const nextBin = require.resolve('next/dist/bin/next');
const rawArgs = process.argv.slice(2);
const staticFlagIndex = rawArgs.indexOf('--static');
const shouldStaticExport = staticFlagIndex !== -1;

if (shouldStaticExport) {
  rawArgs.splice(staticFlagIndex, 1);
}

const command = rawArgs[0];
const extraArgs = rawArgs.slice(1);

if (!command) {
  process.stderr.write('Usage: node scripts/hapos-next.js <build|start> [...args]\n');
  process.exit(1);
}

const env = { ...process.env };
if (shouldStaticExport) {
  env.HAPOS_STATIC_EXPORT = '1';
}

if (!env.HAPOS_DIST_DIR) {
  env.HAPOS_DIST_DIR = shouldStaticExport ? 'out' : '.hapos-build';
}

if (shouldStaticExport && env.HAPOS_DIST_DIR !== 'out') {
  env.HAPOS_DIST_DIR = 'out';
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

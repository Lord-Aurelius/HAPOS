const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

const next = require('next');

const projectRoot = path.resolve(__dirname, '..');
const localCacheTarget = path.join(process.env.HAPOS_LOCAL_DIST_TARGET || os.tmpdir(), 'HAPOS', 'dist-local');
const localDistLink = path.join(projectRoot, 'dist-local');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

async function ensureLocalDistLink() {
  await fsp.mkdir(localCacheTarget, { recursive: true });

  try {
    const stat = await fsp.lstat(localDistLink);
    if (stat.isSymbolicLink()) {
      return;
    }
    await fsp.rm(localDistLink, { recursive: true, force: true });
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      throw error;
    }
  }

  await fsp.symlink(localCacheTarget, localDistLink, 'junction');
}

async function start() {
  process.env.HAPOS_DIST_DIR = 'dist-local';

  await ensureLocalDistLink();

  const app = next({
    dev: true,
    dir: projectRoot,
    hostname: host,
    port,
  });

  const handle = app.getRequestHandler();
  await app.prepare();

  http
    .createServer((req, res) => handle(req, res))
    .listen(port, host, () => {
      process.stdout.write(`HAPOS local dev server ready on http://${host}:${port}\n`);
    });
}

start().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exit(1);
});

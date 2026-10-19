import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { OneQueue } from './app.mjs';
import { createServer } from './server.mjs';
import { redact } from './util.mjs';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--config')) {
  console.error('Usage: node src/index.mjs [--config /absolute/path/projects.json]'); process.exit(1);
}
const configPath = args.length ? resolve(args[1]) : fileURLToPath(new URL('../projects.json', import.meta.url));
const app = new OneQueue(); let server, stopping;
async function shutdown() {
  if (stopping) return stopping;
  stopping = (async () => { await app.close(); await server?.close(); })();
  return stopping;
}
try {
  await app.init(configPath); server = createServer(app);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  server.server.onclose = () => { void shutdown(); };
  process.stdin.on('end', () => void shutdown());
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void shutdown().then(() => process.exit(0)));
} catch (error) { console.error(redact(error.message)); await shutdown(); process.exitCode = 1; }

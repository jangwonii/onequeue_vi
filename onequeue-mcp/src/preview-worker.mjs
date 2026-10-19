import { pathToFileURL } from 'node:url';
const [modulePath, exportName, database] = process.argv.slice(2);
let server;
async function stop() {
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  process.exit(0);
}
process.on('message', message => { if (message === 'stop') void stop(); });
process.on('disconnect', () => void stop());
process.on('SIGTERM', () => void stop());
try {
  const factory = (await import(pathToFileURL(modulePath).href))[exportName];
  if (typeof factory !== 'function') throw new Error('Preview export must be an HTTP server factory.');
  server = await factory({ database, origin: '' });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  process.send({ type: 'ready', port: server.address().port });
} catch (error) { console.error(error.message); process.exit(1); }

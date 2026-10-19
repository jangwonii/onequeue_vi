import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
const config = { mcpServers: { onequeue: { command: process.execPath, args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url)), '--config', fileURLToPath(new URL('../projects.json', import.meta.url))] } } };
const text = `${JSON.stringify(config, null, 2)}\n`;
if (process.argv.includes('--write')) {
  const path = fileURLToPath(new URL('../mcp-client.local.json', import.meta.url));
  await writeFile(path, text); console.log(`MCP client configuration saved: ${path}`);
} else process.stdout.write(text);

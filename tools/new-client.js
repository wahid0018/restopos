#!/usr/bin/env node
// Create a data folder for a new restaurant:   node tools/new-client.js sharma-restaurant [port]
// Each client keeps its own database, backups and licence in clients/<name>/.  Give every client on the SAME
// computer a different port.
const fs = require('fs'), path = require('path');
const name = (process.argv[2] || '').toLowerCase().replace(/[^a-z0-9_-]/g, '');
const port = +process.argv[3] || 3000;
if (!name) { console.error('Usage: node tools/new-client.js <client-name> [port]'); process.exit(1); }
const dir = path.join(__dirname, '..', 'clients', name);
fs.mkdirSync(path.join(dir, 'backups'), { recursive: true });
const f = path.join(dir, 'config.json');
if (fs.existsSync(f)) { console.log('Already exists: ' + dir); process.exit(0); }
fs.writeFileSync(f, JSON.stringify({ name, port, cloud: null }, null, 2));
console.log('Created ' + dir + '\nStart it with:  node server.js --client ' + name + '\n(or  start.sh ' + name + '  /  start.bat ' + name + ')');

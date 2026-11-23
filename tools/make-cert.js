#!/usr/bin/env node
// Make a self-signed HTTPS certificate (needed for camera / AR on tablets).  node tools/make-cert.js [--data <folder>]
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const i = process.argv.indexOf('--data');
const dir = path.join(i > 0 ? path.resolve(process.argv[i + 1]) : path.join(__dirname, '..', 'data'), 'cert');
const ips = [];
for (const l of Object.values(os.networkInterfaces())) for (const a of l || []) if (a.family === 'IPv4' && !a.internal) ips.push(a.address);
const san = ['DNS:localhost', 'IP:127.0.0.1'].concat(ips.map(x => 'IP:' + x)).join(',');
fs.mkdirSync(dir, { recursive: true });
try {
  cp.execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
    '-days', '3650', '-subj', '/CN=RestoPOS', '-addext', 'subjectAltName=' + san], { stdio: 'inherit' });
  console.log('Certificate written to ' + dir + '  (valid 10 years; names: ' + san + ')\nRestart RestoPOS to enable https.');
} catch (e) { console.error('Could not run openssl (' + e.message + '). Install OpenSSL, or put your own key.pem and cert.pem in ' + dir); process.exit(1); }

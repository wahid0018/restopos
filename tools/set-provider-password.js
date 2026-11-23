#!/usr/bin/env node
// Change the software-provider password.   node tools/set-provider-password.js "NewPassword"
// Updates provider.json (server check) and public/js/provider-hash.js (standalone/online check),
// and prints the SQL line for Supabase.  Keep this tool and the old password to yourself, not the client.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const pw = process.argv[2];
if (!pw || pw.length < 6) { console.error('Usage: node tools/set-provider-password.js "NewPassword"   (at least 6 characters)'); process.exit(1); }
const hash = crypto.createHash('sha256').update('restopos-provider:' + pw).digest('hex');
const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'provider.json'), JSON.stringify({ hash }, null, 2));
fs.writeFileSync(path.join(root, 'public/js/provider-hash.js'), "// SHA-256 of the provider password (never the password itself). Change with: node tools/set-provider-password.js\nexport const PROVIDER_HASH = '" + hash + "';\n");
console.log('Done. New hash: ' + hash + '\n\nSupabase (SQL editor):\n  update public.provider_secret set hash = \'' + hash + '\' where id = 1;\n\nRe-deploy to Netlify and restart the local server for the change to apply.');

#!/usr/bin/env node
// Launcher: checks the Node.js version (plain old syntax on purpose, so it runs even on very old Node) and starts core.js.
var major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 18) {
  console.error('\nRestoPOS needs Node.js 18 or newer. This computer has Node.js ' + process.versions.node + '.');
  console.error('Download the LTS version from https://nodejs.org , install it, then start RestoPOS again.\n');
  process.exit(1);
}
require('./core.js');

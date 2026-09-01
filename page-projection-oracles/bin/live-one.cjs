#!/usr/bin/env node
'use strict';
/**
 * Single-site live oracle (faster lab loop).
 * Usage: SPECULUM_LIVE_ORACLES=1 node bin/live-one.cjs [url]
 */
process.env.SPECULUM_LIVE_ORACLES = '1';
const url = process.argv[2] || process.env.SPECULUM_LIVE_ODDS_URL || 'https://example.com/';
process.env.SPECULUM_LIVE_ODDS_URL = url;

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'live-runner.cjs'), 'utf8');
const patched = src.replace(
  /const sites = \[[\s\S]*?\]\.filter\(\(s\) => s\.url\);/,
  `const sites = [{ id: 'one', url: ${JSON.stringify(url)}, softNav: false }].filter((s) => s.url);`,
);
const tmp = path.join(__dirname, 'live-one.tmp.cjs');
fs.writeFileSync(tmp, patched);
require('child_process')
  .spawn('node', [tmp], { stdio: 'inherit', env: process.env })
  .on('exit', (code) => {
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* */
    }
    process.exit(code || 0);
  });

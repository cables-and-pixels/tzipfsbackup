#!/usr/bin/env node

import fs from 'fs';
import yargs from 'yargs';
import { execSync } from 'child_process';
import { hideBin } from 'yargs/helpers';
import yaml from 'js-yaml';

const argv = yargs(hideBin(process.argv))
  .default({
    backupDir: 'IPFS',
  })
  .help()
  .argv

const index_file = `${argv.backupDir}/index.yaml`;

try {
  const statuses = {};
  const index = yaml.load(fs.readFileSync(index_file, 'utf8'));
  for (let o of index) {
    console.log(`${o.name} [${o.type}]`);
    for (let k of [
      'artifact_uri',
      'display_uri',
      'thumbnail_uri',
      'metadata',
    ]) {
      if (k in o) {
        const url = new URL(o[k]);
        const hash = url.host;
        let status = true;
        if (hash in statuses) {
          status = statuses[hash];
        }
        else {
          const f = `${argv.backupDir}/${hash}`;
          const exists = fs.existsSync(f);
          if (exists) {
            const o = execSync(
              `ipfs add -r --progress=false --only-hash ${f}`,
              { encoding: 'utf-8' }
            );
            for (let line of o.split('\n')) {
              const match = line.match(/^added (\S+) (\S+)$/);
              if (match && match[1] === hash) {
                if (match[2] !== match[1]) {
                  console.log('???', match[2], match[1]);
                  status = false;
                }
              }
            }
          }
          else {
            status = false;
          }
          statuses[hash] = status;
        }
        const xstatus = status ? '✅' : '❌';
        console.log(`  ${xstatus} ${k}: ${hash}`);
      }
    }
  }
}
catch (e) {
  console.error(e);
  process.exit(1);
}

#!/usr/bin/env node

import fetch from 'node-fetch';
import fs from 'fs';
import yaml from 'js-yaml';
import yargs from 'yargs';
import { execSync } from 'child_process';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .usage(
    '$0 [options]',
    'Backup Tezos tokens IPFS data',
    (yargs) => {
      yargs.option('creator', {
        type: 'array',
        describe: 'creator tezos address',
        demandOption: true,
      });
    }
  )
  .default({
    backupDir: 'IPFS',
  })
  .help()
  .version(false)
  .example([
    ['$0 --creator=tz1xxxx --creator=tz1yyyy'],
  ]).argv;

if (!fs.existsSync(argv.backupDir)) {
  fs.mkdirSync(argv.backupDir);
}
process.chdir(argv.backupDir);

const OBJKT_ENDPOINT = 'https://data.objkt.com/v3/graphql';

async function getCreatorTokens(addr, pk) {
  const query = `
query GetCreatorTokens {
  token(
    where: {
      creators: {
        creator_address: {
          _eq: "${addr}"
        },
      },
      pk: { _gt: ${pk} }
    }
    order_by: { pk: asc }
  ) {
    name
    fa { name }
    artifact_uri
    display_uri
    thumbnail_uri
    metadata
    pk
  }
}`;
  const r = await fetch(OBJKT_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      query,
      variables: {},
    }),
  });
  if (r.status !== 200) {
    console.log(r);
    process.exit(1);
  }
  const json = await r.json();
  return json.data.token;
}

try {
  execSync('command -v ipget', { stdio: 'ignore' });
}
catch {
  console.log('Error: ipget command not found.');
  console.log('Please install ipget (see https://dist.ipfs.tech/#ipget)');
  process.exit(1);
}

(async () => {

  process.stdout.write('Getting token data');

  let tokens = [];

  for (let addr of argv.creator) {
    let pk = 0;
    while (true) {
      const page = await getCreatorTokens(addr, pk);
      if (page.length > 0) {
        process.stdout.write('...');
        tokens.push(...page);
        pk = tokens.at(-1).pk;
      }
      else {
        break;
      }
    }
  }
  console.log(' OK');

  const index = [];
  for (let t of tokens) {
    const o = {
      name: t.name,
      type: t.fa.name,
    };
    for (let k of [
      'artifact_uri',
      'display_uri',
      'thumbnail_uri',
      'metadata',
    ]) {
      if (t[k]?.startsWith('ipfs:')) {
        o[k] = t[k];
      }
    }
    index.push(o);
  }
  fs.writeFileSync('index.yaml', yaml.dump(index), 'utf8');

  const hashes = {};

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
        if (!(hash in hashes)) {
          hashes[hash] = 1;
          console.log(`  ${hash}`);
          try {
            const output = execSync(`ipget ${hash}`);
          }
          catch(e) {
            console.log(e);
          }
        }
      }
    }
  }
})();

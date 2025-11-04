#!/usr/bin/env node

import fetch from 'node-fetch';
import fs from 'fs';
import yaml from 'js-yaml';
import yargs from 'yargs';
import { execSync } from 'child_process';
import { hideBin } from 'yargs/helpers';

const argv = yargs(hideBin(process.argv))
  .option('creator', {
    alias: 'c',
    describe: 'Creator tezos address',
    type: 'array',
  })
  .option('holder', {
    alias: 'h',
    describe: 'Holder tezos address',
    type: 'array',
  })
  .option('localBackup', {
    describe: 'Make a local backup (via ipget)',
    coerce: (v) => {
      return v === true ? 'IPFS' : v;
    },
  })
  .option('cidList', {
    describe: 'Build a CID list file',
    coerce: (v) => {
      return v === true ? 'IPFS_CIDs.txt' : v;
    },
  })
  .check((argv) => {
    if (!argv.creator && !argv.holder) {
      throw new Error('Error: select at least one creator/holder');
    }
    if (!argv.localBackup && !argv.cidList) {
      throw new Error('Error: select --localBackup or --cidList');
    }
    return true;
  })
  .version(false)
  .help()
  .example([
    ['$0 --creator=tz1xxxx --creator=tz1yyyy --localBackup'],
    ['$0 --holder=tz1xxxx --holder=tz1yyyy --localBackup=IPFS.2'],
    ['$0 --holder=tz1xxxx --holder=tz1yyyy --cidList'],
  ])
  .argv;

const OBJKT_ENDPOINT = 'https://data.objkt.com/v3/graphql';

async function getTokensPage(where, pk) {
  const query = `
query GetTokens {
  token(
    where: {
      ${where},
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

async function getTokens(where) {
  let pk = 0;
  let tokens = [];
  while (true) {
    const page = await getTokensPage(where, pk);
    if (page.length > 0) {
      tokens.push(...page);
      pk = tokens.at(-1).pk;
    }
    else {
      break;
    }
  }
  return tokens;
}

async function getCreatorTokens(addr) {
  return getTokens(`creators: { creator_address: { _eq: "${addr}" } }`);
}

async function getHolderTokens(addr) {
  return getTokens(`holders: { holder_address: { _eq: "${addr}" }, quantity: { _gt: 0 } }`);
}

function localBackup(index) {
  try {
    execSync('command -v ipget', { stdio: 'ignore' });
  }
  catch {
    console.log('Error: ipget command not found.');
    console.log('Please install ipget (see https://dist.ipfs.tech/#ipget)');
    process.exit(1);
  }

  if (!fs.existsSync(argv.localBackup)) {
    fs.mkdirSync(argv.localBackup);
  }
  process.chdir(argv.localBackup);

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
          hashes[hash] = true;
          if (fs.existsSync(hash)) {
            console.log(`  ${hash} (skipping)`)
          }
          else {
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
  }
}

function cidList(index) {
  let list = '';
  const hashes = {};
  for (let o of index) {
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
          hashes[hash] = true;
          list += hash + '\n';
        }
      }
    }
  }
  fs.writeFileSync(argv.cidList, list, 'utf8');
  console.log(`Wrote ${argv.cidList}.`);
}

(async () => {

  console.log('Getting token data...');

  const tokens = [];

  if (argv.creator) {
    for (let addr of argv.creator) {
      const addrTokens = await getCreatorTokens(addr);
      if (addrTokens.length === 0) {
        console.warn(`Warning: no token created by ${addr}`);
      }
      else {
        tokens.push(...addrTokens);
      }
    }
  }

  if (argv.holder) {
    for (let addr of argv.holder) {
      const addrTokens = await getHolderTokens(addr);
      if (addrTokens.length === 0) {
        console.warn(`Warning: no token holded by ${addr}`);
      }
      else {
        tokens.push(...addrTokens);
      }
    }
  }

  if (tokens.length == 0) {
    console.error('Error: no token selected.');
    process.exit(1);
  }

  console.log('OK');

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

  if (argv.cidList) {
    cidList(index);
  }

  if (argv.localBackup) {
    localBackup(index);
  }

})();


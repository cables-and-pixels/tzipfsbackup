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
  .option('checkLocalBackup', {
    describe: 'Check a local backup',
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
    if (argv.localBackup || argv.cidList) {
      if (!argv.creator && !argv.holder) {
        throw new Error('Error: select at least one creator/holder.');
      }
      return true;
    }
    if (argv.checkLocalBackup) {
      return true;
    }
    throw new Error('Error: nothing to do.');
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
    limit: 500
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
      console.log(page.length)
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

async function getTokenData(creators, holders) {
  console.log('Getting token data...');

  const tokens = [];

  if (creators) {
    for (let addr of creators) {
      const addrTokens = await getCreatorTokens(addr);
      if (addrTokens.length === 0) {
        console.warn(`Warning: no token created by ${addr}`);
      }
      else {
        tokens.push(...addrTokens);
      }
    }
  }

  if (holders) {
    for (let addr of holders) {
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

  return index;
}

function localBackup(index, dirname) {
  try {
    execSync('command -v ipget', { stdio: 'ignore' });
  }
  catch {
    console.log('Error: ipget command not found.');
    console.log('Please install ipget (see https://dist.ipfs.tech/#ipget)');
    process.exit(1);
  }

  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname);
  }
  process.chdir(dirname);

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

function checkLocalBackup(dirname) {
  try {
    execSync('command -v ipget', { stdio: 'ignore' });
  }
  catch {
    console.log('Error: ipfs command not found.');
    console.log('Please install ipfs (see https://dist.ipfs.tech/#kubo)');
    process.exit(1);
  }

  try {
    const index_file = `${dirname}/index.yaml`;
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
            const f = `${dirname}/${hash}`;
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
}

function cidList(index, filename) {
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
  fs.writeFileSync(filename, list, 'utf8');
  console.log(`Wrote ${filename}.`);
}

(async () => {

  if (argv.cidList) {
    const tokens = await getTokenData(argv.creator, argv.holder);
    cidList(tokens, argv.cidList);
  }

  if (argv.localBackup) {
    const tokens = await getTokenData(argv.creator, argv.holder);
    localBackup(tokens, argv.localBackup);
  }

  if (argv.checkLocalBackup) {
    checkLocalBackup(argv.checkLocalBackup);
  }

})();

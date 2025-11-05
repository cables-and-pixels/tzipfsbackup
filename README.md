tzipfsbackup
============

A Node.js script to backup tezos tokens IPFS data, using [objkt.com API](https://docs.objkt.com/product/objkt-protocol/api) and [ipget](https://dist.ipfs.tech/#ipget)

Sample usage:

Make a local backup for creator addresses tz1xxx and tz1yyy:

```
node tzipfsbackup.js --creator=tz1xxx --creator=tz1yyy --localBackup
```

List CIDs for holder tz1xxx:

```
node tzipfsbackup.js --holder=tz1xxx --cidList
```

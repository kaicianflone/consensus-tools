#!/usr/bin/env bash
set -euo pipefail

PKG='@consensus-tools/consensus-tools'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

mkdir -p artifacts/release

npm test

pushd "$TMP" >/dev/null
npm init -y >/dev/null 2>&1
npm i "$PKG@latest" >/dev/null
npx consensus-tools --version
popd >/dev/null

node -e "const fs=require('fs');const cp=require('child_process');const pkg=require('./package.json');const crypto=require('crypto');const lock=fs.readFileSync('package-lock.json');const lockHash=crypto.createHash('sha256').update(lock).digest('hex');const sha=cp.execSync('git rev-parse HEAD').toString().trim();const m={package:pkg.name,version:pkg.version,gitSha:sha,lockfileSha256:lockHash,createdAt:new Date().toISOString()};fs.writeFileSync('artifacts/release/release-manifest.json',JSON.stringify(m,null,2));"
sha256sum package-lock.json > artifacts/release/package-lock.sha256

echo "release verify complete: artifacts/release"
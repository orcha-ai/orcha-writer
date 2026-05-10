import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkOnly = process.argv.includes('--check');
const versionArg = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const semverPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function writeText(relativePath, content) {
  writeFileSync(path.join(root, relativePath), content);
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function writeJson(relativePath, value) {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function markChange(changes, relativePath, current, next) {
  if (current !== next) {
    changes.push({ relativePath, next });
  }
}

function syncCargoTomlVersion(content, filePath, nextVersion) {
  const lines = content.split('\n');
  let inPackage = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === '[package]') {
      inPackage = true;
      continue;
    }

    if (inPackage && trimmed.startsWith('[')) {
      break;
    }

    if (inPackage && /^version\s*=/.test(trimmed)) {
      lines[index] = line.replace(/version\s*=\s*"[^"]+"/, `version = "${nextVersion}"`);
      return lines.join('\n');
    }
  }

  throw new Error(`未找到可同步的版本字段：${filePath}`);
}

function syncCargoLockVersion(content, filePath, packageName, nextVersion) {
  const lines = content.split('\n');
  let inPackage = false;
  let packageMatched = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (line === '[[package]]') {
      inPackage = true;
      packageMatched = false;
      continue;
    }

    if (!inPackage) continue;

    if (line === `name = "${packageName}"`) {
      packageMatched = true;
      continue;
    }

    if (packageMatched && /^version\s*=/.test(line)) {
      lines[index] = `version = "${nextVersion}"`;
      return lines.join('\n');
    }
  }

  throw new Error(`未找到可同步的版本字段：${filePath}`);
}

const packagePath = 'package.json';
const packageJson = readJson(packagePath);
const version = versionArg || packageJson.version;

if (!semverPattern.test(version)) {
  throw new Error(`版本号不符合 semver：${version}`);
}

const changes = [];

if (packageJson.version !== version) {
  const nextPackageJson = { ...packageJson, version };
  markChange(changes, packagePath, JSON.stringify(packageJson), JSON.stringify(nextPackageJson));
  if (!checkOnly) {
    writeJson(packagePath, nextPackageJson);
  }
}

const tauriConfigPath = 'src-tauri/tauri.conf.json';
const tauriConfig = readJson(tauriConfigPath);
if (tauriConfig.version !== version) {
  const nextTauriConfig = { ...tauriConfig, version };
  markChange(changes, tauriConfigPath, JSON.stringify(tauriConfig), JSON.stringify(nextTauriConfig));
  if (!checkOnly) {
    writeJson(tauriConfigPath, nextTauriConfig);
  }
}

const cargoTomlPath = 'src-tauri/Cargo.toml';
const cargoToml = readText(cargoTomlPath);
const nextCargoToml = syncCargoTomlVersion(
  cargoToml,
  cargoTomlPath,
  version,
);
markChange(changes, cargoTomlPath, cargoToml, nextCargoToml);
if (!checkOnly && cargoToml !== nextCargoToml) {
  writeText(cargoTomlPath, nextCargoToml);
}

const cargoLockPath = 'src-tauri/Cargo.lock';
const cargoLock = readText(cargoLockPath);
const nextCargoLock = syncCargoLockVersion(
  cargoLock,
  cargoLockPath,
  'orcha-writer',
  version,
);
markChange(changes, cargoLockPath, cargoLock, nextCargoLock);
if (!checkOnly && cargoLock !== nextCargoLock) {
  writeText(cargoLockPath, nextCargoLock);
}

if (changes.length > 0 && checkOnly) {
  console.error(`版本未同步到 ${version}:`);
  for (const change of changes) {
    console.error(`- ${change.relativePath}`);
  }
  process.exit(1);
}

const changedFiles = changes.map((change) => change.relativePath).join(', ');
console.log(changedFiles ? `版本已同步到 ${version}: ${changedFiles}` : `版本已同步：${version}`);

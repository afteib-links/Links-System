const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SOURCE_PATHS = ['backend/package.json', 'backend/src', 'backend/scripts', 'frontend', 'db', '利用マニュアル'];

function sourceFiles(root) {
  const files = [];
  function visit(relativePath) {
    const absolutePath = path.join(root, relativePath);
    const stats = fs.lstatSync(absolutePath);
    if (stats.isSymbolicLink()) throw new Error(`ビルド元にシンボリックリンクがあります: ${relativePath}`);
    if (stats.isDirectory()) {
      for (const name of fs.readdirSync(absolutePath).sort()) visit(path.join(relativePath, name));
    } else if (stats.isFile()) files.push(relativePath);
  }
  for (const relativePath of SOURCE_PATHS) visit(relativePath);
  return files.sort();
}

function createBuildInfo(root, builtAt = new Date()) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'backend/package.json'), 'utf8'));
  const hash = crypto.createHash('sha256');
  for (const relativePath of sourceFiles(root)) {
    hash.update(relativePath.replaceAll(path.sep, '/'));
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(root, relativePath)));
    hash.update('\0');
  }
  return {
    version: packageJson.version,
    build_id: hash.digest('hex').slice(0, 12),
    built_at: builtAt.toISOString(),
  };
}

if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  const output = path.join(root, 'backend/build-info.json');
  fs.writeFileSync(output, `${JSON.stringify(createBuildInfo(root))}\n`, { flag: 'w' });
}

module.exports = { SOURCE_PATHS, sourceFiles, createBuildInfo };

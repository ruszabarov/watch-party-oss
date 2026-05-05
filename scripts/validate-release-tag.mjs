import { readFileSync } from 'node:fs';

const [component, packageJsonPath, tagPrefix] = process.argv.slice(2);
const tagName = process.env['GITHUB_REF_NAME'];

if (!component || !packageJsonPath || !tagPrefix) {
  console.error(
    'Usage: node scripts/validate-release-tag.mjs <component> <package-json-path> <tag-prefix>',
  );
  process.exit(2);
}

if (!tagName) {
  console.error('GITHUB_REF_NAME is required.');
  process.exit(2);
}

if (!tagName.startsWith(tagPrefix)) {
  console.error(`${component} release tag must start with ${tagPrefix}. Received ${tagName}.`);
  process.exit(1);
}

const tagVersion = tagName.slice(tagPrefix.length);
const { version: packageVersion } = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

if (tagVersion !== packageVersion) {
  console.error(
    `${component} release tag ${tagName} does not match ${packageJsonPath} version ${packageVersion}.`,
  );
  process.exit(1);
}

console.log(`${component} release tag ${tagName} matches ${packageJsonPath}.`);

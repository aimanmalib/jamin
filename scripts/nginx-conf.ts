// Writes the web server config for the container: the template in deploy/ with the security policy and cache
// lifetime taken from config/jamin.json. Used by the Dockerfile at build time.
//   tsx scripts/nginx-conf.ts <template> > nginx.conf
import { readFileSync } from 'node:fs';
import { loadConfig } from '../src/config.js';
import { cspHeader, renderTemplate } from '../src/deploy/site.js';

const templatePath = process.argv[2];
if (!templatePath) {
  console.error('usage: tsx scripts/nginx-conf.ts <template>');
  process.exit(2);
}
const config = loadConfig();
process.stdout.write(renderTemplate(readFileSync(templatePath, 'utf8'), {
  CSP: cspHeader(config.deploy.contentSecurityPolicy, config.electrum.mainnet),
  ASSET_MAX_AGE: String(config.deploy.assetMaxAgeSeconds),
  MEDIA_MAX_AGE: String(config.deploy.mediaMaxAgeSeconds),
}));

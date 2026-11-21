import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const root=path.resolve(path.dirname(url.fileURLToPath(import.meta.url)),'../..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const runtime=read('deploy/cloudflare/worker-runtime.js');
const expected=[
  'var HTML='+JSON.stringify(read('site/index.html'))+';',
  'var CSS='+JSON.stringify(read('site/styles.css'))+';',
  'var APP='+JSON.stringify(read('site/app.js'))+';',
  'var BATTLE_INSIGHTS='+JSON.stringify(read('site/battle-insights.js'))+';',
  'var OWNED_OPTIONS='+JSON.stringify(read('site/owned-options.js'))+';',
  'var OFFLINE_COACH='+JSON.stringify(read('site/offline-coach.js'))+';',
  'var BACKEND_CLIENT='+JSON.stringify(read('site/backend-client.js'))+';',
  'var CATALOG_JSON='+JSON.stringify(read('site/catalog.json'))+';',
  'var GUIDES_JSON='+JSON.stringify(read('site/guides.json'))+';',
  'var MANIFEST='+JSON.stringify(read('site/manifest.webmanifest'))+';',
  'var ICON_SVG='+JSON.stringify(read('site/icon.svg'))+';',
  'var SW='+JSON.stringify(read('site/sw.js'))+';',
  runtime
].join('\n');
const file=path.join(root,'deploy/cloudflare/mvp-worker.js');
if(process.argv.includes('--check')){
  if(fs.readFileSync(file,'utf8')!==expected){console.error('Generated Worker is out of sync. Run node deploy/cloudflare/build-site.mjs');process.exit(1);}
  console.log('Worker bundle matches site source.');
}else{
  fs.writeFileSync(file,expected);
  console.log('Updated '+file);
}

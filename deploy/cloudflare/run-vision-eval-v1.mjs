// Offline JSON evaluation; no image files, provider calls, keys, or network.
import {readFileSync,statSync} from 'node:fs';
import {evaluateVisionFrames} from './coach-vision-v1.mjs';
const file=process.argv[2];
if(!file||process.argv.length!==3||statSync(file).size>4*1024*1024)throw Error('Usage: node deploy/cloudflare/run-vision-eval-v1.mjs reviewed-predictions.json (max 4 MiB)');
const input=JSON.parse(readFileSync(file,'utf8'));
if(input?.version!==1||input.reviewed!==true)throw Error('REVIEWED_DATASET_REQUIRED');
process.stdout.write(JSON.stringify(evaluateVisionFrames(input.rows,input.cards),null,2)+'\n');

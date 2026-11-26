import assert from 'node:assert/strict';
import test from 'node:test';
import {patchCoachIdentity,NEW_TAIL} from './coach-identity-v1.mjs';
const prefix='    {role:"system",content:"شواهد selected_deck_results و allowed_single_swaps. ';
const old='فارسی، تیتر ساده بدون Markdown، حداکثر ۲۴۰ کلمه.';
const fixture='const messages=[\n'+prefix+old+'"},\n{role:"user",content:question}\n];';
test('identity update changes only the known presentation tail',()=>{
  const patched=patchCoachIdentity(fixture);
  assert.equal(patched,fixture.replace(old,NEW_TAIL));
  assert.ok(patched.includes('selected_deck_results و allowed_single_swaps'));
  assert.ok(patched.includes('CRC_COACH_IDENTITY_V1'));
});
test('refuse unknown, duplicate or already patched source',()=>{
  assert.throws(()=>patchCoachIdentity('different'));
  assert.throws(()=>patchCoachIdentity(fixture+'\n'+fixture));
  assert.throws(()=>patchCoachIdentity(patchCoachIdentity(fixture)));
});

import assert from 'node:assert/strict';
import {crewPublicationMonths} from '../lib/crew-publication-months';
const months=['2026-08','2026-09','2026-10'];
assert.deepEqual(crewPublicationMonths(months,[]),['2026-10']);
assert.deepEqual(crewPublicationMonths(months,['--all']),months);
assert.deepEqual(crewPublicationMonths(months,['--month=2026-09']),['2026-09']);
for(const args of [['--month=2026-09','--all'],['--month=2026-09','--month=2026-10'],['--month=2026-13'],['--month=2025-09'],['--month'],['--month=../2026-09']])assert.throws(()=>crewPublicationMonths(months,args));
assert.deepEqual(crewPublicationMonths([],[]),[]);
console.log('September-only month selection passed; latest-month default unchanged, invalid/ambiguous selection rejected before remote access. No uploader executed.');

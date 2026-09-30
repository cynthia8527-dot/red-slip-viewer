import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digest,verifyArchive } from './integrity.mjs';
test('recovery archive rejects missing, extra, swapped or corrupt photos and damaged database bytes',()=>{
 const dump=Buffer.from('database'),photos=new Map([['a',Buffer.from('a')],['b',Buffer.from('b')]]);
 const manifest={dump:digest(dump),photos:Object.fromEntries([...photos].map(([p,b])=>[p,digest(b)]))};
 verifyArchive(manifest,dump,photos);
 assert.throws(()=>verifyArchive(manifest,Buffer.from('broken'),photos),/database archive checksum/);
 for(const bad of [new Map([['a',photos.get('a')]]),new Map([...photos,['extra',Buffer.from('c')]])]) assert.throws(()=>verifyArchive(manifest,dump,bad),/photo inventory/);
 for(const bad of [new Map([['a',photos.get('b')],['b',photos.get('a')]]),new Map([...photos,['a',Buffer.from('broken')]])]) assert.throws(()=>verifyArchive(manifest,dump,bad),/photo checksum/);
});

import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyAcceptanceBrowser} from '../rebuild/browser-acceptance.mjs';
export const oldCommit='665a3efeab078c3cb838796b349f65f9edb5b322';
export const oldEdgeHash='d91b7e3db7ec4e48c3eebff4f25252ac24412434c2592b31d65f99e0ca7da489';
const repo=resolve(import.meta.dirname,'../..');
function run(cmd,args){const r=spawnSync(cmd,args,{cwd:repo,maxBuffer:16*1024*1024});assert.equal(r.status,0,`${cmd} failed; old source unavailable`);return r.stdout;}
export function prepareRollback(work){
 const directory=join(work,'old-source');mkdirSync(directory);
 const archive=join(work,'old-source.tar');
 writeFileSync(archive,run('git',['archive','--format=tar',oldCommit,'index.html','app.js','styles.css','config.js','board','calculator','data','dispatch','vendors','pin','red-slip']));
 run('tar',['-xf',archive,'-C',directory]);
 for(const name of ['board/index.html','calculator/index.html','config.js'])assert.deepEqual(readFileSync(join(directory,name)),run('git',['show',oldCommit+':'+name]));
 const oldEdge=readFileSync(join(repo,'tests/reference/edge-functions/shipments/index.ts'));
 assert.equal(createHash('sha256').update(oldEdge).digest('hex'),oldEdgeHash);
 const edgeDir=join(work,'supabase/functions/shipments-legacy');mkdirSync(edgeDir,{recursive:true});writeFileSync(join(edgeDir,'index.ts'),oldEdge);
 const evidence={kind:'reconstructed-source-not-original-pages-artifact',frontendCommit:oldCommit,confirmedDeploymentRun:35568472588,originalArtifactId:10625561131,originalArtifactUnavailable:true,backend:'shipments v2',backendSourceSha256:oldEdgeHash,archiveSha256:createHash('sha256').update(readFileSync(archive)).digest('hex')};
 writeFileSync(join(work,'rollback-provenance.json'),JSON.stringify(evidence,null,2));
 console.log('ROLLBACK SOURCE '+JSON.stringify(evidence));return directory;
}
export async function verifyRollback({api,sql,token,status,session,directory}){
 const legacyApi=(path,opts)=>api(path.replace('/functions/v1/shipments','/functions/v1/shipments-legacy'),opts);
 for(let n=0;n<40;n++){
  const r=await legacyApi('/functions/v1/shipments',{token,ok:false});
  if(r.status===200)break;
  if(n===39)throw new Error('Legacy Edge failed to start');await new Promise(r=>setTimeout(r,1000));
 }
 assert.equal((await legacyApi('/functions/v1/shipments',{token:'invalid',ok:false})).status,401);
 await verifyAcceptanceBrowser({status,session,api:legacyApi,sql,token,pageRoot:directory,shipmentSlug:'shipments-legacy',proofLabel:'RECONSTRUCTED OLD UI + VERIFIED OLD EDGE'});
 console.log('PASS rollback compatibility: reconstructed deployed-commit pages + verified shipments v2 on upgraded schema; not original artifact or live rollback');
}

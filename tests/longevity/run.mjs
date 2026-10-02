import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { generate,run,InvalidTrace } from './scenario.mjs';
const out=resolve('tests/tmp/longevity');mkdirSync(out,{recursive:true});
const args=process.argv.slice(2), seeds=[0x8527,0x20280229,0xc0ffee];
const reports=[];
const start=performance.now();
async function shrink(ops,signature,seed) {
  let reduced=ops, width=Math.ceil(ops.length/2), attempts=0;
  // Bounded delta debugging, preserving the same failure and rejecting invalid dependencies.
  // Result is deletion-minimal only when the full width=1 pass finishes within the budget.
  while(width>=1 && attempts<80) {
    let changed=false;
    for(let i=0;i<reduced.length && attempts<80;i+=width) {
      const candidate=reduced.slice(0,i).concat(reduced.slice(i+width));attempts++;
      try {await run(candidate,{seed});}
      catch(e) {if(!(e instanceof InvalidTrace)&&e.signature===signature) {reduced=candidate;changed=true;break;} }
    }
    if(!changed)width=Math.floor(width/2);
  }
  return {operations:reduced,attempts,deletionMinimal:width===0};
}
for(const seed of args.includes('--seed')?[Number(args[args.indexOf('--seed')+1])]:seeds) {
  const trace=args.includes('--trace')?JSON.parse(readFileSync(args[args.indexOf('--trace')+1],'utf8')):generate(seed);
  try {
    const report=await run(trace,{seed,onProgress:p=>console.log('MONTH '+JSON.stringify(p))});
    reports.push(report);console.log('SEQUENCE '+JSON.stringify({...report,precision:report.precision.length}));
  } catch(e) {
    const prefix=trace.slice(0,e.step);
    writeFileSync(resolve(out,`failure-${seed}.json`),JSON.stringify(prefix,null,2));
    console.error('FAIL '+JSON.stringify({seed,step:e.step,operation:e.operation,message:e.message}));
    if(args.includes('--shrink')&&!(e instanceof InvalidTrace)) {
      const result=await shrink(prefix,e.signature,seed);
      writeFileSync(resolve(out,`reduced-${seed}.json`),JSON.stringify(result.operations,null,2));console.log('REDUCED '+JSON.stringify({attempts:result.attempts,operations:result.operations.length,deletionMinimal:result.deletionMinimal}));
    }
    process.exitCode=1;break;
  }
  if(args.includes('--trace'))break;
}
const result={reports,wallSeconds:(performance.now()-start)/1000,exactMoney:reports.length===0?'NOT RUN':reports.some(r=>r.precision.length)?'FAIL':'PASS'};
writeFileSync(resolve(out,'results.json'),JSON.stringify(result,null,2));
console.log('RESULT '+JSON.stringify({...result,reports:reports.map(({precision,...r})=>({...r,precisionFindings:precision.length}))}));
if(result.exactMoney==='FAIL') process.exitCode=1;

pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const $=id=>document.getElementById(id);
const state={entries:[],index:0,zoom:1,rotation:0,excelRows:[],lastMatch:null,logs:JSON.parse(localStorage.getItem('redSlipViewerLogs')||'[]')};
const fields=['redNo','date','customer','item','material','weight','unit','price'];

$('slipInput').addEventListener('change',()=>{$('slipCount').textContent=`已選 ${$('slipInput').files.length} 份`;});
$('excelInput').addEventListener('change',async()=>{$('excelCount').textContent=`已選 ${$('excelInput').files.length} 份`;await loadExcels();});
$('startBtn').addEventListener('click',startViewer);
$('prevBtn').addEventListener('click',()=>move(-1));
$('nextBtn').addEventListener('click',()=>move(1));
$('rotateBtn').addEventListener('click',()=>{state.rotation=(state.rotation+90)%360;renderCurrent();});
$('zoomInBtn').addEventListener('click',()=>{state.zoom=Math.min(2.5,state.zoom+.1);renderCurrent();});
$('zoomOutBtn').addEventListener('click',()=>{state.zoom=Math.max(.4,state.zoom-.1);renderCurrent();});
$('searchBtn').addEventListener('click',searchAccounting);
$('applyBtn').addEventListener('click',applyAccounting);
$('confirmBtn').addEventListener('click',()=>saveDecision('確認完成'));
$('manualBtn').addEventListener('click',()=>saveDecision('待人工確認'));
$('exportBtn').addEventListener('click',exportLogs);
$('clearBtn').addEventListener('click',()=>{if(confirm('要清除這個瀏覽器裡的校正紀錄嗎？')){state.logs=[];localStorage.removeItem('redSlipViewerLogs');$('status').textContent='已清除本機校正紀錄。';}});

async function startViewer(){
  const files=[...$('slipInput').files];
  if(!files.length){$('status').textContent='請先選紅單掃描檔。';return;}
  state.entries=[];state.index=0;
  $('status').textContent='正在建立預覽…';
  for(const file of files){
    if(file.type==='application/pdf'||file.name.toLowerCase().endsWith('.pdf')){
      const buf=await file.arrayBuffer();
      const pdf=await pdfjsLib.getDocument({data:buf}).promise;
      for(let p=1;p<=pdf.numPages;p++)state.entries.push({type:'pdf',file,pdf,page:p,name:file.name});
    }else if(file.type.startsWith('image/')){
      state.entries.push({type:'image',file,url:URL.createObjectURL(file),name:file.name});
    }
  }
  if(!state.entries.length){$('status').textContent='沒有可預覽的 PDF 或圖片。';return;}
  $('viewer').classList.remove('hidden');
  $('status').textContent=`已建立 ${state.entries.length} 張／頁預覽。`;
  await renderCurrent();
}

async function renderCurrent(){
  const e=state.entries[state.index];if(!e)return;
  $('fileName').textContent=e.name;
  $('progress').textContent=`${state.index+1} / ${state.entries.length}`;
  $('pageLabel').textContent=e.type==='pdf'?`第 ${e.page} 頁`:'';
  $('zoomLabel').textContent=`${Math.round(state.zoom*100)}%`;
  $('emptyPreview').classList.add('hidden');
  $('pdfCanvas').classList.add('hidden');$('imageView').classList.add('hidden');
  if(e.type==='pdf'){
    const page=await e.pdf.getPage(e.page);
    const viewport=page.getViewport({scale:1.35*state.zoom,rotation:state.rotation});
    const c=$('pdfCanvas');c.width=viewport.width;c.height=viewport.height;c.classList.remove('hidden');
    await page.render({canvasContext:c.getContext('2d'),viewport}).promise;
  }else{
    const img=$('imageView');img.src=e.url;img.style.transform=`scale(${state.zoom}) rotate(${state.rotation}deg)`;img.classList.remove('hidden');
  }
  clearForm();
}

function move(delta){const n=state.index+delta;if(n<0||n>=state.entries.length)return;state.index=n;state.zoom=1;state.rotation=0;renderCurrent();}
function clearForm(){fields.forEach(f=>$(f).value='');$('notes').value='';state.lastMatch=null;$('applyBtn').disabled=true;$('accountingResult').textContent='找到會計資料後會顯示在這裡。';$('matchBadge').className='badge neutral';$('matchBadge').textContent='尚未比對';$('saveStatus').textContent='';}

async function loadExcels(){
  state.excelRows=[];
  for(const file of [...$('excelInput').files]){
    try{
      const wb=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false,raw:false});
      wb.SheetNames.forEach(sn=>{
        const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{header:1,defval:''});
        rows.forEach((r,idx)=>state.excelRows.push({file:file.name,sheet:sn,row:idx+1,values:r.map(v=>String(v??'').trim())}));
      });
    }catch(err){console.error(err);}
  }
  $('status').textContent=`已讀取 ${state.excelRows.length.toLocaleString()} 列會計資料。`;
}

function normalize(s){return String(s??'').replace(/\s+/g,'').replace(/\.0$/,'');}
function findHeaderIndex(rows,keywords){
  for(let i=0;i<Math.min(rows.length,30);i++){
    const vals=rows[i].values.map(v=>normalize(v));
    for(let c=0;c<vals.length;c++)if(keywords.some(k=>vals[c].includes(k)))return c;
  }
  return -1;
}
function extractFields(match){
  const sameSheet=state.excelRows.filter(r=>r.file===match.file&&r.sheet===match.sheet);
  const valueAt=(keys)=>{const i=findHeaderIndex(sameSheet,keys);return i>=0?(match.values[i]||''):''};
  return {
    redNo:valueAt(['紅單號','單號','單據號'])||$('redNo').value,
    date:valueAt(['日期','時間']),customer:valueAt(['客戶','公司','廠商']),item:valueAt(['品名','處理方式','項目']),material:valueAt(['材質']),weight:valueAt(['重量','數量']),unit:valueAt(['單位']),price:valueAt(['單價','價格']),source:`${match.file}/${match.sheet}/${match.row}`
  };
}

function searchAccounting(){
  const no=normalize($('redNo').value);
  if(!no){$('accountingResult').textContent='請先輸入紅單號。';return;}
  if(!state.excelRows.length){$('accountingResult').textContent='尚未讀入會計 Excel。';return;}
  let matches=state.excelRows.filter(r=>r.values.some(v=>normalize(v)===no));
  if(!matches.length&&no.length>=4)matches=state.excelRows.filter(r=>r.values.some(v=>normalize(v).includes(no)));
  if(!matches.length){state.lastMatch=null;$('applyBtn').disabled=true;$('matchBadge').className='badge warn';$('matchBadge').textContent='找不到會計答案';$('accountingResult').textContent='找不到相同紅單號。';return;}
  const m=matches[0];state.lastMatch=extractFields(m);$('applyBtn').disabled=false;$('matchBadge').className='badge good';$('matchBadge').textContent=`找到 ${matches.length} 筆`;
  $('accountingResult').innerHTML=`<div><strong>來源：</strong>${esc(m.file)} / ${esc(m.sheet)} / 第 ${m.row} 列</div>`+Object.entries(state.lastMatch).filter(([k])=>k!=='source').map(([k,v])=>`<div><strong>${labelFor(k)}：</strong>${esc(v||'—')}</div>`).join('');
}
function applyAccounting(){if(!state.lastMatch)return;fields.forEach(f=>{if(state.lastMatch[f]!==undefined)$(f).value=state.lastMatch[f];});$('saveStatus').textContent='已套用會計欄位，請看紅單確認。';}
function saveDecision(status){
  const e=state.entries[state.index];
  const rec={time:new Date().toLocaleString('zh-TW'),status,file:e.name,page:e.type==='pdf'?e.page:'',...Object.fromEntries(fields.map(f=>[f,$(f).value.trim()])),notes:$('notes').value.trim(),accountingSource:state.lastMatch?.source||''};
  state.logs.push(rec);localStorage.setItem('redSlipViewerLogs',JSON.stringify(state.logs));$('saveStatus').textContent=`已儲存：${status}。目前共 ${state.logs.length} 筆。`;if(state.index<state.entries.length-1)setTimeout(()=>move(1),200);
}
function exportLogs(){
  if(!state.logs.length){$('status').textContent='目前沒有校正紀錄可下載。';return;}
  const headers=['time','status','file','page','redNo','date','customer','item','material','weight','unit','price','notes','accountingSource'];
  const csv='\ufeff'+[headers.join(','),...state.logs.map(r=>headers.map(h=>`"${String(r[h]??'').replace(/"/g,'""')}"`).join(','))].join('\r\n');
  const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`紅單校正紀錄_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function labelFor(k){return ({redNo:'紅單號',date:'日期',customer:'客戶',item:'品名／處理方式',material:'材質',weight:'重量',unit:'單位',price:'單價'})[k]||k;}

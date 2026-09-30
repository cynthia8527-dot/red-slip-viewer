// Fetch a complete list using immutable UUID ordering, independent of display sort.
// No partial result is published if a later page fails. This is not a cross-request snapshot.
export async function readAllRows(buildQuery, compare) {
  const rows=[];
  let cursor='';
  try {
    for(let page=0;page<400;page++){
      let query=buildQuery().order('id',{ascending:true}).limit(500);
      if(cursor)query=query.gt('id',cursor);
      const {data,error}=await query;
      if(error)throw error;
      if(!Array.isArray(data))throw new Error('清單回應格式不正確，請重新整理');
      if(data.length===0)return {data:compare?rows.sort(compare):rows,error:null};
      for(const row of data){
        if(typeof row.id!=='string'||row.id<=cursor)throw new Error('清單分頁順序異常，請重新整理');
        cursor=row.id;rows.push(row);
      }
      // Probe again even after a short page: the server may enforce a smaller cap.
    }
    throw new Error('資料量超過完整清單讀取範圍，請聯絡管理員；未顯示不完整結果');
  }catch(error){return {data:null,error};}
}
export const byText = field => (a,b)=>String(a[field]||'').localeCompare(String(b[field]||''),'zh-Hant')||a.id.localeCompare(b.id);

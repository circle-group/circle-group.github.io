'use strict';
const el=id=>document.getElementById(id);
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let records=[],selected=[],page=0,downloads={entries:{}};
const size=25;
function render(){
 const q=el('search').value.trim().toLowerCase(),split=el('split').value;
 selected=records.filter(r=>(!q||[r.md_id,r.source,r.pdb].some(v=>v.toLowerCase().includes(q)))&&(!split||r.split===split));
 const total=Math.max(1,Math.ceil(selected.length/size));page=Math.max(0,Math.min(page,total-1));
 el('count').textContent=`${selected.length.toLocaleString()} ${selected.length===1?"trajectory":"trajectories"}`;
 el('catalog').innerHTML=selected.length?'<div class="table-wrap"><table><thead><tr><th>Trajectory ID</th><th>Source</th><th>Length / chains</th><th>Partition</th><th>Download from Hugging Face</th></tr></thead><tbody>'+selected.slice(page*size,(page+1)*size).map(r=>`<tr><td><a href="/research/RNADynBench/entry/${encodeURIComponent(r.md_id)}/">${escapeHtml(r.md_id)}</a></td><td>${escapeHtml(r.pdb)}</td><td>${r.length} nt / ${r.chains.length}</td><td>${r.split}</td><td class="sample-downloads">${window.sampleDownloadActions(downloads.entries[r.md_id])}</td></tr>`).join('')+'</tbody></table></div>':'<p class="empty">No matching trajectories. Try another ID or reset the partition.</p>';
 el('page').textContent=`Page ${page+1} of ${total}`;el('prev').disabled=page===0;el('next').disabled=page>=total-1;el('csv').disabled=!selected.length;
 const params=new URLSearchParams();if(q)params.set('search',el('search').value.trim());if(split)params.set('split',split);history.replaceState(null,'',location.pathname+(params.size?'?'+params:''));
}
function changed(){page=0;render();}
el('filters').addEventListener('submit',e=>e.preventDefault());el('filters').addEventListener('input',changed);el('filters').addEventListener('change',changed);el('filters').addEventListener('reset',()=>setTimeout(changed,0));
el('prev').onclick=()=>{page--;render();};el('next').onclick=()=>{page++;render();};
el('csv').onclick=()=>{const fields=['md_id','source','length','chains','split'];const cell=v=>'"'+String(Array.isArray(v)?v.join('|'):v).replaceAll('"','""')+'"';const csv=[fields.join(','),...selected.map(r=>fields.map(f=>cell(r[f])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));const a=document.createElement('a');a.href=url;a.download='rnadynbench-subset.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
const catalogElement=el('catalog');
Promise.all([catalogElement.dataset.catalogUrl,catalogElement.dataset.downloadsUrl].map(async url=>{if(!url)throw Error('Missing data URL');const r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw Error('Unavailable');return r.json();})).then(([catalog,links])=>{
 if(!Array.isArray(catalog)||!links?.entries||!catalog.every(r=>typeof r.md_id==='string'&&/^RDB[0-9]{6}__/.test(r.md_id)&&Object.hasOwn(links.entries,r.md_id)))throw Error('Incompatible catalog');
 records=catalog;downloads=links;const p=new URLSearchParams(location.search);for(const id of ['search','split'])if(p.has(id))el(id).value=p.get(id);render();
}).catch(()=>{el('count').textContent='Catalog could not be loaded. Reload to retry.';});

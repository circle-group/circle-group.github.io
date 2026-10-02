'use strict';
window.sampleDownloadActions=function(entry){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 if(!entry?.folder_url)return '<small>Coming soon</small><div class="actions">'+['View files ↗','XTC ↓','GRO ↓','PDB ↓','Copy download command'].map(x=>`<button disabled>${x}</button>`).join('')+'</div>';
 const link=(url,label)=>`<a class="button" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
 return '<div class="actions">'+link(entry.folder_url,'View files ↗')+['xtc','gro','pdb'].map(x=>link(entry.files[x],x.toUpperCase()+' ↓')).join('')+`</div><details><summary>Download this sample</summary><p>Requires the Hugging Face CLI.</p><pre>${esc(entry.command)}</pre><button data-copy-command="${esc(entry.command)}">Copy download command</button><span class="copy-status" role="status"></span></details>`;
};
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-copy-command]');if(!b)return;
 const status=b.parentElement.querySelector('.copy-status');
 try{await navigator.clipboard.writeText(b.dataset.copyCommand);status.textContent=' Command copied.';}
 catch{status.textContent=' Clipboard unavailable. Select and copy the command above.';}
});

document.querySelectorAll(".compact-menu a").forEach(a=>a.addEventListener("click",()=>{a.closest("details").open=false;}));

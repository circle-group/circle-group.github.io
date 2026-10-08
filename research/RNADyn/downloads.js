'use strict';
window.sampleDownloadActions=function(entry){
 const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 if(!entry?.folder_url)return '<small>Download pending</small>';
 return `<a class="button" href="${esc(entry.folder_url)}" target="_blank" rel="noopener noreferrer">View data (Box) ↗</a>`;
};
document.addEventListener('click',async event=>{
 const b=event.target.closest('[data-copy-command]');if(!b)return;
 const status=b.parentElement.querySelector('.copy-status');
 try{await navigator.clipboard.writeText(b.dataset.copyCommand);status.textContent=' Copied!';setTimeout(()=>{if(status.textContent===' Copied!')status.textContent='';},2500);}
 catch{status.textContent=b.classList.contains('citation-copy-inline')?' Copy failed. Please try again.':' Clipboard unavailable. Select and copy the text manually.';}
});

document.querySelectorAll(".compact-menu a").forEach(a=>a.addEventListener("click",()=>{a.closest("details").open=false;}));

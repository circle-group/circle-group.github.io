document.querySelectorAll('[data-case]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-case]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  document.querySelectorAll('[data-panel]').forEach(panel => {
    panel.hidden = panel.dataset.panel !== button.dataset.case;
    if (panel.hidden) panel.querySelectorAll('video').forEach(video => video.pause());
  });
}));

document.querySelectorAll('[data-generation-split]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-generation-split]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
  document.querySelectorAll('[data-generation-panel]').forEach(panel => {
    panel.hidden = panel.dataset.generationPanel !== button.dataset.generationSplit;
  });
}));

const heroVideos=[...document.querySelectorAll('.hero-rna video')];
if(heroVideos.length){
 const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
 const pause=()=>{heroVideos.forEach(v=>v.pause());};
 const play=async()=>{heroVideos[1].currentTime=heroVideos[0].currentTime;const results=await Promise.allSettled(heroVideos.map(v=>v.play()));if(results.some(r=>r.status==='rejected'))pause();};
 heroVideos[0].addEventListener('timeupdate',()=>{if(!heroVideos[0].paused&&Math.abs(heroVideos[0].currentTime-heroVideos[1].currentTime)>.15)heroVideos[1].currentTime=heroVideos[0].currentTime;});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();});
 reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)pause();});
 if(!reducedMotion.matches)play();
}

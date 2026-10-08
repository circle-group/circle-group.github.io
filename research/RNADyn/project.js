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

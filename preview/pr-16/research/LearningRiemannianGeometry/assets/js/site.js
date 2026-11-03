(() => {
  'use strict';

  const navToggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('.site-nav');

  navToggle?.addEventListener('click', () => {
    const isOpen = nav?.classList.toggle('open') ?? false;
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  nav?.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      navToggle?.setAttribute('aria-expanded', 'false');
    });
  });

  const tabs = [...document.querySelectorAll('[role="tab"][data-tab]')];
  const panels = [...document.querySelectorAll('[role="tabpanel"][data-panel]')];

  function activateTab(tab) {
    const selected = tab.dataset.tab;
    tabs.forEach((item) => {
      const active = item === tab;
      item.setAttribute('aria-selected', String(active));
      item.tabIndex = active ? 0 : -1;
    });
    panels.forEach((panel) => {
      const active = panel.dataset.panel === selected;
      panel.hidden = !active;
    });
    tab.focus({ preventScroll: true });
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activateTab(tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let next = index;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      activateTab(tabs[next]);
    });
  });

  const dialog = document.querySelector('.lightbox');
  const dialogImage = dialog?.querySelector('img');
  const dialogCaption = dialog?.querySelector('figcaption');
  const closeButton = dialog?.querySelector('.lightbox-close');

  document.querySelectorAll('[data-lightbox]').forEach((trigger) => {
    trigger.addEventListener('click', () => {
      if (!dialog || !dialogImage || !dialogCaption) return;
      const sourceImage = trigger.querySelector('img');
      dialogImage.src = trigger.dataset.lightbox || '';
      dialogImage.alt = sourceImage?.alt || 'Expanded scientific figure';
      dialogCaption.textContent = trigger.dataset.caption || '';
      dialog.showModal();
    });
  });

  closeButton?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  const bibtex = document.querySelector('#bibtex')?.textContent?.trim() || '';
  const toast = document.querySelector('.toast');
  let toastTimer;

  document.querySelectorAll('[data-copy-bib]').forEach((button) => {
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(bibtex);
      } catch {
        const textArea = document.createElement('textarea');
        textArea.value = bibtex;
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
      }

      if (toast) {
        clearTimeout(toastTimer);
        toast.classList.add('show');
        toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1700);
      }
    });
  });
})();

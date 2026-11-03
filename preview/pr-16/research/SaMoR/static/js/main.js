/* SAMoR project page — minimal JS
   - dark/light theme toggle
   - reveal-on-scroll for .reveal sections
   - bibtex copy button
*/

(function () {
  'use strict';

  // ── Theme toggle ──
  const themeBtn = document.getElementById('theme-toggle');
  const themeIcon = document.getElementById('theme-toggle-icon');
  const root = document.documentElement;
  const STORE_KEY = 'samor.theme';
  function applyTheme(t) {
    if (t === 'dark') root.setAttribute('data-theme', 'dark');
    else root.removeAttribute('data-theme');
    if (themeIcon) themeIcon.textContent = t === 'dark' ? '☀' : '◐';
  }
  const saved = localStorage.getItem(STORE_KEY);
  if (saved) applyTheme(saved);
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) applyTheme('dark');
  if (themeBtn) {
    themeBtn.addEventListener('click', () => {
      const cur = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      applyTheme(cur);
      localStorage.setItem(STORE_KEY, cur);
    });
  }

  // ── Reveal-on-scroll ──
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add('is-visible');
          io.unobserve(e.target);
        }
      });
    },
    { rootMargin: '0px 0px -10% 0px', threshold: 0.05 }
  );
  document.querySelectorAll('.reveal').forEach((el) => io.observe(el));

  // ── Nav dropdown (click toggle for touch + accessibility) ──
  document.querySelectorAll('.nav-dropdown').forEach((dd) => {
    const btn = dd.querySelector('.nav-dropdown-btn');
    if (!btn) return;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dd.classList.toggle('open');
      btn.setAttribute('aria-expanded', String(isOpen));
    });
    dd.querySelectorAll('.nav-dropdown-menu a').forEach((a) =>
      a.addEventListener('click', () => {
        dd.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      })
    );
  });
  document.addEventListener('click', (e) => {
    document.querySelectorAll('.nav-dropdown.open').forEach((dd) => {
      if (!dd.contains(e.target)) {
        dd.classList.remove('open');
        const btn = dd.querySelector('.nav-dropdown-btn');
        if (btn) btn.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // ── Double-click image/gif lightbox ──
  const lightbox = document.getElementById('lightbox');
  const lbImg = document.getElementById('lightbox-img');
  const lbCap = document.getElementById('lightbox-caption');
  if (lightbox && lbImg) {
    const openLB = (src, alt) => {
      lbImg.src = src;
      lbImg.alt = alt || '';
      lbCap.textContent = alt || '';
      lightbox.classList.add('visible');
      lightbox.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
    };
    const closeLB = () => {
      lightbox.classList.remove('visible');
      lightbox.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      // free memory after fade
      setTimeout(() => { if (!lightbox.classList.contains('visible')) lbImg.src = ''; }, 300);
    };
    // Bind dblclick to all imgs that are "content" (skip tiny icons)
    document.querySelectorAll('img').forEach((img) => {
      if (img.id === 'lightbox-img') return;
      img.style.cursor = 'zoom-in';
      img.addEventListener('dblclick', (e) => {
        e.preventDefault();
        openLB(img.currentSrc || img.src, img.alt);
      });
    });
    lightbox.addEventListener('click', closeLB);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && lightbox.classList.contains('visible')) closeLB();
    });
  }

  // ── BibTeX copy ──
  const copyBtn = document.getElementById('copy-bib');
  const bibBody = document.getElementById('bibtex-body');
  if (copyBtn && bibBody) {
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(bibBody.textContent.trim());
        copyBtn.textContent = '✓ copied';
        copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'copy';
          copyBtn.classList.remove('copied');
        }, 1600);
      } catch (err) {
        copyBtn.textContent = '✗ failed';
        setTimeout(() => (copyBtn.textContent = 'copy'), 1600);
      }
    });
  }
})();

// Copy BibTeX
(function () {
  const btn = document.getElementById('copyBtn');
  const code = document.getElementById('bibtex');
  if (!btn || !code) return;
  btn.addEventListener('click', function () {
    const text = code.innerText;
    navigator.clipboard.writeText(text).then(function () {
      const prev = btn.textContent;
      btn.textContent = 'Copied!';
      btn.classList.add('is-done');
      setTimeout(function () {
        btn.textContent = prev;
        btn.classList.remove('is-done');
      }, 1600);
    });
  });
})();

// Active section highlight in nav
(function () {
  const links = Array.from(document.querySelectorAll('.nav__links a'));
  const map = new Map();
  links.forEach(function (a) {
    const id = a.getAttribute('href').slice(1);
    const sec = document.getElementById(id);
    if (sec) map.set(sec, a);
  });
  if (!('IntersectionObserver' in window) || map.size === 0) return;
  const obs = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      if (e.isIntersecting) {
        links.forEach(function (l) { l.style.color = ''; });
        const a = map.get(e.target);
        if (a) a.style.color = 'var(--ink)';
      }
    });
  }, { rootMargin: '-45% 0px -50% 0px', threshold: 0 });
  map.forEach(function (_a, sec) { obs.observe(sec); });
})();

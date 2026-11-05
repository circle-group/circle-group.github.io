// Load before MathJax; keep math settings independent of the page interactions.
window.MathJax = {
  tex: {
    inlineMath: { '[+]': [['$', '$']] },
    tags: 'ams'
  },
  output: {
    displayOverflow: 'scroll'
  }
};

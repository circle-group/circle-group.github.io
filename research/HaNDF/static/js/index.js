// Frame sliders (projection steps) and before/after wipe comparisons. No dependencies.
(function () {
  function initFrameSliders() {
    var panels = document.querySelectorAll('.interpolation-video-column');
    Array.prototype.forEach.call(panels, function (panel) {
      var wrapper = panel.querySelector('.interpolation-image-wrapper');
      var slider = panel.querySelector('input[type=range]');
      var label = panel.querySelector('.frame-label');
      if (!wrapper || !slider) return;
      var frames = (wrapper.getAttribute('data-frames') || '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      var labels = (slider.getAttribute('data-labels') || '').split(',').map(function (s) { return s.trim(); });
      if (!frames.length) return;
      var images = frames.map(function (src) {
        var img = new Image();
        img.src = src;
        img.draggable = false;
        img.oncontextmenu = function () { return false; };
        return img;
      });
      slider.min = 0;
      slider.max = frames.length - 1;
      slider.step = 1;
      function show(i) {
        i = Math.max(0, Math.min(frames.length - 1, parseInt(i, 10) || 0));
        var img = images[i];
        img.alt = wrapper.getAttribute('data-alt') || '';
        wrapper.innerHTML = '';
        wrapper.appendChild(img);
        if (label && labels[i]) label.textContent = labels[i];
      }
      slider.addEventListener('input', function () { show(slider.value); });
      show(slider.value || 0);
    });
  }

  function initCompares() {
    var compares = document.querySelectorAll('.compare');
    Array.prototype.forEach.call(compares, function (box) {
      var after = box.querySelector('.compare-after');
      var handle = box.querySelector('.compare-handle');
      var range = box.querySelector('.compare-range');
      if (!after || !handle || !range) return;
      function set(v) {
        v = Math.max(0, Math.min(100, parseFloat(v) || 0));
        after.style.clipPath = 'inset(0 0 0 ' + v + '%)';
        handle.style.left = v + '%';
      }
      range.addEventListener('input', function () { set(range.value); });
      set(range.value || 50);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { initFrameSliders(); initCompares(); });
  } else {
    initFrameSliders();
    initCompares();
  }
})();

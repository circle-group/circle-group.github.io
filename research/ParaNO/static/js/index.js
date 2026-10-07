window.HELP_IMPROVE_VIDEOJS = false;

var INTERP_BASE = "./static/interpolation/stacked";
var NUM_INTERP_FRAMES = 240;

var interp_images = [];
function preloadInterpolationImages() {
  for (var i = 0; i < NUM_INTERP_FRAMES; i++) {
    var path = INTERP_BASE + '/' + String(i).padStart(6, '0') + '.jpg';
    interp_images[i] = new Image();
    interp_images[i].src = path;
  }
}

function setInterpolationImage(i) {
  var image = interp_images[i];
  image.ondragstart = function() { return false; };
  image.oncontextmenu = function() { return false; };
  $('#interpolation-image-wrapper').empty().append(image);
}


$(document).ready(function() {
    // Check for click events on the navbar burger icon
    $(".navbar-burger").click(function() {
      // Toggle the "is-active" class on both the "navbar-burger" and the "navbar-menu"
      $(".navbar-burger").toggleClass("is-active");
      $(".navbar-menu").toggleClass("is-active");

    });

    var options = {
			slidesToScroll: 1,
			slidesToShow: 1,
			loop: true,
			infinite: true,
			autoplay: false,
			autoplaySpeed: 3000,
    }

		// Initialize all div with carousel class
    var carousels = bulmaCarousel.attach('.carousel', options);

    // Loop on each carousel initialized
    for(var i = 0; i < carousels.length; i++) {
    	// Add listener to  event
    	carousels[i].on('before:show', state => {
    		console.log(state);
    	});
    }

    // Access to bulmaCarousel instance of an element
    var element = document.querySelector('#my-element');
    if (element && element.bulmaCarousel) {
    	// bulmaCarousel instance is available as element.bulmaCarousel
    	element.bulmaCarousel.on('before-show', function(state) {
    		console.log(state);
    	});
    }

    /*var player = document.getElementById('interpolation-video');
    player.addEventListener('loadedmetadata', function() {
      $('#interpolation-slider').on('input', function(event) {
        console.log(this.value, player.duration);
        player.currentTime = player.duration / 100 * this.value;
      })
    }, false);*/
    bulmaSlider.attach();

    // Results Interactive Comparison Viewer Setup
    function setupResultsViewer(config) {
      var $slider = $(config.sliderId);
      var $comparisonImg = $(config.imageId);
      var $viewBadge = $(config.badgeId);
      var $btnAutoRotate = $(config.autoRotateId);
      var $materialButtons = $(config.materialButtonsClass);
      var basePath = config.basePath;

      if (!$slider.length || !$comparisonImg.length) return;

      var currentMaterial = 'albedo';
      var NUM_VIEWS = 6;
      var imageCache = {};
      var autoRotateTimer = null;

      function preloadMaterialViews(material) {
        if (!imageCache[material]) {
          imageCache[material] = [];
          for (var i = 0; i < NUM_VIEWS; i++) {
            var viewStr = String(i).padStart(4, '0');
            var img = new Image();
            img.src = basePath + 'comparison_' + material + '_view_' + viewStr + '.webp';
            imageCache[material].push(img);
          }
        }
      }

      // Preload active material
      preloadMaterialViews(currentMaterial);

      // Asynchronously preload other materials
      setTimeout(function() {
        $materialButtons.each(function() {
          var mat = $(this).data('material');
          if (mat) preloadMaterialViews(mat);
        });
      }, 1200);

      function updateResultsDisplay() {
        var viewIndex = parseInt($slider.val(), 10);
        var viewStr = String(viewIndex).padStart(4, '0');
        $comparisonImg.attr('src', basePath + 'comparison_' + currentMaterial + '_view_' + viewStr + '.webp');
        if ($viewBadge.length) {
          $viewBadge.text('View ' + (viewIndex + 1) + ' / ' + NUM_VIEWS);
        }
      }

      $slider.on('input change', function() {
        stopAutoRotate();
        updateResultsDisplay();
      });

      $materialButtons.on('click', function() {
        $materialButtons.removeClass('is-info is-selected');
        $(this).addClass('is-info is-selected');
        currentMaterial = $(this).data('material');
        preloadMaterialViews(currentMaterial);
        updateResultsDisplay();
      });

      function startAutoRotate() {
        autoRotateTimer = setInterval(function() {
          var nextVal = (parseInt($slider.val(), 10) + 1) % NUM_VIEWS;
          $slider.val(nextVal);
          updateResultsDisplay();
        }, 800);
        $btnAutoRotate.addClass('is-info');
        $btnAutoRotate.html('<span class="icon is-small"><i class="fas fa-pause"></i></span><span>Pause</span>');
      }

      function stopAutoRotate() {
        if (autoRotateTimer) {
          clearInterval(autoRotateTimer);
          autoRotateTimer = null;
        }
        $btnAutoRotate.removeClass('is-info');
        $btnAutoRotate.html('<span class="icon is-small"><i class="fas fa-play"></i></span><span>Auto-rotate</span>');
      }

      $btnAutoRotate.on('click', function() {
        if (autoRotateTimer) {
          stopAutoRotate();
        } else {
          startAutoRotate();
        }
      });
    }

    // Initialize UV Texture Fitting Viewer
    setupResultsViewer({
      sliderId: '#results-rotation-slider-uv',
      imageId: '#results-comparison-image-uv',
      badgeId: '#view-angle-badge-uv',
      autoRotateId: '#btn-auto-rotate-uv',
      materialButtonsClass: '.material-btn-uv',
      basePath: './static/figures/results/uv/'
    });

    // Initialize Multi-View Optimization Viewer
    setupResultsViewer({
      sliderId: '#results-rotation-slider-mv',
      imageId: '#results-comparison-image-mv',
      badgeId: '#view-angle-badge-mv',
      autoRotateId: '#btn-auto-rotate-mv',
      materialButtonsClass: '.material-btn-mv',
      basePath: './static/figures/results/mv/'
    });

})

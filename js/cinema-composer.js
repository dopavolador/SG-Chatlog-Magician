/**
 * Cinema Composer Module
 * Live HTML preview + canvas export for compositing chatlog onto background images.
 */
(function() {
  'use strict';

  let bgImageSrc = null;  // data URL of the background image
  let bgImage = null;     // Image object for canvas export

  const FRAME_PRESETS = {
    'none':           0,
    'letterbox-239':  0.12,
    'letterbox-185':  0.065,
    'letterbox-21':   0.095,
    '4-3':            0.04
  };

  const STORAGE_KEY = 'cinemaComposerState';

  const state = {
    frame: 'none',
    posX: 5,
    posY: 50,
    scale: 100,
    cropWidth: 1920,
    cropHeight: 1080,
    cropOffsetX: 50,
    cropOffsetY: 50
  };

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e) {}
  }

  function loadState() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved) {
        if (saved.frame && FRAME_PRESETS.hasOwnProperty(saved.frame)) state.frame = saved.frame;
        if (typeof saved.posX === 'number') state.posX = saved.posX;
        if (typeof saved.posY === 'number') state.posY = saved.posY;
        if (typeof saved.scale === 'number') state.scale = saved.scale;
        if (typeof saved.cropWidth === 'number') state.cropWidth = saved.cropWidth;
        if (typeof saved.cropHeight === 'number') state.cropHeight = saved.cropHeight;
        if (typeof saved.cropOffsetX === 'number') state.cropOffsetX = saved.cropOffsetX;
        if (typeof saved.cropOffsetY === 'number') state.cropOffsetY = saved.cropOffsetY;
      }
    } catch(e) {}
  }

  function init() {
    // Restore persisted settings
    loadState();
    applyStateToUI();

    // Collapsible header
    var header = document.querySelector('.cinema-composer-header');
    var body = document.getElementById('cinemaComposerBody');
    if (header && body) {
      header.addEventListener('click', function() {
        var expanded = this.getAttribute('aria-expanded') === 'true';
        this.setAttribute('aria-expanded', !expanded);
        body.style.display = expanded ? 'none' : 'block';
      });
      header.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.click(); }
      });
    }

    // Background image import
    var bgInput = document.getElementById('bgImageInput');
    var bgBtn = document.getElementById('bgImageBtn');
    var bgClear = document.getElementById('bgImageClearBtn');
    if (bgBtn && bgInput) {
      bgBtn.addEventListener('click', function() { bgInput.click(); });
      bgInput.addEventListener('change', handleBgImageSelect);
    }
    if (bgClear) bgClear.addEventListener('click', clearBgImage);

    // Range sliders — all update live preview immediately
    bindRange('chatlogPosX',      'chatlogPosXVal',      '%', function(v) { state.posX = v; saveState(); });
    bindRange('chatlogPosY',      'chatlogPosYVal',      '%', function(v) { state.posY = v; saveState(); });
    bindRange('chatlogScale',     'chatlogScaleVal',     '%', function(v) { state.scale = v; saveState(); });

    // Crop controls
    bindRange('cropOffsetY', 'cropOffsetYVal', '%', function(v) { state.cropOffsetY = v; saveState(); });
    bindRange('cropOffsetX', 'cropOffsetXVal', '%', function(v) { state.cropOffsetX = v; saveState(); });
    bindNumberInput('cropWidth', function(v) { state.cropWidth = v; saveState(); });
    bindNumberInput('cropHeight', function(v) { state.cropHeight = v; saveState(); });

    // Crop reset button
    var cropResetBtn = document.getElementById('cropResetBtn');
    if (cropResetBtn) {
      cropResetBtn.addEventListener('click', function() {
        if (bgImage) {
          state.cropWidth = bgImage.naturalWidth;
          state.cropHeight = bgImage.naturalHeight;
          state.cropOffsetX = 50;
          state.cropOffsetY = 50;
        } else {
          state.cropWidth = 1920;
          state.cropHeight = 1080;
          state.cropOffsetX = 50;
          state.cropOffsetY = 50;
        }
        saveState();
        applyStateToUI();
        updateLivePreview();
      });
    }

    // Frame preset buttons
    document.querySelectorAll('.cinema-frame-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        document.querySelectorAll('.cinema-frame-btn').forEach(function(b) { b.classList.remove('active'); });
        btn.classList.add('active');
        state.frame = btn.getAttribute('data-frame');
        saveState();
        updateLivePreview();
      });
    });

    // Export button
    var exportBtn = document.getElementById('cinemaExportBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportComposition);

    // Watch for chatlog changes to auto-update the preview clone
    var observer = new MutationObserver(function() {
      if (bgImageSrc) updateLivePreview();
    });
    var output = document.getElementById('output');
    if (output) {
      observer.observe(output, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style'] });
    }
  }

  function bindRange(inputId, valId, suffix, setter) {
    var input = document.getElementById(inputId);
    var valSpan = document.getElementById(valId);
    if (!input) return;
    input.addEventListener('input', function() {
      var v = parseInt(this.value);
      setter(v);
      if (valSpan) valSpan.textContent = v + suffix;
      updateLivePreview();
    });
  }

  function bindNumberInput(inputId, setter) {
    var input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('change', function() {
      var v = parseInt(this.value);
      if (isNaN(v) || v < parseInt(this.min)) v = parseInt(this.min);
      if (v > parseInt(this.max)) v = parseInt(this.max);
      this.value = v;
      setter(v);
      updateLivePreview();
    });
  }

  // ────────────────────────────────────────
  //  Background image handling
  // ────────────────────────────────────────

  function handleBgImageSelect(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('Por favor selecciona un archivo de imagen válido.');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      alert('La imagen es demasiado grande. Máximo 20MB.');
      return;
    }

    var reader = new FileReader();
    reader.onload = function(ev) {
      var src = ev.target.result;
      var img = new Image();
      img.onload = function() {
        bgImage = img;
        bgImageSrc = src;
        // Keep saved crop config if it fits within the image; otherwise use native resolution
        if (state.cropWidth > img.naturalWidth || state.cropHeight > img.naturalHeight) {
          state.cropWidth = img.naturalWidth;
          state.cropHeight = img.naturalHeight;
          state.cropOffsetX = 50;
          state.cropOffsetY = 50;
        }
        saveState();
        applyStateToUI();
        var clearBtn = document.getElementById('bgImageClearBtn');
        if (clearBtn) clearBtn.style.display = 'inline-block';
        // Process current input so chatlog is up to date before preview
        if (typeof processOutput === 'function') processOutput();
        enableExport();
        // Wait for DOM to settle after processOutput before cloning into preview
        setTimeout(updateLivePreview, 100);
      };
      img.onerror = function() { alert('No se pudo cargar la imagen.'); };
      img.src = src;
    };
    reader.readAsDataURL(file);
  }

  function clearBgImage() {
    bgImage = null;
    bgImageSrc = null;
    var els = {
      clear: document.getElementById('bgImageClearBtn'),
      input: document.getElementById('bgImageInput'),
      exportBtn: document.getElementById('cinemaExportBtn'),
      container: document.getElementById('cinemaPreviewContainer')
    };
    if (els.clear) els.clear.style.display = 'none';
    if (els.input) els.input.value = '';
    if (els.exportBtn) els.exportBtn.disabled = true;
    if (els.container) els.container.style.display = 'none';
  }

  function enableExport() {
    var btn = document.getElementById('cinemaExportBtn');
    if (btn) btn.disabled = false;
  }

  function applyStateToUI() {
    // Sync sliders
    var posX = document.getElementById('chatlogPosX');
    var posXVal = document.getElementById('chatlogPosXVal');
    if (posX) { posX.value = state.posX; if (posXVal) posXVal.textContent = state.posX + '%'; }

    var posY = document.getElementById('chatlogPosY');
    var posYVal = document.getElementById('chatlogPosYVal');
    if (posY) { posY.value = state.posY; if (posYVal) posYVal.textContent = state.posY + '%'; }

    var scale = document.getElementById('chatlogScale');
    var scaleVal = document.getElementById('chatlogScaleVal');
    if (scale) { scale.value = state.scale; if (scaleVal) scaleVal.textContent = state.scale + '%'; }

    // Sync frame preset button
    document.querySelectorAll('.cinema-frame-btn').forEach(function(btn) {
      btn.classList.toggle('active', btn.getAttribute('data-frame') === state.frame);
    });

    // Sync crop controls
    var cropW = document.getElementById('cropWidth');
    if (cropW) cropW.value = state.cropWidth;
    var cropH = document.getElementById('cropHeight');
    if (cropH) cropH.value = state.cropHeight;
    var cropOY = document.getElementById('cropOffsetY');
    var cropOYVal = document.getElementById('cropOffsetYVal');
    if (cropOY) { cropOY.value = state.cropOffsetY; if (cropOYVal) cropOYVal.textContent = state.cropOffsetY + '%'; }
    var cropOX = document.getElementById('cropOffsetX');
    var cropOXVal = document.getElementById('cropOffsetXVal');
    if (cropOX) { cropOX.value = state.cropOffsetX; if (cropOXVal) cropOXVal.textContent = state.cropOffsetX + '%'; }
  }

  // ────────────────────────────────────────
  //  LIVE HTML PREVIEW  (no canvas, no domtoimage)
  //  Clones the #output HTML and overlays it on the bg image via CSS
  // ────────────────────────────────────────

  function updateLivePreview() {
    if (!bgImageSrc) return;

    var container = document.getElementById('cinemaPreviewContainer');
    var livePreview = document.getElementById('cinemaLivePreview');
    var bgEl = document.getElementById('cinemaLivePreviewBg');
    var chatlogEl = document.getElementById('cinemaLivePreviewChatlog');
    var barTop = document.getElementById('cinemaLiveBarTop');
    var barBottom = document.getElementById('cinemaLiveBarBottom');

    if (!container || !livePreview) return;
    container.style.display = 'block';

    var natW = bgImage ? bgImage.naturalWidth : 1920;
    var natH = bgImage ? bgImage.naturalHeight : 1080;
    var cropW = Math.min(state.cropWidth, natW);
    var cropH = Math.min(state.cropHeight, natH);

    // Aspect ratio of the crop area
    var cropAspect = cropW / cropH;

    // The preview wrapper uses padding-bottom trick to maintain crop aspect ratio
    livePreview.style.width = '100%';
    livePreview.style.height = '0';
    livePreview.style.paddingBottom = (100 / cropAspect) + '%';

    // Position the background image within the crop window
    // The image fills the crop area (cover-style based on the dominant axis)
    var scaleX = cropW / natW;
    var scaleY = cropH / natH;

    // We are cropping: image is shown at its native resolution relative to the crop
    // The image should be sized so 1 image-pixel = 1 crop-pixel, then positioned
    // But in preview we scale everything to fit the preview container width
    // bgEl should be sized to (natW/cropW * 100)% of the container width
    var bgWidthPct = (natW / cropW) * 100;
    var bgHeightPct = (natH / cropH) * 100;

    bgEl.style.position = 'absolute';
    bgEl.style.width = bgWidthPct + '%';
    bgEl.style.height = bgHeightPct + '%';
    bgEl.style.maxWidth = 'none';

    // Offset: map cropOffsetX/Y (0-100%) to the image position
    // When offset is 0, show left/top edge; when 100, show right/bottom edge
    var maxOffsetX = bgWidthPct - 100;   // max % the image can shift left
    var maxOffsetY = bgHeightPct - 100;  // max % the image can shift up
    var imgLeft = -(state.cropOffsetX / 100) * maxOffsetX;
    var imgTop = -(state.cropOffsetY / 100) * maxOffsetY;
    bgEl.style.left = imgLeft + '%';
    bgEl.style.top = imgTop + '%';

    bgEl.src = bgImageSrc;

    // Clone chatlog output into the preview overlay — copy ALL classes for exact styling
    var output = document.getElementById('output');
    if (output) {
      chatlogEl.innerHTML = output.innerHTML;
      // Copy all classes from #output so .output, .font-smoothed, .is-small, .is-large, .background-active etc. apply
      chatlogEl.className = 'cinema-live-chatlog ' + output.className;

      // Copy the inline font-size from #output (set by the font size slider)
      var computedFontSize = output.style.fontSize || window.getComputedStyle(output).fontSize;
      if (computedFontSize) {
        chatlogEl.style.fontSize = computedFontSize;
      }

      // Force fully transparent background — no blur, no rgba
      chatlogEl.style.backgroundColor = 'transparent';
      chatlogEl.style.backdropFilter = 'none';
      chatlogEl.style.webkitBackdropFilter = 'none';
    }

    // Scale relative to the CROP area size, not the full image
    var previewDisplayWidth = livePreview.clientWidth || livePreview.offsetWidth;
    var previewRatio = previewDisplayWidth / cropW;

    // Scale 1:1 — at scale 100%, the chatlog keeps its natural pixel size
    // relative to the export resolution (same as pasting a screenshot in Photoshop)
    var finalScale = previewRatio * (state.scale / 100);

    // Left-aligned positioning: posX% from left edge, posY% centers vertically
    chatlogEl.style.left = state.posX + '%';
    chatlogEl.style.top = state.posY + '%';
    chatlogEl.style.transform = 'translate(0, -50%) scale(' + finalScale + ')';
    chatlogEl.style.transformOrigin = 'top left';

    // Frame bars (always top/bottom)
    var barFrac = FRAME_PRESETS[state.frame];
    if (barFrac) {
      var barPct = (barFrac * 100) + '%';
      barTop.style.height = barPct;
      barBottom.style.height = barPct;
      barTop.style.display = 'block';
      barBottom.style.display = 'block';
    } else {
      barTop.style.display = 'none';
      barBottom.style.display = 'none';
    }
  }

  // ────────────────────────────────────────
  //  EXPORT — canvas compositing via domtoimage (only on export click)
  // ────────────────────────────────────────

  function exportComposition() {
    if (!bgImage) {
      alert('Importa una imagen de fondo primero.');
      return;
    }

    var livePreview = document.getElementById('cinemaLivePreview');
    if (!livePreview) return;

    showLoadingIndicator();

    // Render at the crop resolution
    var previewW = livePreview.offsetWidth;
    var previewH = livePreview.offsetHeight;
    var natW = bgImage.naturalWidth;
    var natH = bgImage.naturalHeight;
    var cropW = Math.min(state.cropWidth, natW);
    var cropH = Math.min(state.cropHeight, natH);
    var renderScale = cropW / previewW;

    var opts = {
      bgcolor: '#000000',
      width: Math.round(cropW),
      height: Math.round(cropH),
      style: {
        transform: 'scale(' + renderScale + ')',
        transformOrigin: 'top left'
      },
      filter: function(node) {
        if (node.tagName === 'LINK' && node.href &&
            (node.href.includes('cdnjs.cloudflare.com') || node.href.includes('fonts.googleapis.com'))) {
          return false;
        }
        return true;
      }
    };

    domtoimage.toPng(livePreview, opts).then(function(dataUrl) {
      var a = document.createElement('a');
      a.href = dataUrl;
      a.download = generateCinemaFilename();
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      hideLoadingIndicator();
    }).catch(function(err) {
      hideLoadingIndicator();
      alert('Error al exportar: ' + (err.message || err));
      console.error('Cinema export error:', err);
    });
  }

  function generateCinemaFilename() {
    return new Date()
      .toLocaleString()
      .replaceAll(',', '_')
      .replaceAll(' ', '_')
      .replaceAll('/', '-')
      .replace('__', '_')
      .replaceAll(':', '-') + '_cinema_chatlog.png';
  }

  // Init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

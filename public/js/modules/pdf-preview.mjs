import { el, esc, safeHtml, uiIcon } from './ui-helpers.mjs';

// ── PDF.js bootstrap ─────────────────────────────────────────────
// PDF.js is loaded as a <script type="module"> from the CDN in index.html.
// We access it via the global `pdfjsLib` it exposes.
// The worker URL must match the CDN version exactly.
const PDFJS_CDN_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155';

function getPdfjsLib() {
  return window.pdfjsLib || null;
}

function ensurePdfjsWorker() {
  const lib = getPdfjsLib();
  if (!lib) return false;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    lib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN_BASE}/pdf.worker.min.mjs`;
  }
  return true;
}

// ── Canvas-per-page renderer ─────────────────────────────────────
async function renderPdfPages(pdfDoc, container, devicePixelRatio = 1) {
  container.innerHTML = '';

  const totalPages = pdfDoc.numPages;
  const scale = Math.min(devicePixelRatio, 2) * 1.2; // crisp but not too heavy
  const containerWidth = Math.max(280, container.clientWidth - 32);
  const containerHeight = Math.max(420, container.clientHeight - 32);

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const pageWrapper = document.createElement('div');
    pageWrapper.className = 'pdf-page-wrapper';
    if (totalPages === 1) {
      const fittedWidth = Math.min(860, containerWidth, containerHeight * (viewport.width / viewport.height));
      pageWrapper.style.width = `${Math.max(280, Math.round(fittedWidth))}px`;
      pageWrapper.style.maxWidth = '100%';
    }

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    // CSS width = natural paper width so it fills container
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    canvas.style.display = 'block';
    // Prevent context-menu "Save image as" from offering the PDF page as a PNG download
    canvas.addEventListener('contextmenu', e => e.preventDefault());

    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;

    pageWrapper.appendChild(canvas);
    container.appendChild(pageWrapper);
  }
}

// ── Main controller factory ──────────────────────────────────────
export function createPdfPreviewController({
  state,
  clearPdfPreviewObjectUrl,
  getActiveScanId,
  getPreviewVariantKey,
  currentScanTokenQuery,
  currentPreviewProfileQuery,
}) {
  if (!state) {
    throw new Error('PDF preview controller requires shared state.');
  }

  // Internal pdfjs document reference for cleanup
  let _currentPdfDoc = null;

  function applyCanvasContainerSize(container) {
    if (!container) return;
    const viewportFactor = state.focusMode ? 0.9 : 0.75;
    const maxH = state.focusMode ? 1400 : 1100;
    const height = Math.max(420, Math.min(maxH, window.innerHeight * viewportFactor));
    container.style.height = `${height}px`;
    container.style.maxHeight = `${height}px`;
  }

  function setFocusMode(active) {
    state.focusMode = active;
    const viewerOverlay = el('pdf-viewer-overlay');
    const focusBtn = el('pdf-toggle-fullscreen');
    const container = el('pdf-canvas-container');

    if (viewerOverlay) viewerOverlay.classList.toggle('is-focus-mode', active);
    document.body.classList.toggle('pdf-focus-mode', active);
    if (focusBtn) focusBtn.textContent = active ? 'Exit Focus View' : 'Focus View';
    applyCanvasContainerSize(container);
  }

  function setupControls() {
    if (state.controlsInitialized) {
      applyCanvasContainerSize(el('pdf-canvas-container'));
      return;
    }
    state.controlsInitialized = true;

    const fullscreenBtn = el('pdf-toggle-fullscreen');
    fullscreenBtn?.addEventListener('click', () => setFocusMode(!state.focusMode));

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.focusMode) setFocusMode(false);
    });

    window.addEventListener('resize', () => {
      applyCanvasContainerSize(el('pdf-canvas-container'));
    });

    applyCanvasContainerSize(el('pdf-canvas-container'));
  }

  // No-op setMode — kept for API compatibility with app.js callers
  function setMode(_mode) {}

  async function reloadPreview(scanId, { force = false } = {}) {
    const container = el('pdf-canvas-container');
    if (!container) return;

    const resolvedScanId = Number.parseInt(String(scanId || getActiveScanId() || ''), 10);
    const previewKey = getPreviewVariantKey
      ? getPreviewVariantKey(resolvedScanId, 'resume')
      : `${resolvedScanId || 'invalid'}:${currentPreviewProfileQuery ? currentPreviewProfileQuery() : ''}`;

    if (
      !force &&
      state.lastRenderedPdfPreviewKey === previewKey &&
      container.querySelector('.pdf-page-wrapper')
    ) {
      applyCanvasContainerSize(container);
      return;
    }

    if (!force && state.loadingPdfPreviewKey === previewKey) {
      return;
    }

    // Abort any in-flight request
    if (reloadPreview._abortController) {
      reloadPreview._abortController.abort();
    }
    const abortController = new AbortController();
    reloadPreview._abortController = abortController;

    const requestKey = `${resolvedScanId || 'invalid'}-${Date.now()}`;
    container.dataset.previewRequestKey = requestKey;

    // Tear down previous pdfjs doc to free memory
    if (_currentPdfDoc) {
      try { _currentPdfDoc.destroy(); } catch { /* ignore */ }
      _currentPdfDoc = null;
    }

    // Handle invalid scan ID
    if (!Number.isInteger(resolvedScanId) || resolvedScanId <= 0) {
      _showError(container, 'We could not resolve this scan preview. Start a new targeted scan and try again.');
      return;
    }

    applyCanvasContainerSize(container);
    _showSkeleton(container);
    state.loadingPdfPreviewKey = previewKey;

    const url = `/api/agent/preview/${resolvedScanId}?t=${Date.now()}${currentScanTokenQuery()}${currentPreviewProfileQuery ? currentPreviewProfileQuery() : ''}`;

    try {
      // ── Fetch the PDF blob via our authenticated route ──
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { Accept: 'application/pdf' },
        signal: abortController.signal,
      });

      if (container.dataset.previewRequestKey !== requestKey) return;

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok || !contentType.includes('application/pdf')) {
        const bodyText = await response.text().catch(() => '');
        let errorMessage = 'Unable to load the PDF preview right now.';
        if (contentType.includes('application/json')) {
          try {
            const payload = JSON.parse(bodyText);
            errorMessage = payload.error || errorMessage;
          } catch { /* keep fallback */ }
        } else if (bodyText) {
          const match = bodyText.match(/<p[^>]*>(.*?)<\/p>/i);
          if (match) {
            const parser = document.createElement('div');
            parser.innerHTML = match[1];
            errorMessage = parser.textContent?.trim() || errorMessage;
          }
        }
        _showError(container, errorMessage, resolvedScanId);
        state.loadingPdfPreviewKey = null;
        return;
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        _showError(container, 'The preview file was empty. Please regenerate this scan.', resolvedScanId);
        state.loadingPdfPreviewKey = null;
        return;
      }

      if (container.dataset.previewRequestKey !== requestKey) return;

      // ── Hand blob to PDF.js — never touch iframe or blob:// URLs ──
      if (!ensurePdfjsWorker()) {
        _showError(container, 'PDF renderer is still loading. Please wait a moment and try again.', resolvedScanId);
        state.loadingPdfPreviewKey = null;
        return;
      }

      const arrayBuffer = await blob.arrayBuffer();
      if (container.dataset.previewRequestKey !== requestKey) return;

      const pdfjsLib = getPdfjsLib();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdfDoc = await loadingTask.promise;

      if (container.dataset.previewRequestKey !== requestKey) {
        pdfDoc.destroy();
        return;
      }

      _currentPdfDoc = pdfDoc;
      _hideSkeleton(container);
      await renderPdfPages(pdfDoc, container, window.devicePixelRatio || 1);
      state.lastRenderedPdfPreviewKey = previewKey;
      state.loadingPdfPreviewKey = null;

    } catch (error) {
      if (error?.name === 'AbortError') return;
      _hideSkeleton(container);
      _showError(container, error?.message || 'Unable to load the PDF preview right now.', resolvedScanId);
      state.loadingPdfPreviewKey = null;
    }
  }

  // ── Private helpers ──────────────────────────────────────────
  function _showSkeleton(container) {
    let skeleton = container.querySelector('.preview-skeleton');
    if (!skeleton) {
      skeleton = document.createElement('div');
      skeleton.className = 'preview-skeleton';
      skeleton.innerHTML = safeHtml(
        '<div class="loader"></div><p class="body-sm text-muted" style="margin-top:var(--sp-3)">Rendering preview…</p>'
      );
      skeleton.style.cssText =
        'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem;';
    }
    skeleton.style.display = 'flex';
    // Prepend so it shows above any stale canvas
    container.innerHTML = '';
    container.appendChild(skeleton);
  }

  function _hideSkeleton(container) {
    container.querySelector('.preview-skeleton')?.remove();
  }

  function _showError(container, message, resolvedScanId) {
    container.innerHTML = '';
    state.lastRenderedPdfPreviewKey = null;
    const errorDiv = document.createElement('div');
    errorDiv.className = 'pdf-error-message';
    errorDiv.style.cssText = 'padding:3rem;text-align:center;color:var(--text-muted);';
    errorDiv.innerHTML = safeHtml(`
      <div style="display:flex;justify-content:center;margin-bottom:1rem;opacity:0.5">${uiIcon('file', { size: 40, stroke: 1.8 })}</div>
      <h4 style="color:var(--text-main);margin-bottom:0.5rem">Preview not available</h4>
      <p class="body-sm">${esc(message || 'Unable to load preview.')}</p>
      ${resolvedScanId ? `<button
        class="btn btn-primary btn-sm"
        style="margin-top:1rem"
        data-action="reload-pdf-preview"
        data-scan-id="${esc(String(resolvedScanId))}"
      >Retry</button>` : ''}
    `);
    container.appendChild(errorDiv);
  }

  return {
    reloadPreview,
    setFocusMode,
    setMode,   // no-op, kept for compat
    setupControls,
  };
}

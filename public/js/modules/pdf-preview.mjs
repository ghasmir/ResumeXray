import { el, esc, safeHtml, uiIcon } from './ui-helpers.mjs';

function applyPdfFrameSize(frame, state) {
  if (!frame) return;
  const viewportFactor = state.focusMode ? 0.9 : state.mode === 'detailed' ? 0.84 : 0.62;
  const maxHeight = state.focusMode ? 1400 : state.mode === 'detailed' ? 1200 : 900;
  const height = Math.max(320, Math.min(maxHeight, window.innerHeight * viewportFactor));
  frame.style.height = `${height}px`;
  frame.style.width = '100%';
}

export function createPdfPreviewController({
  state,
  clearPdfPreviewObjectUrl,
  getActiveScanId,
  currentScanTokenQuery,
  currentPreviewProfileQuery,
}) {
  if (!state) {
    throw new Error('PDF preview controller requires shared state.');
  }

  function setMode(mode) {
    state.mode = mode;
    const container = document.querySelector('.pdf-preview-container');
    const previewFrame = el('pdf-preview-frame');
    const standardBtn = el('pdf-view-standard');
    const detailedBtn = el('pdf-view-detailed');

    if (container) {
      container.classList.toggle('is-detailed', mode === 'detailed');
    }
    if (previewFrame) {
      applyPdfFrameSize(previewFrame, state);
    }
    if (standardBtn) standardBtn.classList.toggle('active', mode === 'standard');
    if (detailedBtn) detailedBtn.classList.toggle('active', mode === 'detailed');
  }

  function setFocusMode(active) {
    state.focusMode = active;
    const viewerOverlay = el('pdf-viewer-overlay');
    const focusBtn = el('pdf-toggle-fullscreen');

    if (viewerOverlay) {
      viewerOverlay.classList.toggle('is-focus-mode', active);
    }
    document.body.classList.toggle('pdf-focus-mode', active);
    if (focusBtn) {
      focusBtn.textContent = active ? 'Exit Focus View' : 'Focus View';
    }
    if (active && window.innerWidth < 768) {
      setMode('detailed');
    } else {
      setMode(state.mode);
    }
  }

  function setupControls() {
    if (state.controlsInitialized) {
      setMode(state.mode);
      return;
    }
    state.controlsInitialized = true;

    const standardBtn = el('pdf-view-standard');
    const detailedBtn = el('pdf-view-detailed');
    const openTabBtn = el('pdf-open-new-tab');
    const fullscreenBtn = el('pdf-toggle-fullscreen');

    standardBtn?.addEventListener('click', () => setMode('standard'));
    detailedBtn?.addEventListener('click', () => setMode('detailed'));

    openTabBtn?.addEventListener('click', () => {
      const previewFrame = el('pdf-preview-frame');
      const url =
        previewFrame?.dataset.previewUrl ||
        previewFrame?.dataset.previewObjectUrl ||
        previewFrame?.src;
      if (url && url !== 'about:blank') {
        window.open(url, '_blank', 'noopener');
      }
    });

    fullscreenBtn?.addEventListener('click', () => {
      setFocusMode(!state.focusMode);
    });

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && state.focusMode) {
        setFocusMode(false);
      }
    });

    setMode(state.mode);
  }

  async function reloadPreview(scanId) {
    const previewFrame = el('pdf-preview-frame');
    if (!previewFrame) return;

    const resolvedScanId = Number.parseInt(String(scanId || getActiveScanId() || ''), 10);
    const container = previewFrame.parentElement;

    if (previewFrame._previewAbortController) {
      previewFrame._previewAbortController.abort();
    }
    const previewController = new AbortController();
    previewFrame._previewAbortController = previewController;
    const requestKey = `${resolvedScanId || 'invalid'}-${Date.now()}`;
    previewFrame.dataset.previewRequestKey = requestKey;
    clearPdfPreviewObjectUrl(previewFrame);

    if (!Number.isInteger(resolvedScanId) || resolvedScanId <= 0) {
      if (container) {
        const existingError = container.querySelector('.pdf-error-message');
        if (existingError) existingError.remove();
        const errorDiv = document.createElement('div');
        errorDiv.className = 'pdf-error-message';
        errorDiv.style.cssText = 'padding:3rem;text-align:center;color:var(--text-muted);';
        errorDiv.innerHTML = safeHtml(`
          <div style="display:flex;justify-content:center;margin-bottom:1rem;opacity:0.5">${uiIcon('file', { size: 40, stroke: 1.8 })}</div>
          <h4 style="color:var(--text-main);margin-bottom:0.5rem">Preview not available</h4>
          <p class="body-sm">We could not resolve this scan preview. Start a new targeted scan and try again.</p>
        `);
        container.appendChild(errorDiv);
      }
      previewFrame.src = 'about:blank';
      previewFrame.style.opacity = '1';
      return;
    }

    applyPdfFrameSize(previewFrame, state);
    setMode(state.mode);

    let skeleton = container?.querySelector('.preview-skeleton');
    if (!skeleton && container) {
      skeleton = document.createElement('div');
      skeleton.className = 'preview-skeleton';
      skeleton.innerHTML = safeHtml(
        '<div class="loader"></div><p class="body-sm text-muted" style="margin-top:var(--sp-3)">Rendering preview…</p>'
      );
      skeleton.style.cssText =
        'display:flex;flex-direction:column;align-items:center;justify-content:center;padding:3rem;';
      container.insertBefore(skeleton, previewFrame);
    }
    if (skeleton) skeleton.style.display = 'flex';
    previewFrame.style.opacity = '0';

    const url = `/api/agent/preview/${resolvedScanId}?t=${Date.now()}${currentScanTokenQuery()}${currentPreviewProfileQuery ? currentPreviewProfileQuery() : ''}`;
    previewFrame.dataset.previewUrl = url;
    previewFrame.src = 'about:blank';

    const removeExistingError = () => {
      const existingError = container?.querySelector('.pdf-error-message');
      if (existingError) existingError.remove();
    };

    const handleError = message => {
      if (previewFrame.dataset.previewRequestKey !== requestKey) return;
      if (skeleton) skeleton.style.display = 'none';
      previewFrame.style.opacity = '1';
      clearPdfPreviewObjectUrl(previewFrame);
      previewFrame.src = 'about:blank';
      const errorDiv = document.createElement('div');
      errorDiv.className = 'pdf-error-message';
      errorDiv.style.cssText = 'padding:3rem;text-align:center;color:var(--text-muted);';
      errorDiv.innerHTML = safeHtml(`
        <div style="display:flex;justify-content:center;margin-bottom:1rem;opacity:0.5">${uiIcon('file', { size: 40, stroke: 1.8 })}</div>
        <h4 style="color:var(--text-main);margin-bottom:0.5rem">Preview not available</h4>
        <p class="body-sm">${esc(message || 'Unable to load the PDF preview. The file may still be processing or there was an error.')}</p>
        <button
          class="btn btn-primary btn-sm"
          style="margin-top:1rem"
          data-action="reload-pdf-preview"
          data-scan-id="${esc(String(resolvedScanId))}"
        >
          Retry
        </button>
      `);
      if (container) {
        removeExistingError();
        container.appendChild(errorDiv);
      }
    };

    const revealPreview = () => {
      if (previewFrame.dataset.previewRequestKey !== requestKey) return;
      previewFrame.style.opacity = '1';
      if (skeleton) skeleton.style.display = 'none';
      removeExistingError();
      applyPdfFrameSize(previewFrame, state);
    };

    const handleLoad = () => {
      if (previewFrame.dataset.previewRequestKey !== requestKey) return;
      if (previewFrame.src === 'about:blank') {
        handleError('Preview did not initialize correctly. Please try again.');
        return;
      }
      revealPreview();
    };

    previewFrame.removeEventListener('load', previewFrame._loadHandler);
    previewFrame.removeEventListener('error', previewFrame._errorHandler);

    previewFrame._loadHandler = handleLoad;
    previewFrame._errorHandler = () => handleError('Unable to display the generated PDF preview.');

    previewFrame.addEventListener('load', handleLoad);
    previewFrame.addEventListener('error', previewFrame._errorHandler);

    if (!previewFrame._pdfrsBound) {
      const resizeHandler = () => applyPdfFrameSize(previewFrame, state);
      window.addEventListener('resize', resizeHandler);
      previewFrame._pdfrsBound = true;
      previewFrame._pdfrsResizeHandler = resizeHandler;
    }

    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        headers: { Accept: 'application/pdf' },
        signal: previewController.signal,
      });
      if (previewFrame.dataset.previewRequestKey !== requestKey) return;

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!response.ok || !contentType.includes('application/pdf')) {
        const bodyText = await response.text().catch(() => '');
        let errorMessage = 'Unable to load the PDF preview right now.';
        if (contentType.includes('application/json')) {
          try {
            const payload = JSON.parse(bodyText);
            errorMessage = payload.error || errorMessage;
          } catch {
            /* keep fallback */
          }
        } else if (bodyText) {
          const match = bodyText.match(/<p[^>]*>(.*?)<\/p>/i);
          if (match) {
            const parser = document.createElement('div');
            parser.innerHTML = match[1];
            errorMessage = parser.textContent?.trim() || errorMessage;
          }
        }
        handleError(errorMessage);
        return;
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        handleError('The preview file was empty. Please regenerate this scan.');
        return;
      }

      const objectUrl = URL.createObjectURL(blob);
      if (previewFrame.dataset.previewRequestKey !== requestKey) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      previewFrame.dataset.previewObjectUrl = objectUrl;
      previewFrame.src = objectUrl;
      window.setTimeout(() => {
        if (previewFrame.dataset.previewRequestKey !== requestKey) return;
        if (previewFrame.src === objectUrl) {
          revealPreview();
        }
      }, 1200);
    } catch (error) {
      if (error?.name === 'AbortError') return;
      handleError(error?.message || 'Unable to load the PDF preview right now.');
    }
  }

  return {
    reloadPreview,
    setFocusMode,
    setMode,
    setupControls,
  };
}

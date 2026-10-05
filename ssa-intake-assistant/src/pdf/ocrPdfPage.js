import { createWorker } from 'tesseract.js';

const MAX_RENDER_PIXELS = 8_000_000;

export async function createLocalOcrWorker(onProgress = () => {}) {
  const baseUrl = new URL('/ssa-intake-assistant/ocr/', window.location.origin);
  return createWorker('eng', 1, {
    workerPath: new URL('worker.min.js', baseUrl).href,
    corePath: baseUrl.href.replace(/\/$/, ''),
    langPath: baseUrl.href.replace(/\/$/, ''),
    cacheMethod: 'none',
    logger: (event) => onProgress({ status: event.status, progress: event.progress ?? 0 }),
  });
}

export async function recognizePdfPage(page, worker) {
  const baseViewport = page.getViewport({ scale: 1 });
  const desiredScale = 2;
  const desiredPixels = baseViewport.width * baseViewport.height * desiredScale ** 2;
  const scale = desiredPixels > MAX_RENDER_PIXELS
    ? Math.sqrt(MAX_RENDER_PIXELS / (baseViewport.width * baseViewport.height))
    : desiredScale;
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  try {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    const result = await worker.recognize(canvas);
    return {
      text: result.data.text?.trim() ?? '',
      confidence: Number.isFinite(result.data.confidence) ? result.data.confidence : 0,
    };
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
}


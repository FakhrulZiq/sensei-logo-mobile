import { useEffect, useState } from 'react';

const MAX_SIDE = 1024;
const MAX_BYTES = 2 * 1024 * 1024;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('This image could not be opened.'));
    image.src = url;
  });
}

function pngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(
    (blob) => blob ? resolve(blob) : reject(new Error('Could not create a transparent PNG.')),
    'image/png',
  ));
}

async function removeBackground(file: File): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Image editing is unavailable on this device.');
    context.drawImage(image, 0, 0, width, height);
    const frame = context.getImageData(0, 0, width, height);
    const pixels = frame.data;
    let left = width, right = -1, top = height, bottom = -1;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] < 16) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
    if (right < left) throw new Error('The image is already fully transparent.');
    const corners = [top * width + left, top * width + right, bottom * width + left, bottom * width + right].map((index) => {
      const at = index * 4;
      return [pixels[at], pixels[at + 1], pixels[at + 2]];
    });
    const distance = (at: number, color: number[]) => Math.hypot(
      pixels[at] - color[0], pixels[at + 1] - color[1], pixels[at + 2] - color[2],
    );
    const background = corners.find((color) => corners.filter((other) => Math.hypot(
      color[0] - other[0], color[1] - other[1], color[2] - other[2],
    ) < 45).length >= 3);
    if (!background) throw new Error('The edges have different colours. Try an image with a plain background.');

    // Only erase pixels connected to an edge, so matching colours inside the logo stay intact.
    const visited = new Uint8Array(width * height);
    const queue = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    const add = (index: number) => {
      if (visited[index] || distance(index * 4, background) > 62) return;
      visited[index] = 1;
      queue[tail++] = index;
    };
    for (let x = left; x <= right; x++) { add(top * width + x); add(bottom * width + x); }
    for (let y = top; y <= bottom; y++) { add(y * width + left); add(y * width + right); }
    if (!tail) throw new Error('No plain background was found around the image.');
    while (head < tail) {
      const index = queue[head++];
      const x = index % width;
      if (x) add(index - 1);
      if (x + 1 < width) add(index + 1);
      if (index >= width) add(index - width);
      if (index + width < visited.length) add(index + width);
    }
    for (let index = 0; index < visited.length; index++) {
      if (!visited[index]) continue;
      const at = index * 4;
      const difference = distance(at, background);
      pixels[at + 3] = Math.round(pixels[at + 3] * Math.min(1, Math.max(0, (difference - 18) / 44)));
    }
    context.putImageData(frame, 0, 0);
    const blob = await pngBlob(canvas);
    if (blob.size > MAX_BYTES) throw new Error('The transparent PNG is over 2 MB. Try a smaller image.');
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-transparent.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function BackgroundRemover({ file, onApply, onCancel }: {
  file: File;
  onApply: (result: File) => void;
  onCancel: () => void;
}) {
  const [originalUrl, setOriginalUrl] = useState('');
  const [result, setResult] = useState<File | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (!result) return;
    const url = URL.createObjectURL(result);
    setResultUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [result]);

  async function run() {
    setWorking(true);
    setError('');
    try { setResult(await removeBackground(file)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove the background.'); }
    finally { setWorking(false); }
  }

  return <div className="crop-backdrop" onClick={onCancel}>
    <section className="crop-dialog" role="dialog" aria-modal="true" aria-label="Remove logo background" onClick={(event) => event.stopPropagation()}>
      <h3>Remove background</h3>
      <p>Works best when the logo has a plain background. Check the transparent preview before using it.</p>
      <div className="remove-preview" aria-label={result ? 'Transparent logo preview' : 'Original logo preview'}>
        <img src={resultUrl || originalUrl} alt={result ? 'Logo with background removed' : 'Original logo'} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <footer className="crop-footer">
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        {result ? <button type="button" className="primary" onClick={() => onApply(result)}>Use transparent logo</button>
          : <button type="button" className="primary" onClick={run} disabled={working}>{working ? 'Removing…' : 'Remove background'}</button>}
      </footer>
    </section>
  </div>;
}

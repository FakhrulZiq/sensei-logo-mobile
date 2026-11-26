const MAX_SIDE = 1024;

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

export async function removeBackground(file: File): Promise<File> {
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
      return pixels[at + 3] >= 128 ? [pixels[at], pixels[at + 1], pixels[at + 2]] : null;
    }).filter((color) => color !== null);
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
    let changed = false;
    let hasSubject = false;
    for (let index = 0; index < visited.length; index++) {
      const at = index * 4;
      const alpha = pixels[at + 3];
      if (visited[index]) {
        const difference = distance(at, background);
        pixels[at + 3] = Math.round(alpha * Math.min(1, Math.max(0, (difference - 18) / 44)));
        if (pixels[at + 3] < alpha) changed = true;
      } else if (alpha >= 16) {
        hasSubject = true;
      }
    }
    if (!changed || !hasSubject) throw new Error('Could not separate the logo from its background.');
    context.putImageData(frame, 0, 0);
    const blob = await pngBlob(canvas);
    return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-transparent.png`, { type: 'image/png' });
  } finally {
    URL.revokeObjectURL(url);
  }
}

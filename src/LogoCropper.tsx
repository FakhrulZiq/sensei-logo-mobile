import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from 'react';
import { removeBackground } from './removeBackground';

export const imageFrames = {
  logo: { label: 'Square logo', width: 512, height: 512 },
  background: { label: 'Wide logo', width: 960, height: 480 },
};

export type ImageTarget = keyof typeof imageFrames;
type Point = { x: number; y: number };
type Transform = { zoom: number; offset: Point };
type Gesture = { midpoint: Point; distance: number; transform: Transform };

export type ImageEdit = {
  source: File;
  transparent: File | null;
  transform: Transform;
  output: File;
};

const center = { x: 0, y: 0 };
const fit: Transform = { zoom: 1, offset: center };

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function measure(points: Point[]) {
  const [a, b] = points;
  return b ? {
    midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    distance: Math.hypot(a.x - b.x, a.y - b.y),
  } : { midpoint: a, distance: 0 };
}

function imageRect(image: HTMLImageElement, frameHeight: number, transform: Transform) {
  const scale = Math.min(1 / image.naturalWidth, frameHeight / image.naturalHeight) * transform.zoom;
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const xLimit = Math.max(0, (width - 1) / 2);
  const yLimit = Math.max(0, (height - frameHeight) / 2);
  return {
    width, height,
    x: (1 - width) / 2 + clamp(transform.offset.x, -xLimit, xLimit),
    y: (frameHeight - height) / 2 + clamp(transform.offset.y, -yLimit, yLimit),
  };
}

export function LogoCropper({ target, source, previous, onApply, onCancel }: {
  target: ImageTarget;
  source: File;
  previous?: ImageEdit;
  onApply: (edit: ImageEdit) => void;
  onCancel: () => void;
}) {
  const frame = imageFrames[target];
  const frameHeight = frame.height / frame.width;
  const [transparent, setTransparent] = useState(previous?.transparent ?? null);
  const [loaded, setLoaded] = useState<{ file: File; image: HTMLImageElement } | null>(null);
  const [transform, setTransform] = useState(previous?.transform ?? fit);
  const latest = useRef(transform);
  const [working, setWorking] = useState<'remove' | 'crop' | null>(null);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const file = transparent ?? source;
  const image = loaded?.file === file ? loaded.image : null;
  const rect = image && imageRect(image, frameHeight, transform);
  const cover = image ? Math.max(image.naturalWidth * frameHeight / image.naturalHeight,
    image.naturalHeight / (image.naturalWidth * frameHeight)) : 1;
  const maxZoom = cover * 6;

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => setLoaded({ file, image: next });
    next.onerror = () => setError('This image could not be opened. Choose another file.');
    next.src = url;
    return () => {
      next.onload = null;
      next.onerror = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  function update(next: Transform) {
    if (!image) return;
    const bounds = imageRect(image, frameHeight, next);
    const bounded = {
      zoom: next.zoom,
      offset: { x: bounds.x - (1 - bounds.width) / 2, y: bounds.y - (frameHeight - bounds.height) / 2 },
    };
    latest.current = bounded;
    setTransform(bounded);
  }

  function position(event: PointerEvent<HTMLDivElement>): Point {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left - bounds.width / 2) / bounds.width,
      y: (event.clientY - bounds.top - bounds.height / 2) / bounds.width,
    };
  }

  function snapshot() {
    const points = [...pointers.current.values()];
    gesture.current = points.length ? { ...measure(points), transform: latest.current } : null;
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!image || working || event.button !== 0 || pointers.current.size >= 2) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, position(event));
    snapshot();
  }

  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    const start = gesture.current;
    if (!start || !pointers.current.has(event.pointerId) || working) return;
    pointers.current.set(event.pointerId, position(event));
    const current = measure([...pointers.current.values()]);
    const scale = start.distance ? current.distance / start.distance : 1;
    zoomAt(start.transform.zoom * scale, start.transform, start.midpoint, current.midpoint);
  }

  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    if (pointers.current.delete(event.pointerId)) snapshot();
  }

  function zoomAt(value: number, from = latest.current, anchor = center, destination = anchor) {
    const zoom = clamp(value, 1, maxZoom);
    const scale = zoom / from.zoom;
    update({ zoom, offset: {
      x: destination.x - (anchor.x - from.offset.x) * scale,
      y: destination.y - (anchor.y - from.offset.y) * scale,
    } });
  }

  const zoomWithWheel = useEffectEvent((event: WheelEvent) => {
    if (!image || working || !stage.current) return;
    event.preventDefault();
    const bounds = stage.current.getBoundingClientRect();
    const anchor = {
      x: (event.clientX - bounds.left - bounds.width / 2) / bounds.width,
      y: (event.clientY - bounds.top - bounds.height / 2) / bounds.width,
    };
    const from = latest.current;
    zoomAt(from.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), from, anchor);
  });

  useEffect(() => {
    const element = stage.current!;
    const wheel = (event: WheelEvent) => zoomWithWheel(event);
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, []);

  async function toggleBackground() {
    setError('');
    if (transparent) {
      setTransparent(null);
      return;
    }
    setWorking('remove');
    try { setTransparent(await removeBackground(source)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove the background.'); }
    finally { setWorking(null); }
  }

  async function apply() {
    if (!image || !rect || working) return;
    setWorking('crop');
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = frame.width;
      canvas.height = frame.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image cropping is unavailable on this device.');
      context.drawImage(image, rect.x * frame.width, rect.y * frame.width, rect.width * frame.width, rect.height * frame.width);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('Could not crop the image.')), 'image/png',
      ));
      const output = new File([blob], `${target}-cropped.png`, { type: 'image/png' });
      onApply({ source, transparent, transform, output });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not crop the image.'); }
    finally { setWorking(null); }
  }

  return <dialog ref={dialog} className="crop-dialog" aria-labelledby="crop-title"
    onCancel={(event) => { event.preventDefault(); event.stopPropagation(); if (!working) onCancel(); }}>
    <header className="crop-header">
      <h3 id="crop-title">Edit {frame.label.toLowerCase()}</h3>
      <p>Pinch or use the zoom controls. Drag to position.</p>
    </header>
    <div ref={stage} className={`crop-stage checkerboard crop-stage--${target}`} tabIndex={0} role="group"
      aria-label={`${frame.label} crop frame. Use arrow keys to move the image.`}
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd}
      onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
      onKeyDown={(event) => {
        const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
        if (!direction || working) return;
        event.preventDefault();
        const { zoom, offset } = latest.current;
        update({ zoom, offset: { x: offset.x + direction[0] * 0.02, y: offset.y + direction[1] * 0.02 } });
      }}>
      {rect && <img src={image.src} alt="" draggable={false} style={{
        width: `${rect.width * 100}%`, height: `${rect.height / frameHeight * 100}%`,
        left: `${rect.x * 100}%`, top: `${rect.y / frameHeight * 100}%`,
      }} />}
      {!image && !error && <span role="status">Loading image…</span>}
    </div>
    <div className="zoom-label"><label htmlFor="crop-zoom">Zoom</label><output htmlFor="crop-zoom">{Math.round(transform.zoom * 100)}%</output></div>
    <div className="crop-controls">
      <button type="button" className="secondary" aria-label="Zoom out" onClick={() => zoomAt(latest.current.zoom / 1.2)}
        disabled={!image || !!working || transform.zoom <= 1}>−</button>
      <input id="crop-zoom" type="range" min={0} max={1000} value={Math.round(Math.log(transform.zoom) / Math.log(maxZoom) * 1000)}
        aria-valuetext={`${Math.round(transform.zoom * 100)}%`} disabled={!image || !!working}
        onChange={(event) => zoomAt(maxZoom ** (Number(event.target.value) / 1000))} />
      <button type="button" className="secondary" aria-label="Zoom in" onClick={() => zoomAt(latest.current.zoom * 1.2)}
        disabled={!image || !!working || transform.zoom >= maxZoom}>+</button>
    </div>
    <div className="crop-tools">
      <button type="button" className="text-button" onClick={toggleBackground} disabled={!image || !!working}>
        {working === 'remove' ? 'Removing…' : transparent ? 'Restore background' : 'Remove background'}
      </button>
      <button type="button" className="text-button" onClick={() => update(fit)} disabled={!image || !!working || transform.zoom === 1}>Reset framing</button>
    </div>
    {error && <p className="error" role="alert">{error}</p>}
    <footer className="crop-footer">
      <button type="button" className="secondary" onClick={onCancel} disabled={!!working}>Cancel</button>
      <button type="button" className="primary" onClick={apply} disabled={!image || !!working}>{working === 'crop' ? 'Applying…' : 'Apply image'}</button>
    </footer>
  </dialog>;
}

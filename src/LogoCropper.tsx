import { useEffect, useRef, useState, type PointerEvent, type WheelEvent } from 'react';

const FRAME = 240;
const STAGE = 280;
const OUTPUT = 512;
type Point = { x: number; y: number };
type Gesture = { midpoint: Point; distance: number; zoom: number; offset: Point };

export function LogoCropper({ file, onApply, onCancel }: { file: File; onApply: (cropped: File) => void; onCancel: () => void }) {
  const [url, setUrl] = useState('');
  const [dimensions, setDimensions] = useState<Point | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const image = useRef<HTMLImageElement | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<Gesture | null>(null);
  const cover = dimensions ? Math.max(FRAME / dimensions.x, FRAME / dimensions.y) : 1;
  const minZoom = dimensions ? Math.min(FRAME / dimensions.x, FRAME / dimensions.y) / cover : 1;
  const width = dimensions ? dimensions.x * cover * zoom : FRAME;
  const height = dimensions ? dimensions.y * cover * zoom : FRAME;
  function bound(point: Point, level: number): Point {
    if (!dimensions) return { x: 0, y: 0 };
    const x = Math.max(0, (dimensions.x * cover * level - FRAME) / 2);
    const y = Math.max(0, (dimensions.y * cover * level - FRAME) / 2);
    return { x: Math.max(-x, Math.min(x, point.x)), y: Math.max(-y, Math.min(y, point.y)) };
  }
  const position = bound(offset, zoom);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    const next = new Image();
    next.onload = () => {
      image.current = next;
      const x = next.naturalWidth;
      const y = next.naturalHeight;
      setZoom(Math.min(FRAME / x, FRAME / y) / Math.max(FRAME / x, FRAME / y));
      setOffset({ x: 0, y: 0 });
      setDimensions({ x, y });
    };
    next.onerror = () => setError('This image could not be opened. Choose another file.');
    next.src = objectUrl;
    setUrl(objectUrl);
    return () => { image.current = null; URL.revokeObjectURL(objectUrl); };
  }, [file]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onCancel]);

  function point(event: PointerEvent<HTMLDivElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 };
  }
  function measure(points: Point[]) {
    return {
      midpoint: points.length > 1 ? { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 } : points[0],
      distance: points.length > 1 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0,
    };
  }
  function snapshot() {
    const points = [...pointers.current.values()];
    gesture.current = points.length ? { ...measure(points), zoom, offset: position } : null;
  }
  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!dimensions) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, point(event));
    snapshot();
  }
  function pointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId) || !gesture.current) return;
    pointers.current.set(event.pointerId, point(event));
    const current = measure([...pointers.current.values()]);
    const start = gesture.current;
    const nextZoom = Math.max(minZoom, Math.min(6, start.distance && current.distance ? start.zoom * current.distance / start.distance : start.zoom));
    const ratio = nextZoom / start.zoom;
    setZoom(nextZoom);
    setOffset(bound({
      x: current.midpoint.x - (start.midpoint.x - start.offset.x) * ratio,
      y: current.midpoint.y - (start.midpoint.y - start.offset.y) * ratio,
    }, nextZoom));
  }
  function pointerEnd(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    snapshot();
  }
  function changeZoom(value: number, focus: Point = { x: 0, y: 0 }) {
    const next = Math.max(minZoom, Math.min(6, value));
    const ratio = next / zoom;
    setOffset(bound({ x: focus.x - (focus.x - position.x) * ratio, y: focus.y - (focus.y - position.y) * ratio }, next));
    setZoom(next);
  }
  function wheel(event: WheelEvent<HTMLDivElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    changeZoom(zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    });
  }
  async function apply() {
    if (!image.current || !dimensions || working) return;
    setWorking(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = OUTPUT;
      canvas.height = OUTPUT;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image cropping is unavailable on this device.');
      const ratio = OUTPUT / FRAME;
      context.drawImage(image.current, ((FRAME - width) / 2 + position.x) * ratio,
        ((FRAME - height) / 2 + position.y) * ratio, width * ratio, height * ratio);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error('Could not crop the image.')), 'image/png',
      ));
      if (blob.size > 2 * 1024 * 1024) throw new Error('The cropped logo is over 2 MB. Try a smaller image.');
      onApply(new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-cropped.png`, { type: 'image/png' }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not crop the image.'); }
    finally { setWorking(false); }
  }

  return <div className="crop-backdrop" onClick={onCancel}>
    <section className="crop-dialog" role="dialog" aria-modal="true" aria-label="Crop logo" onClick={(event) => event.stopPropagation()}>
      <h3>Frame the logo</h3>
      <p>Pinch to zoom and drag to position the logo inside the square frame.</p>
      <div className="crop-stage" tabIndex={0} role="img" aria-label="Square crop frame. Pinch or use the zoom buttons, then drag to position." onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onWheel={wheel} onKeyDown={(event) => {
        const direction = { ArrowLeft: [-5, 0], ArrowRight: [5, 0], ArrowUp: [0, -5], ArrowDown: [0, 5] }[event.key];
        if (direction) { event.preventDefault(); setOffset(bound({ x: position.x + direction[0], y: position.y + direction[1] }, zoom)); }
      }}>
        {dimensions && <img src={url} alt="" draggable={false} style={{ width, height, left: (STAGE - width) / 2 + position.x, top: (STAGE - height) / 2 + position.y }} />}
        {!dimensions && !error && <span>Loading image…</span>}
        <div className="crop-frame" aria-hidden="true" />
      </div>
      <div className="crop-controls">
        <button type="button" className="secondary" aria-label="Zoom out" onClick={() => changeZoom(zoom / 1.25)} disabled={!dimensions || zoom <= minZoom}>−</button>
        <span>Pinch to zoom</span>
        <button type="button" className="secondary" aria-label="Zoom in" onClick={() => changeZoom(zoom * 1.25)} disabled={!dimensions || zoom >= 6}>+</button>
        <button type="button" className="text-button" onClick={() => { setZoom(minZoom); setOffset({ x: 0, y: 0 }); }} disabled={!dimensions}>Reset</button>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <footer className="crop-footer"><button type="button" className="secondary" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={apply} disabled={!dimensions || working}>{working ? 'Cropping…' : 'Use crop'}</button></footer>
    </section>
  </div>;
}

import { useEffect, useRef } from 'react';
import { DEFAULT_CROP, MAX_ZOOM, MIN_ZOOM, cropStyle, normalizeCrop } from '../../firebase/cardArt.js';

// Interactive crop editor. Uses the exact same aspect ratio and crop math as the card's art window,
// so what you frame here is exactly what shows on the card.
export default function ArtCropper({ src, crop, onChange }) {
  const frameRef = useRef(null);
  const imgRef = useRef(null);
  const drag = useRef(null);
  const c = normalizeCrop(crop);
  const cropRef = useRef(c);
  useEffect(() => { cropRef.current = c; });

  // How far (in px) the zoomed image extends beyond the frame on each axis
  const overflow = (zoom) => {
    const frame = frameRef.current?.getBoundingClientRect();
    const img = imgRef.current;
    if (!frame || !img?.naturalWidth) return { ex: 0, ey: 0 };
    const s = Math.max(frame.width / img.naturalWidth, frame.height / img.naturalHeight);
    return {
      ex: img.naturalWidth * s * zoom - frame.width,
      ey: img.naturalHeight * s * zoom - frame.height,
    };
  };

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    const dx = e.clientX - drag.current.x;
    const dy = e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
    const cur = cropRef.current;
    const { ex, ey } = overflow(cur.zoom);
    onChange(normalizeCrop({
      ...cur,
      // Dragging the image right reveals more of its left side
      x: ex > 0 ? cur.x - dx / ex : cur.x,
      y: ey > 0 ? cur.y - dy / ey : cur.y,
    }));
  };
  const endDrag = () => { drag.current = null; };

  // Scroll-wheel zoom (needs a non-passive listener to prevent page scroll)
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const cur = cropRef.current;
      onChange(normalizeCrop({ ...cur, zoom: cur.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onChange]);

  const nudge = (dx, dy) => onChange(normalizeCrop({ ...c, x: c.x + dx, y: c.y + dy }));
  const onKeyDown = (e) => {
    const step = e.shiftKey ? 0.1 : 0.02;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      nudge(...moves[e.key]);
    }
  };

  return (
    <div className="art-cropper">
      <div
        ref={frameRef}
        className="cropper-frame"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        tabIndex={0}
        role="application"
        aria-label="Card art crop. Drag or use arrow keys to reposition, scroll to zoom."
      >
        <img ref={imgRef} src={src} alt="" draggable="false" style={cropStyle(c)} />
        <div className="cropper-grid" aria-hidden="true" />
      </div>
      <div className="cropper-controls">
        <label htmlFor="crop-zoom">Zoom</label>
        <input
          id="crop-zoom"
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={c.zoom}
          onChange={(e) => onChange(normalizeCrop({ ...c, zoom: Number(e.target.value) }))}
        />
        <span className="cropper-zoom">{c.zoom.toFixed(2)}×</span>
        <button type="button" className="ui-btn small" onClick={() => onChange(DEFAULT_CROP)}>Reset</button>
      </div>
      <p className="cropper-hint">Drag to reposition · scroll or use the slider to zoom</p>
    </div>
  );
}

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Tool = 'pencil' | 'eraser' | 'line' | 'rect' | 'circle' | 'triangle' | 'text' | 'fill' | 'eyedropper';
type ShapeFill = 'stroke' | 'fill';
type Zoom = 0.5 | 1 | 2;

interface ToolDef {
  id: Tool;
  label: string;
  glyph: string;
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { id: 'pencil',     label: 'Pencil',    glyph: '✏', shortcut: 'P' },
  { id: 'eraser',     label: 'Eraser',    glyph: '◊',  shortcut: 'E' },
  { id: 'line',       label: 'Line',      glyph: '╱',  shortcut: 'L' },
  { id: 'rect',       label: 'Rectangle', glyph: '▭',  shortcut: 'R' },
  { id: 'circle',     label: 'Ellipse',   glyph: '◯',  shortcut: 'C' },
  { id: 'triangle',   label: 'Triangle',  glyph: '△',  shortcut: 'G' },
  { id: 'text',       label: 'Text',      glyph: 'T',  shortcut: 'T' },
  { id: 'fill',       label: 'Bucket',    glyph: '⏃', shortcut: 'F' },
  { id: 'eyedropper', label: 'Picker',    glyph: '⌑', shortcut: 'I' },
];

const SWATCHES = ['#0a0a0e', '#ef4444', '#f97316', '#fbbf24', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];

const CANVAS_W = 1100;
const CANVAS_H = 680;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#0a0a0e');
  const [size, setSize] = useState(6);
  const [opacity, setOpacity] = useState(100);
  const [shapeFill, setShapeFill] = useState<ShapeFill>('stroke');
  const [zoom, setZoom] = useState<Zoom>(1);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);
  const [strokeCount, setStrokeCount] = useState(0);
  const [recentColors, setRecentColors] = useState<string[]>([]);
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  const drawing = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  // ─── init ────────────────────────────────────────────────────────
  useEffect(() => {
    const cv = canvasRef.current!;
    cv.width = CANVAS_W; cv.height = CANVAS_H;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctxRef.current = ctx;
    const ov = overlayRef.current!;
    ov.width = CANVAS_W; ov.height = CANVAS_H;
  }, []);

  // ─── keyboard shortcuts ─────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
        return;
      }
      const match = TOOLS.find(t => t.shortcut.toLowerCase() === e.key.toLowerCase());
      if (match) { setTool(match.id); e.preventDefault(); }
      else if (e.key === '?') setShowShortcuts(s => !s);
      else if (e.key === 'Escape') setShowShortcuts(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [history, redoStack]); // capture latest stacks for undo/redo

  // ─── helpers ────────────────────────────────────────────────────
  const snapshot = () => {
    const ctx = ctxRef.current!;
    return ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  };

  const restore = (data: ImageData) => {
    ctxRef.current!.putImageData(data, 0, 0);
  };

  const pushHistory = () => {
    setHistory(h => [...h.slice(-29), snapshot()]);
    setRedoStack([]);
  };

  const pushRecentColor = (c: string) => {
    setRecentColors(prev => {
      const without = prev.filter(x => x.toLowerCase() !== c.toLowerCase());
      return [c, ...without].slice(0, 8);
    });
  };

  const setColorAndRecent = (c: string) => {
    setColor(c);
    pushRecentColor(c);
  };

  const getPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    // rect already accounts for the CSS zoom, so x/y are in canvas pixels.
    return {
      x: Math.round((e.clientX - rect.left) * (CANVAS_W / rect.width)),
      y: Math.round((e.clientY - rect.top) * (CANVAS_H / rect.height)),
    };
  };

  // ─── pointer events ─────────────────────────────────────────────
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = getPos(e);
    const ctx = ctxRef.current!;

    if (tool === 'eyedropper') {
      const data = ctx.getImageData(p.x, p.y, 1, 1).data;
      const hex = '#' + [data[0], data[1], data[2]].map(n => n.toString(16).padStart(2, '0')).join('');
      setColorAndRecent(hex);
      return;
    }
    if (tool === 'fill') {
      pushHistory();
      floodFill(ctx, p.x, p.y, color, opacity / 100);
      setStrokeCount(c => c + 1);
      return;
    }
    if (tool === 'text') {
      const text = prompt('Text to drop:');
      if (!text) return;
      pushHistory();
      ctx.save();
      ctx.globalAlpha = opacity / 100;
      ctx.fillStyle = color;
      ctx.font = `${Math.max(12, size * 3)}px "Bricolage Grotesque", system-ui`;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, p.x, p.y);
      ctx.restore();
      setStrokeCount(c => c + 1);
      return;
    }

    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    start.current = p;
    last.current = p;
    pushHistory();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.fillStyle = color;
    ctx.lineWidth = size;
    ctx.globalAlpha = tool === 'eraser' ? 1 : opacity / 100;
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const p = getPos(e);
    setCoords(p);
    if (!drawing.current) return;
    const ctx = ctxRef.current!;
    if (tool === 'pencil' || tool === 'eraser') {
      ctx.beginPath();
      ctx.moveTo(last.current!.x, last.current!.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
    } else {
      drawShapeOverlay(p);
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const p = getPos(e);
    const ctx = ctxRef.current!;
    const ov = overlayRef.current!;
    ov.getContext('2d')!.clearRect(0, 0, ov.width, ov.height);

    if (tool === 'line' && start.current) {
      ctx.beginPath();
      ctx.moveTo(start.current.x, start.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (tool === 'rect' && start.current) {
      drawRect(ctx, start.current, p, shapeFill);
    } else if (tool === 'circle' && start.current) {
      drawEllipse(ctx, start.current, p, shapeFill);
    } else if (tool === 'triangle' && start.current) {
      drawTriangle(ctx, start.current, p, shapeFill);
    }
    setStrokeCount(c => c + 1);
    if (tool !== 'eraser') pushRecentColor(color);
    start.current = null;
    last.current = null;
    ctx.globalAlpha = 1;
  };

  const onLeave = () => setCoords(null);

  const drawShapeOverlay = (p: { x: number; y: number }) => {
    const ov = overlayRef.current!;
    const octx = ov.getContext('2d')!;
    octx.clearRect(0, 0, ov.width, ov.height);
    octx.lineCap = 'round';
    octx.lineWidth = size;
    octx.strokeStyle = color;
    octx.fillStyle = color;
    octx.globalAlpha = opacity / 100;
    if (tool === 'line') {
      octx.beginPath();
      octx.moveTo(start.current!.x, start.current!.y);
      octx.lineTo(p.x, p.y);
      octx.stroke();
    } else if (tool === 'rect') {
      drawRect(octx, start.current!, p, shapeFill);
    } else if (tool === 'circle') {
      drawEllipse(octx, start.current!, p, shapeFill);
    } else if (tool === 'triangle') {
      drawTriangle(octx, start.current!, p, shapeFill);
    }
  };

  // ─── top-bar actions ────────────────────────────────────────────
  const clear = () => {
    pushHistory();
    const ctx = ctxRef.current!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    setStrokeCount(0);
  };

  const undo = () => {
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    setRedoStack(r => [...r, snapshot()]);
    setHistory(h => h.slice(0, -1));
    restore(prev);
  };

  const redo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setHistory(h => [...h, snapshot()]);
    setRedoStack(r => r.slice(0, -1));
    restore(next);
  };

  const save = () => {
    const url = canvasRef.current!.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `paint-${Date.now()}.png`;
    a.click();
  };

  const uploadBackground = (file: File) => {
    const reader = new FileReader();
    reader.onload = ev => {
      const img = new Image();
      img.onload = () => {
        pushHistory();
        const ctx = ctxRef.current!;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        // contain inside canvas, preserving aspect
        const ratio = Math.min(ctx.canvas.width / img.width, ctx.canvas.height / img.height);
        const w = img.width * ratio;
        const h = img.height * ratio;
        ctx.drawImage(img, (ctx.canvas.width - w) / 2, (ctx.canvas.height - h) / 2, w, h);
        setStrokeCount(c => c + 1);
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // ─── render ─────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">
          <span className="mark">◐</span> Hover Studio
        </span>
        <div className="spacer" />
        <div className="topbar-group">
          <button onClick={undo} disabled={history.length === 0} data-testid="undo" title="Undo (⌘Z)">
            ↶
          </button>
          <button onClick={redo} disabled={redoStack.length === 0} data-testid="redo" title="Redo (⌘⇧Z)">
            ↷
          </button>
          <button onClick={clear} data-testid="clear" title="Clear canvas">
            ⌫ Clear
          </button>
        </div>
        <div className="topbar-group">
          <label className="upload-btn" title="Load image as background">
            <input
              type="file"
              accept="image/*"
              onChange={e => { const f = e.target.files?.[0]; if (f) uploadBackground(f); e.currentTarget.value = ''; }}
              aria-label="upload image"
              data-testid="upload-image"
            />
            📁 Image
          </label>
          <div className="zoom-group" role="group" aria-label="zoom">
            {[0.5, 1, 2].map(z => (
              <button
                key={z}
                className={zoom === z ? 'active' : ''}
                onClick={() => setZoom(z as Zoom)}
                data-testid={`zoom-${Math.round(z * 100)}`}
                aria-label={`zoom ${Math.round(z * 100)} percent`}
              >
                {Math.round(z * 100)}%
              </button>
            ))}
          </div>
        </div>
        <button onClick={save} data-testid="save" className="primary" title="Save PNG (⌘S)">
          ⬇ Export PNG
        </button>
      </header>

      <div className="body">
        <aside className="tools" aria-label="tools">
          <h3>Tool</h3>
          <div className="tool-grid" role="radiogroup" aria-label="drawing tool">
            {TOOLS.map(t => (
              <button
                key={t.id}
                className={tool === t.id ? 'tool active' : 'tool'}
                onClick={() => setTool(t.id)}
                data-testid={`tool-${t.id}`}
                aria-pressed={tool === t.id}
                aria-label={t.label}
                title={`${t.label} (${t.shortcut})`}
              >
                <span className="tool-glyph">{t.glyph}</span>
                <span className="tool-label">{t.label}</span>
                <span className="tool-shortcut">{t.shortcut}</span>
              </button>
            ))}
          </div>

          {(tool === 'rect' || tool === 'circle' || tool === 'triangle') && (
            <>
              <h3>Mode</h3>
              <div className="seg">
                <button
                  className={shapeFill === 'stroke' ? 'active' : ''}
                  onClick={() => setShapeFill('stroke')}
                  data-testid="mode-stroke"
                  aria-label="stroke mode"
                >Outline</button>
                <button
                  className={shapeFill === 'fill' ? 'active' : ''}
                  onClick={() => setShapeFill('fill')}
                  data-testid="mode-fill"
                  aria-label="fill mode"
                >Filled</button>
              </div>
            </>
          )}

          <h3>Color</h3>
          <input
            type="color"
            value={color}
            onChange={e => setColorAndRecent(e.target.value)}
            data-testid="color-picker"
            aria-label="color picker"
          />
          <div className="swatches" role="group" aria-label="quick colors">
            {SWATCHES.map(c => (
              <button
                key={c}
                className={`swatch ${c === color ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColorAndRecent(c)}
                aria-label={`color ${c}`}
                data-testid={`swatch-${c}`}
              />
            ))}
          </div>

          {recentColors.length > 0 && (
            <>
              <h3>Recent</h3>
              <div className="swatches recent">
                {recentColors.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    className={`swatch ${c === color ? 'active' : ''}`}
                    style={{ background: c }}
                    onClick={() => setColor(c)}
                    aria-label={`recent color ${c}`}
                    data-testid={`recent-${i}`}
                  />
                ))}
              </div>
            </>
          )}

          <h3>Brush</h3>
          <label className="control">
            <span>Size</span>
            <input
              type="range" min={1} max={80}
              value={size}
              onChange={e => setSize(Number(e.target.value))}
              data-testid="brush-size"
              aria-label="brush size"
            />
            <span className="val" data-testid="size-value">{size}px</span>
          </label>
          <label className="control">
            <span>Opacity</span>
            <input
              type="range" min={5} max={100}
              value={opacity}
              onChange={e => setOpacity(Number(e.target.value))}
              data-testid="brush-opacity"
              aria-label="brush opacity"
            />
            <span className="val" data-testid="opacity-value">{opacity}%</span>
          </label>

          <button className="link-help" onClick={() => setShowShortcuts(true)} aria-label="show shortcuts">
            ⌘ Keyboard shortcuts
          </button>
        </aside>

        <div className="stage">
          <div
            className="canvas-frame"
            style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
          >
            <canvas
              ref={canvasRef}
              data-testid="canvas"
              data-hover="true"
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerLeave={onLeave}
              style={{
                cursor: tool === 'eyedropper' ? 'crosshair' : tool === 'fill' ? 'cell' : 'crosshair',
              }}
            />
            <canvas ref={overlayRef} className="overlay" data-hover="true" />
          </div>
        </div>
      </div>

      <footer className="status" aria-label="status">
        <span>
          <em>Tool</em>
          <strong data-testid="status-tool">{TOOLS.find(t => t.id === tool)?.label}</strong>
        </span>
        <span>
          <em>Color</em>
          <span className="swatch-mini" style={{ background: color }} />
          <code data-testid="status-color">{color}</code>
        </span>
        <span>
          <em>Size</em>
          <strong data-testid="status-size">{size}px</strong>
        </span>
        <span>
          <em>Opacity</em>
          <strong data-testid="status-opacity">{opacity}%</strong>
        </span>
        <span>
          <em>Zoom</em>
          <strong data-testid="status-zoom">{Math.round(zoom * 100)}%</strong>
        </span>
        <span>
          <em>Cursor</em>
          <code data-testid="status-coords">{coords ? `${coords.x}, ${coords.y}` : '—'}</code>
        </span>
        <span>
          <em>Strokes</em>
          <strong data-testid="status-strokes">{strokeCount}</strong>
        </span>
      </footer>

      {showShortcuts && (
        <div className="overlay-modal" onClick={() => setShowShortcuts(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} data-testid="shortcuts-modal">
            <h2>Keyboard shortcuts</h2>
            <ul>
              {TOOLS.map(t => (
                <li key={t.id}><kbd>{t.shortcut}</kbd><span>{t.label}</span></li>
              ))}
              <li><kbd>⌘ Z</kbd><span>Undo</span></li>
              <li><kbd>⌘ ⇧ Z</kbd><span>Redo</span></li>
              <li><kbd>?</kbd><span>Toggle this panel</span></li>
              <li><kbd>Esc</kbd><span>Close this panel</span></li>
            </ul>
            <button onClick={() => setShowShortcuts(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── drawing primitives ───────────────────

function drawRect(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, mode: ShapeFill) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  if (mode === 'fill') ctx.fillRect(x, y, w, h);
  else ctx.strokeRect(x, y, w, h);
}

function drawEllipse(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, mode: ShapeFill) {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const rx = Math.abs(b.x - a.x) / 2;
  const ry = Math.abs(b.y - a.y) / 2;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  if (mode === 'fill') ctx.fill(); else ctx.stroke();
}

function drawTriangle(ctx: CanvasRenderingContext2D, a: { x: number; y: number }, b: { x: number; y: number }, mode: ShapeFill) {
  const top = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) };
  const left = { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) };
  const right = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) };
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  if (mode === 'fill') ctx.fill(); else ctx.stroke();
}

// Iterative flood-fill (queue, not recursive — won't overflow on big regions).
function floodFill(ctx: CanvasRenderingContext2D, sx: number, sy: number, hex: string, alpha: number) {
  const { width, height } = ctx.canvas;
  if (sx < 0 || sy < 0 || sx >= width || sy >= height) return;
  const img = ctx.getImageData(0, 0, width, height);
  const data = img.data;
  const idx = (x: number, y: number) => (y * width + x) * 4;
  const target: [number, number, number, number] = [
    data[idx(sx, sy)], data[idx(sx, sy) + 1], data[idx(sx, sy) + 2], data[idx(sx, sy) + 3],
  ];
  const fill = hexToRgb(hex);
  const a = Math.round(alpha * 255);
  if (target[0] === fill[0] && target[1] === fill[1] && target[2] === fill[2] && target[3] === a) return;
  const matches = (x: number, y: number) => {
    const i = idx(x, y);
    return data[i] === target[0] && data[i + 1] === target[1] && data[i + 2] === target[2] && data[i + 3] === target[3];
  };
  const stack: [number, number][] = [[sx, sy]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    if (!matches(x, y)) continue;
    const i = idx(x, y);
    data[i] = fill[0]; data[i + 1] = fill[1]; data[i + 2] = fill[2]; data[i + 3] = a;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  ctx.putImageData(img, 0, 0);
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

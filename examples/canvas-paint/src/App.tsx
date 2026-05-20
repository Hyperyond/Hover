import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

type Tool = 'pencil' | 'eraser' | 'line' | 'rect';

const TOOLS: { id: Tool; label: string; emoji: string }[] = [
  { id: 'pencil', label: 'Pencil', emoji: '✏️' },
  { id: 'eraser', label: 'Eraser', emoji: '🧽' },
  { id: 'line', label: 'Line', emoji: '╱' },
  { id: 'rect', label: 'Rectangle', emoji: '▭' },
];

const SWATCHES = ['#111827', '#dc2626', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#ec4899'];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null); // preview for line/rect
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const [tool, setTool] = useState<Tool>('pencil');
  const [color, setColor] = useState('#111827');
  const [size, setSize] = useState(6);
  const [history, setHistory] = useState<ImageData[]>([]);
  const [redoStack, setRedoStack] = useState<ImageData[]>([]);
  const [strokeCount, setStrokeCount] = useState(0);

  const drawing = useRef(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const cv = canvasRef.current!;
    cv.width = 900;
    cv.height = 560;
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctxRef.current = ctx;

    const ov = overlayRef.current!;
    ov.width = 900;
    ov.height = 560;
  }, []);

  const snapshot = (): ImageData => {
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

  const getPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = getPos(e);
    start.current = p;
    last.current = p;
    pushHistory();
    const ctx = ctxRef.current!;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
    ctx.lineWidth = size;
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = getPos(e);
    const ctx = ctxRef.current!;
    if (tool === 'pencil' || tool === 'eraser') {
      ctx.beginPath();
      ctx.moveTo(last.current!.x, last.current!.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      last.current = p;
    } else {
      // Preview overlay for line/rect
      const ov = overlayRef.current!;
      const octx = ov.getContext('2d')!;
      octx.clearRect(0, 0, ov.width, ov.height);
      octx.lineCap = 'round';
      octx.lineWidth = size;
      octx.strokeStyle = color;
      if (tool === 'line') {
        octx.beginPath();
        octx.moveTo(start.current!.x, start.current!.y);
        octx.lineTo(p.x, p.y);
        octx.stroke();
      } else if (tool === 'rect') {
        octx.strokeRect(
          Math.min(start.current!.x, p.x),
          Math.min(start.current!.y, p.y),
          Math.abs(p.x - start.current!.x),
          Math.abs(p.y - start.current!.y),
        );
      }
    }
  };

  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    const p = getPos(e);
    const ctx = ctxRef.current!;
    const ov = overlayRef.current!;
    const octx = ov.getContext('2d')!;
    octx.clearRect(0, 0, ov.width, ov.height);

    if (tool === 'line' && start.current) {
      ctx.beginPath();
      ctx.moveTo(start.current.x, start.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    } else if (tool === 'rect' && start.current) {
      ctx.strokeRect(
        Math.min(start.current.x, p.x),
        Math.min(start.current.y, p.y),
        Math.abs(p.x - start.current.x),
        Math.abs(p.y - start.current.y),
      );
    }
    setStrokeCount(c => c + 1);
    start.current = null;
    last.current = null;
  };

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

  return (
    <div className="app">
      <header className="topbar">
        <span className="logo">canvas-paint</span>
        <span className="spacer" />
        <button onClick={undo} disabled={history.length === 0} data-testid="undo" title="Undo">
          ↶ Undo
        </button>
        <button onClick={redo} disabled={redoStack.length === 0} data-testid="redo" title="Redo">
          ↷ Redo
        </button>
        <button onClick={clear} data-testid="clear" title="Clear canvas">
          Clear
        </button>
        <button onClick={save} data-testid="save" className="primary" title="Save PNG">
          💾 Save
        </button>
      </header>

      <div className="body">
        <aside className="tools" aria-label="tools">
          <h3>Tool</h3>
          <div className="tool-group" role="radiogroup" aria-label="drawing tool">
            {TOOLS.map(t => (
              <button
                key={t.id}
                className={tool === t.id ? 'tool active' : 'tool'}
                onClick={() => setTool(t.id)}
                data-testid={`tool-${t.id}`}
                aria-pressed={tool === t.id}
                aria-label={t.label}
              >
                <span className="tool-emoji">{t.emoji}</span>
                <span>{t.label}</span>
              </button>
            ))}
          </div>

          <h3>Color</h3>
          <input
            type="color"
            value={color}
            onChange={e => setColor(e.target.value)}
            data-testid="color-picker"
            aria-label="color picker"
          />
          <div className="swatches" role="group" aria-label="quick colors">
            {SWATCHES.map(c => (
              <button
                key={c}
                className={`swatch ${c === color ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setColor(c)}
                aria-label={`color ${c}`}
                data-testid={`swatch-${c}`}
              />
            ))}
          </div>

          <h3>Brush size</h3>
          <input
            type="range"
            min={1}
            max={50}
            value={size}
            onChange={e => setSize(Number(e.target.value))}
            data-testid="brush-size"
            aria-label="brush size"
          />
          <div className="size-preview">
            <span style={{ width: size, height: size, background: color }} />
            <span data-testid="size-value">{size}px</span>
          </div>
        </aside>

        <div className="stage">
          <canvas
            ref={canvasRef}
            data-testid="canvas"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            data-hover="true"
          />
          <canvas ref={overlayRef} className="overlay" data-hover="true" />
        </div>
      </div>

      <footer className="status" aria-label="status">
        <span>
          Tool: <strong data-testid="status-tool">{tool}</strong>
        </span>
        <span>
          Color: <span className="swatch-mini" style={{ background: color }} />{' '}
          <code data-testid="status-color">{color}</code>
        </span>
        <span>
          Size: <strong data-testid="status-size">{size}px</strong>
        </span>
        <span>
          Strokes: <strong data-testid="status-strokes">{strokeCount}</strong>
        </span>
      </footer>
    </div>
  );
}

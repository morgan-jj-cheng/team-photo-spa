import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateAiBackground } from './services/geminiService';
import { ChromaSettings, ImageAdjustments, TransformSettings, ExportSettings, ProcessingStatus } from './types';
import { Button } from './components/Button';

// --- Helpers ---
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 255, b: 0 };
};

// --- Custom Streamlit-style Components ---

const StHeader: React.FC<{ title: string; sub?: string }> = ({ title, sub }) => (
  <div className="mb-6">
    <h1 className="text-3xl font-bold text-white mb-2">{title}</h1>
    {sub && <p className="text-gray-400 text-sm">{sub}</p>}
  </div>
);

const StExpander: React.FC<{
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  resetAction?: () => void;
}> = ({ label, isOpen, onToggle, children, resetAction }) => {
  return (
    <div className="border border-[#31333f] rounded-lg mb-4 bg-[#161b22] overflow-hidden">
      <div 
        className="flex items-center justify-between p-3 cursor-pointer hover:bg-[#1f242d] transition-colors select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-3">
           <span className={`text-gray-500 text-[10px] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}>
             ▼
           </span>
           <span className="text-sm font-semibold text-white">{label}</span>
        </div>
        {resetAction && (
          <button 
            onClick={(e) => { e.stopPropagation(); resetAction(); }} 
            className="text-[10px] text-[#ff4b4b] hover:underline font-bold uppercase tracking-tighter"
          >
            Reset
          </button>
        )}
      </div>
      {isOpen && (
        <div className="p-4 border-t border-[#31333f] space-y-4 animate-in fade-in slide-in-from-top-1">
          {children}
        </div>
      )}
    </div>
  );
};

const StSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayMultiplier?: number;
  unit?: string;
  onChange: (val: number) => void;
}> = ({ label, value, min, max, step = 1, displayMultiplier = 1, unit = "", onChange }) => {
  const displayValue = Math.round(value * displayMultiplier);
  return (
    <div className="space-y-1.5 mb-2">
      <div className="flex justify-between items-center">
        <label className="text-xs font-medium text-gray-300">{label}</label>
        <span className="text-xs mono text-[#ff4b4b] font-semibold">{displayValue}{unit}</span>
      </div>
      <input 
        type="range" 
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1 bg-[#31333f] rounded-lg appearance-none cursor-pointer accent-[#ff4b4b]"
      />
    </div>
  );
};

const App: React.FC = () => {
  // --- State ---
  const [foregroundSrc, setForegroundSrc] = useState<string | null>(null);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);
  const [viewportZoom, setViewportZoom] = useState(0.85);
  
  const [expanders, setExpanders] = useState({
    assets: true,
    chroma: true,
    adjustments: true,
    geometry: true,
    export: false
  });
  
  const toggleExpander = (key: keyof typeof expanders) => {
    setExpanders(p => ({ ...p, [key]: !p[key] }));
  };

  const [chromaSettings, setChromaSettings] = useState<ChromaSettings>({
    similarity: 0.35, smoothness: 0.1, spill: 0.1, keyColor: '#00b140'
  });

  const [imageAdjustments, setImageAdjustments] = useState<ImageAdjustments>({
    exposure: 0, brilliance: 0, highlights: 0, shadows: 0, contrast: 0,
    brightness: 0, blackPoint: 0, saturation: 0, warmth: 0, tint: 0, sharpness: 0
  });

  const [transformSettings, setTransformSettings] = useState<TransformSettings>({
    rotate: 0, vertical: 0, horizontal: 0, scale: 1.0, panX: 0, panY: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 }
  });

  const [isCropping, setIsCropping] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: 'image/jpeg', quality: 0.9, scale: 1.0
  });

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadSize, setDownloadSize] = useState<string>('');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bufferCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const mainAreaRef = useRef<HTMLDivElement>(null);
  const [fgImg, setFgImg] = useState<HTMLImageElement | null>(null);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);

  // --- Image Upload Handlers ---
  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>, isForeground: boolean) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        if (isForeground) { setFgImg(img); setForegroundSrc(url); }
        else { setBgImg(img); setBackgroundSrc(url); }
      };
      img.src = url;
    }
  };

  const handleGenerateBackground = async () => {
    if (!aiPrompt.trim()) return;
    setStatus(ProcessingStatus.GENERATING_BG);
    try {
      const base64Image = await generateAiBackground(aiPrompt);
      const img = new Image();
      img.onload = () => {
        setBgImg(img);
        setBackgroundSrc(base64Image);
        setStatus(ProcessingStatus.IDLE);
      };
      img.src = base64Image;
    } catch (error) {
      setStatus(ProcessingStatus.ERROR);
    }
  };

  // --- Zoom Management (Ctrl + Wheel) ---
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        setViewportZoom(prev => Math.min(Math.max(0.1, prev + delta * 0.002), 5));
      }
    };
    const area = mainAreaRef.current;
    area?.addEventListener('wheel', handleWheel, { passive: false });
    return () => area?.removeEventListener('wheel', handleWheel);
  }, []);

  // --- Core Rendering & Perspective Logic ---
  const processComposite = useCallback(() => {
    if (!fgImg) return;
    const canvas = bufferCanvasRef.current;
    const width = fgImg.width;
    const height = fgImg.height;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    // 1. Render Backdrop
    if (bgImg) {
      const bgRatio = bgImg.width / bgImg.height;
      const fgRatio = width / height;
      let dW, dH, oX, oY;
      if (bgRatio > fgRatio) { dH = height; dW = bgImg.width * (height / bgImg.height); oX = (width - dW) / 2; oY = 0; }
      else { dW = width; dH = bgImg.height * (width / bgImg.width); oX = 0; oY = (height - dH) / 2; }
      ctx.drawImage(bgImg, oX, oY, dW, dH);
    } else {
      ctx.fillStyle = '#0e1117'; ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = '#161b22';
      const sz = 30;
      for(let y=0; y<height; y+=sz*2) for(let x=0; x<width; x+=sz*2) { ctx.fillRect(x,y,sz,sz); ctx.fillRect(x+sz,y+sz,sz,sz); }
    }

    // 2. Process Foreground (Chroma Key & Adjustments)
    const fgCanvas = document.createElement('canvas');
    fgCanvas.width = width; fgCanvas.height = height;
    const fgCtx = fgCanvas.getContext('2d');
    if (!fgCtx) return;
    fgCtx.drawImage(fgImg, 0, 0);
    const imgData = fgCtx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    const key = hexToRgb(chromaSettings.keyColor);
    const exposure = Math.pow(2, imageAdjustments.exposure / 50);
    const contrast = (259 * (imageAdjustments.contrast + 255)) / (255 * (259 - imageAdjustments.contrast));
    const saturation = 1 + (imageAdjustments.saturation / 100);

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i+1], b = data[i+2];
      const dist = Math.sqrt((r-key.r)**2 + (g-key.g)**2 + (b-key.b)**2) / 442;
      let alpha = 255;
      if (dist < chromaSettings.similarity) alpha = 0;
      else if (dist < chromaSettings.similarity + chromaSettings.smoothness) alpha = ((dist - chromaSettings.similarity) / chromaSettings.smoothness) * 255;
      
      if (alpha > 0) {
        if (dist < chromaSettings.similarity + chromaSettings.spill + chromaSettings.smoothness) { const avg = (r+b)/2; if (g > avg) g = avg; }
        r = r * exposure + imageAdjustments.brightness;
        g = g * exposure + imageAdjustments.brightness;
        b = b * exposure + imageAdjustments.brightness;
        r = Math.max(0, r - imageAdjustments.blackPoint);
        g = Math.max(0, g - imageAdjustments.blackPoint);
        b = Math.max(0, b - imageAdjustments.blackPoint);
        r = contrast * (r - 128) + 128; g = contrast * (g - 128) + 128; b = contrast * (b - 128) + 128;
        r += imageAdjustments.warmth; b -= imageAdjustments.warmth; g += imageAdjustments.tint;
        const gray = 0.299*r + 0.587*g + 0.114*b;
        r = gray + (r - gray) * saturation; g = gray + (g - gray) * saturation; b = gray + (b - gray) * saturation;
        data[i] = Math.min(255, Math.max(0, r)); data[i+1] = Math.min(255, Math.max(0, g)); data[i+2] = Math.min(255, Math.max(0, b));
      }
      data[i+3] = alpha;
    }
    fgCtx.putImageData(imgData, 0, 0);

    // 3. Perspective Warping (Warped Keystone)
    let finalFg: CanvasImageSource = fgCanvas;
    if (Math.abs(transformSettings.horizontal) > 0 || Math.abs(transformSettings.vertical) > 0) {
      const pCanvas = document.createElement('canvas');
      pCanvas.width = width; pCanvas.height = height;
      const pCtx = pCanvas.getContext('2d');
      if (pCtx) {
        let temp: CanvasImageSource = fgCanvas;
        if (Math.abs(transformSettings.vertical) > 0) {
          const vC = document.createElement('canvas'); vC.width = width; vC.height = height;
          const vX = vC.getContext('2d');
          const tilt = transformSettings.vertical / 200;
          for (let y = 0; y < height; y++) {
            const scale = 1 + ((y / height) - 0.5) * tilt * 2;
            vX?.drawImage(fgCanvas, 0, y, width, 1, (width - width*scale)/2, y, width*scale, 1);
          }
          temp = vC;
        }
        if (Math.abs(transformSettings.horizontal) > 0) {
          const hC = document.createElement('canvas'); hC.width = width; hC.height = height;
          const hX = hC.getContext('2d');
          const tilt = transformSettings.horizontal / 200;
          for (let x = 0; x < width; x++) {
            const scale = 1 + ((x / width) - 0.5) * tilt * 2;
            hX?.drawImage(temp, x, 0, 1, height, x, (height - height*scale)/2, 1, height*scale);
          }
          temp = hC;
        }
        finalFg = temp;
      }
    }

    // 4. Final Composite
    ctx.save();
    const px = (transformSettings.panX/100)*width; const py = (transformSettings.panY/100)*height;
    ctx.translate(width/2 + px, height/2 + py);
    ctx.rotate((transformSettings.rotate * Math.PI) / 180);
    ctx.scale(transformSettings.scale, transformSettings.scale);
    ctx.drawImage(finalFg, -width/2, -height/2);
    ctx.restore();

    // 5. Output to Main Viewport
    const display = canvasRef.current; if (!display) return;
    const dCtx = display.getContext('2d'); if (!dCtx) return;
    if (isCropping) {
      display.width = width; display.height = height;
      dCtx.drawImage(canvas, 0, 0);
    } else {
      const { crop } = transformSettings;
      const cw = Math.max(1, width * crop.width); const ch = Math.max(1, height * crop.height);
      display.width = cw; display.height = ch;
      dCtx.drawImage(canvas, width * crop.x, height * crop.y, cw, ch, 0, 0, cw, ch);
    }
  }, [fgImg, bgImg, chromaSettings, transformSettings, isCropping, imageAdjustments]);

  useEffect(() => { processComposite(); }, [processComposite]);

  // --- Actions ---
  const handleCropDrag = (e: React.MouseEvent, handle: string) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect(); if (!rect) return;
    const sX = e.clientX, sY = e.clientY; const sC = { ...transformSettings.crop };
    const move = (em: MouseEvent) => {
      const dx = (em.clientX - sX) / (rect.width); const dy = (em.clientY - sY) / (rect.height);
      const nc = { ...sC };
      if (handle === 'move') { nc.x = Math.max(0, Math.min(1 - nc.width, sC.x + dx)); nc.y = Math.max(0, Math.min(1 - nc.height, sC.y + dy)); }
      else {
        if (handle.includes('e')) nc.width = Math.max(0.05, Math.min(1 - nc.x, sC.width + dx));
        if (handle.includes('s')) nc.height = Math.max(0.05, Math.min(1 - nc.y, sC.height + dy));
        if (handle.includes('w')) { nc.x = Math.max(0, Math.min(sC.x + sC.width - 0.05, sC.x + dx)); nc.width = sC.width - (nc.x - sC.x); }
        if (handle.includes('n')) { nc.y = Math.max(0, Math.min(sC.y + sC.height - 0.05, sC.y + dy)); nc.height = sC.height - (nc.y - sC.y); }
      }
      setTransformSettings(p => ({ ...p, crop: nc }));
    };
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  return (
    <div className="flex h-screen bg-[#0e1117] text-[#fafafa] overflow-hidden">
      {/* Streamlit Sidebar */}
      <aside className="w-[340px] flex-none bg-[#262730] flex flex-col z-20 shadow-xl border-r border-[#31333f]">
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1 space-y-6">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-8 h-8 bg-[#ff4b4b] rounded flex items-center justify-center font-bold text-white text-xs">ST</div>
            <h2 className="font-bold text-xl tracking-tight text-white">Editor Controls</h2>
          </div>

          <StExpander label="📁 Assets" isOpen={expanders.assets} onToggle={() => toggleExpander('assets')}>
            <div className="space-y-4">
              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400 mb-1 block">Subject (Photo)</label>
                <input type="file" onChange={e => handleUpload(e, true)} className="text-xs text-gray-500 w-full file:mr-4 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-[#31333f] file:text-white hover:file:bg-[#4b4d5a] cursor-pointer" />
              </div>
              <div>
                <label className="text-[10px] uppercase font-bold text-gray-400 mb-1 block">Backdrop</label>
                <input type="file" onChange={e => handleUpload(e, false)} className="text-xs text-gray-500 w-full file:mr-4 file:py-1 file:px-2 file:rounded file:border-0 file:text-[10px] file:font-semibold file:bg-[#31333f] file:text-white hover:file:bg-[#4b4d5a] cursor-pointer" />
              </div>
              <div className="pt-2 border-t border-[#31333f]">
                <label className="text-[10px] uppercase font-bold text-gray-400 mb-1 block">AI Backdrop Generator</label>
                <div className="flex gap-1">
                  <input 
                    className="flex-1 bg-[#0e1117] border border-[#31333f] rounded px-2 py-1.5 text-xs text-white outline-none focus:border-[#ff4b4b] transition"
                    placeholder="Enter prompt..." value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                  />
                  <button onClick={handleGenerateBackground} className="bg-[#ff4b4b] hover:bg-[#ff3333] px-2 rounded text-xs text-white">✨</button>
                </div>
              </div>
            </div>
          </StExpander>

          <StExpander label="🪄 Green Screen" isOpen={expanders.chroma} onToggle={() => toggleExpander('chroma')}>
            <div className="flex items-center justify-between pb-2">
              <span className="text-xs font-medium text-gray-400">Target Color</span>
              <input type="color" value={chromaSettings.keyColor} onChange={e => setChromaSettings(p => ({...p, keyColor: e.target.value}))} className="w-10 h-5 bg-transparent cursor-pointer rounded overflow-hidden" />
            </div>
            <StSlider label="Tolerance" value={chromaSettings.similarity} min={0} max={1} step={0.01} displayMultiplier={100} onChange={v => setChromaSettings(p => ({...p, similarity: v}))} />
            <StSlider label="Smoothness" value={chromaSettings.smoothness} min={0} max={0.5} step={0.01} displayMultiplier={100} onChange={v => setChromaSettings(p => ({...p, smoothness: v}))} />
            <StSlider label="Green Spill" value={chromaSettings.spill} min={0} max={0.5} step={0.01} displayMultiplier={100} onChange={v => setChromaSettings(p => ({...p, spill: v}))} />
          </StExpander>

          <StExpander 
            label="⚖️ Adjustments" isOpen={expanders.adjustments} onToggle={() => toggleExpander('adjustments')} 
            resetAction={() => setImageAdjustments({exposure:0, brilliance:0, highlights:0, shadows:0, contrast:0, brightness:0, blackPoint:0, saturation:0, warmth:0, tint:0, sharpness:0})}
          >
            <StSlider label="Exposure" value={imageAdjustments.exposure} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, exposure: v}))} />
            <StSlider label="Contrast" value={imageAdjustments.contrast} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, contrast: v}))} />
            <StSlider label="Saturation" value={imageAdjustments.saturation} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, saturation: v}))} />
            <StSlider label="Warmth" value={imageAdjustments.warmth} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, warmth: v}))} />
          </StExpander>

          <StExpander 
            label="📐 Geometry" isOpen={expanders.geometry} onToggle={() => toggleExpander('geometry')}
            resetAction={() => setTransformSettings(p => ({...p, rotate:0, vertical:0, horizontal:0, scale:1, panX:0, panY:0}))}
          >
            <StSlider label="Rotation" value={transformSettings.rotate} min={-180} max={180} unit="°" onChange={v => setTransformSettings(p => ({...p, rotate: v}))} />
            <StSlider label="Subj. Scale" value={transformSettings.scale} min={0.2} max={4} step={0.01} onChange={v => setTransformSettings(p => ({...p, scale: v}))} />
            <div className="grid grid-cols-2 gap-2">
              <StSlider label="Vert. Perspective" value={transformSettings.vertical} min={-100} max={100} onChange={v => setTransformSettings(p => ({...p, vertical: v}))} />
              <StSlider label="Horiz. Perspective" value={transformSettings.horizontal} min={-100} max={100} onChange={v => setTransformSettings(p => ({...p, horizontal: v}))} />
            </div>
            <div className="pt-2 border-t border-[#31333f]">
              <Button variant={isCropping ? 'primary' : 'secondary'} className="w-full h-8 text-[11px] uppercase tracking-wider font-bold" onClick={() => setIsCropping(!isCropping)}>
                {isCropping ? '✓ Finish Crop' : '✂️ Interactive Crop'}
              </Button>
            </div>
          </StExpander>

          <StExpander label="📥 Export" isOpen={expanders.export} onToggle={() => toggleExpander('export')}>
            <div className="flex gap-2 p-1 bg-[#0e1117] rounded mb-3 border border-[#31333f]">
              <button className={`flex-1 py-1 rounded text-[10px] font-bold ${exportSettings.format === 'image/jpeg' ? 'bg-[#ff4b4b]' : 'opacity-40'}`} onClick={() => setExportSettings(p => ({...p, format: 'image/jpeg'}))}>JPG</button>
              <button className={`flex-1 py-1 rounded text-[10px] font-bold ${exportSettings.format === 'image/png' ? 'bg-[#ff4b4b]' : 'opacity-40'}`} onClick={() => setExportSettings(p => ({...p, format: 'image/png'}))}>PNG</button>
            </div>
            <StSlider label="Export Scale" value={exportSettings.scale} min={0.1} max={3} step={0.1} displayMultiplier={100} unit="%" onChange={v => setExportSettings(p => ({...p, scale: v}))} />
            <Button className="w-full mt-4 bg-[#ff4b4b] hover:bg-[#ff3333] border-0" onClick={() => setStatus(ProcessingStatus.COMPRESSING)}>Ready to Save?</Button>
            {status === ProcessingStatus.COMPRESSING && (
              <div className="text-center mt-2 text-[10px] animate-pulse text-blue-400">Processing high-res output...</div>
            )}
          </StExpander>
        </div>
      </aside>

      {/* Main Streamlit Content Area */}
      <main className="flex-1 bg-[#0e1117] flex flex-col relative overflow-hidden">
        <header className="h-14 border-b border-[#31333f] px-8 flex items-center justify-between bg-[#0e1117] z-10">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 text-sm mono">st.</span>
            <span className="text-white text-sm font-semibold tracking-wide">ChromaKeyComposer</span>
          </div>
          <div className={`text-[10px] font-bold px-3 py-1 rounded-full uppercase tracking-widest ${status === ProcessingStatus.IDLE ? 'bg-gray-800 text-gray-400' : 'bg-[#ff4b4b] text-white animate-pulse'}`}>
            {status}
          </div>
        </header>

        <div ref={mainAreaRef} className="flex-1 p-12 overflow-hidden flex flex-col items-center">
          <div className="w-full max-w-5xl mb-12">
            <StHeader title="Professional AI Composer" sub="Remove backgrounds, adjust perspective, and create the perfect team photo in seconds." />
          </div>

          <div className="flex-1 w-full flex items-center justify-center relative">
            {status === ProcessingStatus.GENERATING_BG && (
              <div className="absolute inset-0 bg-[#0e1117]/80 z-40 flex items-center justify-center backdrop-blur-sm">
                <div className="text-center">
                  <div className="w-12 h-1 border-t-2 border-[#ff4b4b] animate-ping mb-4"></div>
                  <p className="text-sm font-bold text-white uppercase tracking-widest">AI generation in progress...</p>
                </div>
              </div>
            )}

            <div className="absolute top-0 right-0 text-[10px] text-gray-500 bg-[#262730] px-3 py-1.5 rounded-full z-10 border border-[#31333f]">
              View: <span className="text-[#ff4b4b] mono">{Math.round(viewportZoom * 100)}%</span>
            </div>

            <div 
              style={{ transform: `scale(${viewportZoom})`, transition: 'transform 0.15s cubic-bezier(0.2, 0, 0.4, 1)' }}
              className="relative shadow-[0_35px_60px_-15px_rgba(0,0,0,0.8)] border border-[#31333f] bg-checkered rounded-sm"
            >
              {!foregroundSrc ? (
                <div className="w-[500px] h-[320px] flex flex-col items-center justify-center gap-4 bg-[#161b22] border-2 border-dashed border-[#31333f] rounded-lg">
                  <div className="w-16 h-16 rounded-full bg-[#0e1117] flex items-center justify-center border border-[#31333f]">
                    <span className="text-2xl opacity-20">📸</span>
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Workspace Empty</p>
                    <p className="text-[10px] text-gray-600 mt-1">Upload a subject from the sidebar to begin</p>
                  </div>
                </div>
              ) : (
                <div className="relative group">
                  <canvas ref={canvasRef} className="block max-w-[85vw] max-h-[70vh] object-contain" />
                  
                  {isCropping && (
                    <div className="absolute inset-0 z-10 cursor-crosshair">
                      <div className="absolute inset-0 bg-black/50 pointer-events-none" />
                      <div 
                        className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
                        style={{ 
                          left: `${transformSettings.crop.x * 100}%`, top: `${transformSettings.crop.y * 100}%`,
                          width: `${transformSettings.crop.width * 100}%`, height: `${transformSettings.crop.height * 100}%`
                        }}
                        onMouseDown={e => handleCropDrag(e, 'move')}
                      >
                        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 opacity-20 pointer-events-none">
                          {[...Array(9)].map((_, i) => <div key={i} className="border border-white/20" />)}
                        </div>
                        {['nw', 'ne', 'sw', 'se'].map(h => (
                          <div key={h} className={`absolute w-3.5 h-3.5 bg-white rounded-full border border-gray-900 -m-1.75 cursor-${h}-resize hover:scale-125 transition-transform`}
                            style={{ top: h.includes('n') ? 0 : '100%', left: h.includes('w') ? 0 : '100%' }}
                            onMouseDown={e => { e.stopPropagation(); handleCropDrag(e, h); }}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      <style>{`
        .bg-checkered {
          background-image: linear-gradient(45deg, #0e1117 25%, transparent 25%), linear-gradient(-45deg, #0e1117 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #0e1117 75%), linear-gradient(-45deg, transparent 75%, #0e1117 75%);
          background-size: 24px 24px;
          background-position: 0 0, 0 12px, 12px -12px, -12px 0px;
          background-color: #161b22;
        }
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #4b4d5a;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
};

export default App;
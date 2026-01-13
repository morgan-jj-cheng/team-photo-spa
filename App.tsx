
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI } from "@google/genai";

// --- Types & Interfaces ---

export interface ChromaSettings {
  similarity: number;
  smoothness: number;
  spill: number;
  keyColor: string;
}

export interface ImageAdjustments {
  exposure: number;
  contrast: number;
  saturation: number;
  warmth: number;
  tint: number;
  brightness: number;
  blackPoint: number;
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformSettings {
  rotate: number;
  vertical: number;
  horizontal: number;
  scale: number;
  panX: number;
  panY: number;
  crop: CropRect;
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  GENERATING_BG = 'GENERATING_BG',
  DONE = 'DONE',
  ERROR = 'ERROR'
}

// --- Gemini Service ---

const generateAiBackground = async (prompt: string): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ text: prompt }]
      }
    });

    const candidates = response.candidates;
    if (candidates && candidates.length > 0) {
      const parts = candidates[0].content.parts;
      for (const part of parts) {
        if (part.inlineData && part.inlineData.mimeType.startsWith('image/')) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
    }
    throw new Error("No image generated.");
  } catch (error) {
    console.error("Gemini Error:", error);
    throw error;
  }
};

// --- Helpers ---

const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 255, b: 0 };
};

// --- Modern UI Components ---

const IconButton: React.FC<{
  icon: string;
  label?: string;
  onClick?: () => void;
  active?: boolean;
  variant?: 'primary' | 'secondary';
}> = ({ icon, label, onClick, active, variant = 'secondary' }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all text-sm font-semibold
      ${active 
        ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30' 
        : 'bg-white/5 hover:bg-white/10 text-zinc-300'
      } ${variant === 'primary' ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-xl' : ''}`}
  >
    <span>{icon}</span>
    {label && <span>{label}</span>}
  </button>
);

const ControlSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
}> = ({ label, value, min, max, step = 1, onChange }) => (
  <div className="space-y-2 mb-5">
    <div className="flex justify-between text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
      <span>{label}</span>
      <span className="text-indigo-400 font-mono">{value}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-indigo-500 hover:accent-indigo-400 transition-all"
    />
  </div>
);

// --- Main Application ---

const App: React.FC = () => {
  const [foregroundSrc, setForegroundSrc] = useState<string | null>(null);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [activeTab, setActiveTab] = useState<'chroma' | 'adjust' | 'geo' | 'bg'>('chroma');
  const [aiPrompt, setAiPrompt] = useState('');
  const [viewportZoom, setViewportZoom] = useState(1);

  const [chroma, setChroma] = useState<ChromaSettings>({ similarity: 0.35, smoothness: 0.1, spill: 0.1, keyColor: '#00b140' });
  const [adjust, setAdjust] = useState<ImageAdjustments>({ exposure: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, brightness: 0, blackPoint: 0 });
  const [transform, setTransform] = useState<TransformSettings>({ rotate: 0, vertical: 0, horizontal: 0, scale: 1.0, panX: 0, panY: 0, crop: { x: 0, y: 0, width: 1, height: 1 } });
  const [isCropping, setIsCropping] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fgImg, setFgImg] = useState<HTMLImageElement | null>(null);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);

  // --- Handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isFg: boolean) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        if (isFg) { 
          setFgImg(img); 
          setForegroundSrc(url); 
          // Reset viewport zoom when a new image is loaded to fit better
          setViewportZoom(0.9);
        }
        else { setBgImg(img); setBackgroundSrc(url); }
      };
      img.src = url;
    }
  };

  const handleAiBg = async () => {
    if (!aiPrompt.trim()) return;
    setStatus(ProcessingStatus.GENERATING_BG);
    try {
      const url = await generateAiBackground(aiPrompt);
      const img = new Image();
      img.onload = () => { setBgImg(img); setBackgroundSrc(url); setStatus(ProcessingStatus.IDLE); };
      img.src = url;
    } catch { setStatus(ProcessingStatus.ERROR); }
  };

  const downloadResult = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const link = document.createElement('a');
      link.download = `composite-${Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  };

  // --- Rendering Logic ---

  const render = useCallback(() => {
    if (!fgImg) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const { width, height } = fgImg;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width; tempCanvas.height = height;
    const tCtx = tempCanvas.getContext('2d');
    if (!tCtx) return;

    // 1. BG
    if (bgImg) {
      const bgRatio = bgImg.width / bgImg.height;
      const fgRatio = width / height;
      let dW, dH, oX, oY;
      if (bgRatio > fgRatio) { dH = height; dW = bgImg.width * (height / bgImg.height); oX = (width - dW) / 2; oY = 0; }
      else { dW = width; dH = bgImg.height * (width / bgImg.width); oX = 0; oY = (height - dH) / 2; }
      tCtx.drawImage(bgImg, oX, oY, dW, dH);
    } else {
      tCtx.fillStyle = '#09090b';
      tCtx.fillRect(0, 0, width, height);
    }

    // 2. Chroma & Adjust
    const fgCanvas = document.createElement('canvas');
    fgCanvas.width = width; fgCanvas.height = height;
    const fCtx = fgCanvas.getContext('2d');
    if (!fCtx) return;
    fCtx.drawImage(fgImg, 0, 0);
    const imgData = fCtx.getImageData(0, 0, width, height);
    const data = imgData.data;
    const key = hexToRgb(chroma.keyColor);
    const exp = Math.pow(2, adjust.exposure / 50);
    const contrast = (259 * (adjust.contrast + 255)) / (255 * (259 - adjust.contrast));
    const saturation = 1 + (adjust.saturation / 100);

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i], g = data[i+1], b = data[i+2];
      const d = Math.sqrt((r-key.r)**2 + (g-key.g)**2 + (b-key.b)**2) / 442;
      let alpha = 255;
      if (d < chroma.similarity) alpha = 0;
      else if (d < chroma.similarity + chroma.smoothness) alpha = ((d - chroma.similarity) / chroma.smoothness) * 255;

      if (alpha > 0) {
        if (d < chroma.similarity + chroma.spill + chroma.smoothness) { const avg = (r+b)/2; if (g > avg) g = avg; }
        r = r * exp + adjust.brightness; g = g * exp + adjust.brightness; b = b * exp + adjust.brightness;
        r = contrast * (r - 128) + 128; g = contrast * (g - 128) + 128; b = contrast * (b - 128) + 128;
        r += adjust.warmth; b -= adjust.warmth; g += adjust.tint;
        const gray = 0.299*r + 0.587*g + 0.114*b;
        r = gray + (r - gray) * saturation; g = gray + (g - gray) * saturation; b = gray + (b - gray) * saturation;
        data[i] = Math.min(255, Math.max(0, r)); data[i+1] = Math.min(255, Math.max(0, g)); data[i+2] = Math.min(255, Math.max(0, b));
      }
      data[i+3] = alpha;
    }
    fCtx.putImageData(imgData, 0, 0);

    // 3. Composite with Transforms
    tCtx.save();
    tCtx.translate(width/2 + (transform.panX/100)*width, height/2 + (transform.panY/100)*height);
    tCtx.rotate((transform.rotate * Math.PI) / 180);
    tCtx.scale(transform.scale, transform.scale);
    tCtx.drawImage(fgCanvas, -width/2, -height/2);
    tCtx.restore();

    // 4. Final Output (Handling Crop)
    const cw = width * transform.crop.width, ch = height * transform.crop.height;
    canvas.width = isCropping ? width : cw;
    canvas.height = isCropping ? height : ch;
    if (isCropping) ctx.drawImage(tempCanvas, 0, 0);
    else ctx.drawImage(tempCanvas, width * transform.crop.x, height * transform.crop.y, cw, ch, 0, 0, cw, ch);
  }, [fgImg, bgImg, chroma, adjust, transform, isCropping]);

  useEffect(() => { render(); }, [render]);

  return (
    <div className="flex h-screen bg-[#09090b] text-zinc-100 overflow-hidden font-sans selection:bg-indigo-500/30">
      
      {/* Top Header */}
      <nav className="fixed top-0 left-0 right-0 h-16 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl flex items-center justify-between px-8 z-40">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/20">
            <span className="text-xl">📸</span>
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white uppercase">Chroma Studio</h1>
            <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-[0.2em]">Professional Team Compositing</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className={`px-4 py-1.5 rounded-full border text-[10px] font-bold tracking-widest uppercase transition-all
            ${status === ProcessingStatus.IDLE ? 'border-zinc-800 text-zinc-600' : 'border-indigo-500/50 text-indigo-400 animate-pulse'}`}>
            {status}
          </div>
          <IconButton icon="📥" label="Download" onClick={downloadResult} variant="primary" />
        </div>
      </nav>

      {/* Control Panel (LEFT SIDE) */}
      <aside className={`fixed left-8 top-24 w-80 bg-zinc-950/90 backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl transition-all duration-700 overflow-hidden z-30
        ${foregroundSrc ? 'translate-x-0 opacity-100' : '-translate-x-12 opacity-0 pointer-events-none'}`}>
        
        {/* Panel Tabs */}
        <div className="flex border-b border-white/5 bg-white/2">
          {(['chroma', 'adjust', 'geo', 'bg'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-4 text-[10px] font-bold uppercase tracking-widest transition-all relative
                ${activeTab === tab ? 'text-indigo-400' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
              {tab === 'chroma' && 'Chroma'}
              {tab === 'adjust' && 'Color'}
              {tab === 'geo' && 'Layout'}
              {tab === 'bg' && 'Back'}
              {activeTab === tab && <div className="absolute bottom-0 left-1/4 right-1/4 h-0.5 bg-indigo-500 rounded-full" />}
            </button>
          ))}
        </div>

        <div className="p-7 max-h-[65vh] overflow-y-auto custom-scrollbar">
          {activeTab === 'chroma' && (
            <div className="space-y-7 animate-in slide-in-from-left-4 duration-500">
              <div className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10 group">
                <span className="text-xs font-bold text-zinc-300 uppercase tracking-wider">Key Green</span>
                <input type="color" value={chroma.keyColor} onChange={e => setChroma(p=>({...p, keyColor:e.target.value}))} className="w-14 h-8 bg-transparent cursor-pointer rounded-lg overflow-hidden" />
              </div>
              <ControlSlider label="Precision" value={chroma.similarity} min={0} max={1} step={0.01} onChange={v => setChroma(p=>({...p, similarity:v}))} />
              <ControlSlider label="Feathering" value={chroma.smoothness} min={0} max={0.5} step={0.01} onChange={v => setChroma(p=>({...p, smoothness:v}))} />
              <ControlSlider label="Clean Spill" value={chroma.spill} min={0} max={0.5} step={0.01} onChange={v => setChroma(p=>({...p, spill:v}))} />
            </div>
          )}

          {activeTab === 'adjust' && (
            <div className="space-y-7 animate-in slide-in-from-left-4 duration-500">
              <ControlSlider label="Exposure" value={adjust.exposure} min={-100} max={100} onChange={v=>setAdjust(p=>({...p, exposure:v}))} />
              <ControlSlider label="Contrast" value={adjust.contrast} min={-100} max={100} onChange={v=>setAdjust(p=>({...p, contrast:v}))} />
              <ControlSlider label="Saturation" value={adjust.saturation} min={-100} max={100} onChange={v=>setAdjust(p=>({...p, saturation:v}))} />
              <ControlSlider label="Temperature" value={adjust.warmth} min={-100} max={100} onChange={v=>setAdjust(p=>({...p, warmth:v}))} />
            </div>
          )}

          {activeTab === 'geo' && (
            <div className="space-y-7 animate-in slide-in-from-left-4 duration-500">
              <ControlSlider label="Rotate" value={transform.rotate} min={-180} max={180} onChange={v=>setTransform(p=>({...p, rotate:v}))} />
              <ControlSlider label="Scale" value={transform.scale} min={0.2} max={4} step={0.01} onChange={v=>setTransform(p=>({...p, scale:v}))} />
              <ControlSlider label="Offset X" value={transform.panX} min={-100} max={100} onChange={v=>setTransform(p=>({...p, panX:v}))} />
              <ControlSlider label="Offset Y" value={transform.panY} min={-100} max={100} onChange={v=>setTransform(p=>({...p, panY:v}))} />
              <button 
                onClick={() => setIsCropping(!isCropping)}
                className={`w-full py-4 rounded-2xl font-bold text-xs uppercase tracking-[0.2em] transition-all shadow-xl
                  ${isCropping ? 'bg-indigo-600 text-white shadow-indigo-600/30' : 'bg-white/5 text-zinc-400 border border-white/10 hover:bg-white/10'}`}
              >
                {isCropping ? '✓ Finish Crop' : '✂️ Tool: Crop'}
              </button>
            </div>
          )}

          {activeTab === 'bg' && (
            <div className="space-y-7 animate-in slide-in-from-left-4 duration-500">
              <div className="space-y-3">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">AI Backdrop Prompt</label>
                <textarea 
                  className="w-full h-32 bg-white/5 border border-white/10 rounded-2xl p-4 text-sm text-zinc-200 outline-none focus:border-indigo-500/50 transition-all resize-none placeholder:text-zinc-600"
                  placeholder="Elegant corporate headquarters with soft morning light, blurred background..."
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                />
                <button 
                  onClick={handleAiBg}
                  disabled={status === ProcessingStatus.GENERATING_BG || !aiPrompt.trim()}
                  className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-2xl font-bold text-[10px] uppercase tracking-[0.2em] transition-all shadow-2xl shadow-indigo-600/30 active:scale-95"
                >
                  ✨ Generate Scene
                </button>
              </div>
              <div className="pt-6 border-t border-white/5">
                <label className="cursor-pointer group w-full flex flex-col items-center justify-center py-6 bg-white/2 hover:bg-white/5 text-zinc-400 hover:text-white rounded-2xl border border-dashed border-white/10 transition-all">
                  <span className="text-2xl mb-2 opacity-50 group-hover:opacity-100 transition-opacity">🖼️</span>
                  <span className="text-[10px] font-bold uppercase tracking-widest">Load Custom BG</span>
                  <input type="file" className="hidden" onChange={e => handleFileUpload(e, false)} />
                </label>
              </div>
            </div>
          )}
        </div>

        {/* View Zoom Control */}
        <div className="p-6 bg-zinc-950/80 border-t border-white/5 flex items-center justify-between">
           <button onClick={()=>setViewportZoom(z=>Math.max(0.1, z-0.1))} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-xl text-zinc-400 hover:text-white transition-all">－</button>
           <span className="font-mono text-xs text-indigo-400 font-bold tracking-tighter">{Math.round(viewportZoom*100)}%</span>
           <button onClick={()=>setViewportZoom(z=>Math.min(5, z+0.1))} className="w-10 h-10 flex items-center justify-center bg-white/5 hover:bg-white/10 rounded-xl text-zinc-400 hover:text-white transition-all">＋</button>
        </div>
      </aside>

      {/* Main Workspace (Takes full space) */}
      <main className="flex-1 relative flex items-center justify-center bg-studio h-screen">
        {!foregroundSrc ? (
          <div className="text-center animate-in fade-in zoom-in duration-700 max-w-lg px-6">
            <div className="text-8xl mb-10 opacity-30 select-none drop-shadow-2xl">📸</div>
            <h2 className="text-4xl font-black text-white mb-4 tracking-tight">Composite Your Team</h2>
            <p className="text-zinc-400 text-lg mb-10 leading-relaxed font-medium">Remove green screens instantly. Generate unique AI backgrounds for every member.</p>
            
            <label className="inline-block cursor-pointer bg-white text-zinc-950 px-10 py-5 rounded-2xl font-black text-sm uppercase tracking-[0.2em] shadow-[0_0_50px_rgba(255,255,255,0.2)] hover:scale-105 active:scale-95 transition-all">
              🚀 Start Upload
              <input type="file" className="hidden" onChange={e => handleFileUpload(e, true)} />
            </label>
            <p className="mt-6 text-zinc-600 text-[10px] uppercase font-bold tracking-[0.3em]">Supports JPEG, PNG, WEBP</p>
          </div>
        ) : (
          <div 
            className="relative shadow-[0_0_100px_rgba(0,0,0,0.8)] border border-white/5 rounded-sm overflow-hidden bg-black/40 transition-transform duration-500 ease-out" 
            style={{ transform: `scale(${viewportZoom})` }}
          >
            <canvas ref={canvasRef} className="block max-w-[95vw] max-h-[85vh] object-contain" />
            
            {status === ProcessingStatus.GENERATING_BG && (
              <div className="absolute inset-0 bg-zinc-950/90 backdrop-blur-3xl flex flex-col items-center justify-center p-12 z-50">
                <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-6" />
                <p className="text-lg font-black text-indigo-400 tracking-[0.3em] uppercase animate-pulse text-center">Synthesizing Scene</p>
                <p className="text-zinc-500 mt-2 text-xs font-bold uppercase tracking-widest">Gemini Vision AI at work</p>
              </div>
            )}

            {isCropping && (
              <div className="absolute inset-0 pointer-events-none border-[20px] border-indigo-500/20 ring-[4000px] ring-black/60 z-10" />
            )}
          </div>
        )}

        {/* Global Toolbar for Quick Upload when in editor */}
        {foregroundSrc && (
          <div className="fixed bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-3 px-6 py-3 bg-zinc-950/80 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl z-40 scale-90 md:scale-100">
             <label className="cursor-pointer flex items-center gap-3 px-4 py-2 bg-white/5 hover:bg-indigo-600 hover:text-white rounded-xl text-xs font-bold uppercase tracking-widest transition-all">
                <span>📁 New Subject</span>
                <input type="file" className="hidden" onChange={e => handleFileUpload(e, true)} />
             </label>
             <div className="w-px h-6 bg-white/10 mx-1" />
             <button onClick={() => setViewportZoom(1)} className="px-4 py-2 text-zinc-500 hover:text-white text-xs font-bold uppercase tracking-widest transition-all">Fit to Screen</button>
          </div>
        )}
      </main>

      <style>{`
        .bg-studio {
          background-color: #050507;
          background-image: 
            radial-gradient(at 0% 0%, hsla(253,16%,12%,1) 0, transparent 50%), 
            radial-gradient(at 50% 50%, hsla(225,39%,15%,0.3) 0, transparent 80%), 
            radial-gradient(at 100% 100%, hsla(339,49%,20%,0.1) 0, transparent 50%);
        }
        .custom-scrollbar::-webkit-scrollbar { width: 3px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 20px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(99, 102, 241, 0.4); }
        
        input[type='range']::-webkit-slider-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid #6366f1;
          background: #09090b;
          cursor: pointer;
          -webkit-appearance: none;
          box-shadow: 0 0 15px rgba(99, 102, 241, 0.6);
          transition: all 0.2s;
        }
        input[type='range']::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          background: #6366f1;
        }
      `}</style>
    </div>
  );
};

export default App;

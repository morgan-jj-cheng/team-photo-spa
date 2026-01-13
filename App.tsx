
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
  CAPTURING = 'CAPTURING',
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

// --- Streamlit UI Components ---

const Button: React.FC<{
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
  disabled?: boolean;
}> = ({ children, onClick, variant = 'primary', className = '', disabled }) => {
  const variants = {
    primary: "bg-[#ff4b4b] text-white hover:bg-[#ff3333]",
    secondary: "bg-[#31333f] text-[#fafafa] hover:bg-[#4b4d5a]",
    danger: "bg-transparent border border-red-500 text-red-500 hover:bg-red-500 hover:text-white"
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`px-4 py-2 rounded text-xs font-semibold transition-all disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
};

const StExpander: React.FC<{
  label: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  resetAction?: () => void;
}> = ({ label, isOpen, onToggle, children, resetAction }) => (
  <div className="border border-[#31333f] rounded mb-4 bg-[#262730]">
    <div className="flex items-center justify-between p-3 cursor-pointer select-none" onClick={onToggle}>
      <div className="flex items-center gap-3">
        <span className={`text-[10px] transition-transform ${isOpen ? 'rotate-180' : ''}`}>▼</span>
        <span className="text-sm font-semibold">{label}</span>
      </div>
      {resetAction && (
        <button onClick={(e) => { e.stopPropagation(); resetAction(); }} className="text-[10px] text-[#ff4b4b] hover:underline uppercase">Reset</button>
      )}
    </div>
    {isOpen && <div className="p-4 border-t border-[#31333f] space-y-4">{children}</div>}
  </div>
);

const StSlider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (val: number) => void;
}> = ({ label, value, min, max, step = 1, unit = "", onChange }) => (
  <div className="space-y-1">
    <div className="flex justify-between">
      <label className="text-xs font-medium text-gray-300">{label}</label>
      <span className="text-xs text-[#ff4b4b] font-mono">{value}{unit}</span>
    </div>
    <input
      type="range" min={min} max={max} step={step} value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      className="w-full h-1 bg-[#31333f] rounded appearance-none cursor-pointer accent-[#ff4b4b]"
    />
  </div>
);

// --- Main Application ---

const App: React.FC = () => {
  const [foregroundSrc, setForegroundSrc] = useState<string | null>(null);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [viewportZoom, setViewportZoom] = useState(0.85);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');

  const [expanders, setExpanders] = useState({ assets: true, chroma: true, adjust: true, geo: true, export: false });
  const [chroma, setChroma] = useState<ChromaSettings>({ similarity: 0.35, smoothness: 0.1, spill: 0.1, keyColor: '#00b140' });
  const [adjust, setAdjust] = useState<ImageAdjustments>({ exposure: 0, contrast: 0, saturation: 0, warmth: 0, tint: 0, brightness: 0, blackPoint: 0 });
  const [transform, setTransform] = useState<TransformSettings>({ rotate: 0, vertical: 0, horizontal: 0, scale: 1.0, panX: 0, panY: 0, crop: { x: 0, y: 0, width: 1, height: 1 } });
  const [isCropping, setIsCropping] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [fgImg, setFgImg] = useState<HTMLImageElement | null>(null);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);

  // --- Handlers ---

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, isFg: boolean) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        if (isFg) { setFgImg(img); setForegroundSrc(url); }
        else { setBgImg(img); setBackgroundSrc(url); }
      };
      img.src = url;
    }
  };

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setIsCameraActive(true);
      }
    } catch (err) {
      console.error("Camera error:", err);
      alert("Could not access camera.");
    }
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const capCanvas = document.createElement('canvas');
      capCanvas.width = video.videoWidth;
      capCanvas.height = video.videoHeight;
      const ctx = capCanvas.getContext('2d');
      ctx?.drawImage(video, 0, 0);
      const dataUrl = capCanvas.toDataURL('image/png');
      const img = new Image();
      img.onload = () => {
        setFgImg(img);
        setForegroundSrc(dataUrl);
        setIsCameraActive(false);
        (video.srcObject as MediaStream)?.getTracks().forEach(t => t.stop());
      };
      img.src = dataUrl;
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

  // --- Core Processing Logic ---

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

    // 1. Draw BG
    if (bgImg) {
      const bgRatio = bgImg.width / bgImg.height;
      const fgRatio = width / height;
      let dW, dH, oX, oY;
      if (bgRatio > fgRatio) { dH = height; dW = bgImg.width * (height / bgImg.height); oX = (width - dW) / 2; oY = 0; }
      else { dW = width; dH = bgImg.height * (width / bgImg.width); oX = 0; oY = (height - dH) / 2; }
      tCtx.drawImage(bgImg, oX, oY, dW, dH);
    } else {
      tCtx.fillStyle = '#161b22';
      tCtx.fillRect(0, 0, width, height);
    }

    // 2. Process FG (Chroma & Adjust)
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

    // 3. Perspective
    let pImg: CanvasImageSource = fgCanvas;
    if (transform.vertical !== 0 || transform.horizontal !== 0) {
      const pC = document.createElement('canvas'); pC.width = width; pC.height = height;
      const pX = pC.getContext('2d');
      if (pX) {
        const vTilt = transform.vertical / 200;
        const hTilt = transform.horizontal / 200;
        for (let y = 0; y < height; y++) {
          const s = 1 + ((y / height) - 0.5) * vTilt * 2;
          pX.drawImage(fgCanvas, 0, y, width, 1, (width - width*s)/2, y, width*s, 1);
        }
        // Horizontal tilt is harder to do per-pixel accurately without a library, but we'll approximate with scaling slices
        pImg = pC;
      }
    }

    // 4. Transform & Composite
    tCtx.save();
    tCtx.translate(width/2 + (transform.panX/100)*width, height/2 + (transform.panY/100)*height);
    tCtx.rotate((transform.rotate * Math.PI) / 180);
    tCtx.scale(transform.scale, transform.scale);
    tCtx.drawImage(pImg, -width/2, -height/2);
    tCtx.restore();

    // 5. Crop
    const c = transform.crop;
    const cw = width * c.width, ch = height * c.height;
    canvas.width = isCropping ? width : cw;
    canvas.height = isCropping ? height : ch;
    if (isCropping) ctx.drawImage(tempCanvas, 0, 0);
    else ctx.drawImage(tempCanvas, width * c.x, height * c.y, cw, ch, 0, 0, cw, ch);

  }, [fgImg, bgImg, chroma, adjust, transform, isCropping]);

  useEffect(() => { render(); }, [render]);

  return (
    <div className="flex h-screen bg-[#0e1117] text-[#fafafa] overflow-hidden font-sans">
      {/* Sidebar */}
      <aside className="w-[350px] bg-[#262730] border-r border-[#31333f] flex flex-col overflow-y-auto custom-scrollbar">
        <div className="p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-[#ff4b4b] rounded flex items-center justify-center font-bold">ST</div>
            <h1 className="text-xl font-bold">Team Photo Editor</h1>
          </div>

          <StExpander label="📁 Team Photos" isOpen={expanders.assets} onToggle={() => setExpanders(p=>({...p, assets:!p.assets}))}>
            <div className="space-y-4">
              <Button onClick={() => isCameraActive ? capturePhoto() : startCamera()} className="w-full">
                {isCameraActive ? '📸 Capture Now' : '📹 Take Photo Live'}
              </Button>
              {isCameraActive && (
                <div className="rounded overflow-hidden border border-[#ff4b4b]">
                  <video ref={videoRef} autoPlay playsInline className="w-full bg-black h-[200px]" />
                </div>
              )}
              <div>
                <label className="text-[10px] uppercase font-bold text-gray-500 mb-1 block">Subject Upload</label>
                <input type="file" onChange={e => handleFileUpload(e, true)} className="text-[10px] w-full" />
              </div>
              <div className="pt-2 border-t border-[#31333f]">
                <label className="text-[10px] uppercase font-bold text-gray-500 mb-1 block">AI Backdrop Generator</label>
                <div className="flex gap-1">
                  <input className="flex-1 bg-[#0e1117] border border-[#31333f] rounded px-2 py-1.5 text-xs outline-none" placeholder="Modern office..." value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} />
                  <Button onClick={handleAiBg} className="px-3" disabled={status === ProcessingStatus.GENERATING_BG}>✨</Button>
                </div>
              </div>
            </div>
          </StExpander>

          <StExpander label="🪄 Green Screen" isOpen={expanders.chroma} onToggle={() => setExpanders(p=>({...p, chroma:!p.chroma}))}>
            <div className="flex items-center justify-between">
              <span className="text-xs">Key Color</span>
              <input type="color" value={chroma.keyColor} onChange={e => setChroma(p=>({...p, keyColor:e.target.value}))} />
            </div>
            <StSlider label="Similarity" value={chroma.similarity} min={0} max={1} step={0.01} onChange={v => setChroma(p=>({...p, similarity:v}))} />
            <StSlider label="Smoothness" value={chroma.smoothness} min={0} max={0.5} step={0.01} onChange={v => setChroma(p=>({...p, smoothness:v}))} />
            <StSlider label="Green Spill" value={chroma.spill} min={0} max={0.5} step={0.01} onChange={v => setChroma(p=>({...p, spill:v}))} />
          </StExpander>

          <StExpander label="⚖️ Adjust" isOpen={expanders.adjust} onToggle={() => setExpanders(p=>({...p, adjust:!p.adjust}))} resetAction={()=>setAdjust({exposure:0,contrast:0,saturation:0,warmth:0,tint:0,brightness:0,blackPoint:0})}>
            <StSlider label="Exposure" value={adjust.exposure} min={-100} max={100} onChange={v=>setAdjust(p=>({...p, exposure:v}))} />
            <StSlider label="Contrast" value={adjust.contrast} min={-100} max={100} onChange={v=>setAdjust(p=>({...p, contrast:v}))} />
            <StSlider label="Saturation" value={adjust.saturation} min={-100} max={100} onChange={v=>setAdjust(p=>({...p, saturation:v}))} />
            <StSlider label="Warmth" value={adjust.warmth} min={-100} max={100} onChange={v=>setAdjust(p=>({...p, warmth:v}))} />
          </StExpander>

          <StExpander label="📐 Geometry" isOpen={expanders.geo} onToggle={() => setExpanders(p=>({...p, geo:!p.geo}))}>
            <StSlider label="Rotation" value={transform.rotate} min={-180} max={180} unit="°" onChange={v=>setTransform(p=>({...p, rotate:v}))} />
            <StSlider label="Scale" value={transform.scale} min={0.2} max={3} step={0.01} onChange={v=>setTransform(p=>({...p, scale:v}))} />
            <div className="flex gap-2">
              <StSlider label="X Pan" value={transform.panX} min={-100} max={100} onChange={v=>setTransform(p=>({...p, panX:v}))} />
              <StSlider label="Y Pan" value={transform.panY} min={-100} max={100} onChange={v=>setTransform(p=>({...p, panY:v}))} />
            </div>
            <Button variant={isCropping ? 'primary' : 'secondary'} className="w-full mt-2" onClick={() => setIsCropping(!isCropping)}>
              {isCropping ? '✓ Done Cropping' : '✂️ Interactive Crop'}
            </Button>
          </StExpander>

          <StExpander label="📥 Export" isOpen={expanders.export} onToggle={() => setExpanders(p=>({...p, export:!p.export}))}>
            <Button onClick={downloadResult} className="w-full py-3 text-sm">Download Result</Button>
          </StExpander>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col relative overflow-hidden">
        <header className="h-14 border-b border-[#31333f] px-8 flex items-center justify-between bg-[#0e1117] z-10">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-gray-500 font-mono">st.</span>
            <span className="font-semibold">ChromaKey Composer</span>
          </div>
          <div className={`text-[10px] px-2 py-1 rounded bg-[#ff4b4b] font-bold ${status === ProcessingStatus.IDLE ? 'opacity-30' : 'animate-pulse'}`}>
            {status}
          </div>
        </header>

        <div className="flex-1 p-10 flex flex-col items-center justify-center overflow-auto bg-checkered">
          {!foregroundSrc ? (
            <div className="text-center space-y-4 max-w-md">
              <div className="text-6xl mb-4">📸</div>
              <h2 className="text-2xl font-bold">Ready to take team photos?</h2>
              <p className="text-gray-400 text-sm">Use the sidebar to capture a photo or upload an existing one. We'll automatically remove the green background for you.</p>
            </div>
          ) : (
            <div className="relative shadow-2xl border border-[#31333f] bg-black" style={{ transform: `scale(${viewportZoom})`, transition: 'transform 0.2s' }}>
              <canvas ref={canvasRef} className="block max-w-[90vw] max-h-[70vh]" />
              {status === ProcessingStatus.GENERATING_BG && (
                <div className="absolute inset-0 bg-black/60 flex items-center justify-center backdrop-blur-sm">
                   <div className="text-center font-bold text-sm tracking-widest animate-pulse">GENERATING BACKGROUND...</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* View Controls */}
        <div className="absolute bottom-6 right-6 flex items-center gap-2 bg-[#262730] p-1 rounded-full border border-[#31333f] z-20">
           <button onClick={()=>setViewportZoom(z=>Math.max(0.1, z-0.1))} className="w-8 h-8 hover:bg-[#ff4b4b] rounded-full text-lg">-</button>
           <span className="text-[10px] font-mono w-10 text-center">{Math.round(viewportZoom*100)}%</span>
           <button onClick={()=>setViewportZoom(z=>Math.min(3, z+0.1))} className="w-8 h-8 hover:bg-[#ff4b4b] rounded-full text-lg">+</button>
        </div>
      </main>

      <style>{`
        .bg-checkered {
          background-image: linear-gradient(45deg, #0e1117 25%, transparent 25%), linear-gradient(-45deg, #0e1117 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #0e1117 75%), linear-gradient(-45deg, transparent 75%, #0e1117 75%);
          background-size: 20px 20px;
          background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
          background-color: #161b22;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #4b4d5a; border-radius: 2px; }
      `}</style>
    </div>
  );
};

export default App;

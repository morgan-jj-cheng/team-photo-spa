import React, { useState, useRef, useEffect, useCallback } from 'react';
import { generateAiBackground } from './services/geminiService';
import { ChromaSettings, ImageAdjustments, TransformSettings, ExportSettings, ProcessingStatus, CropRect } from './types';
import { Button } from './components/Button';

// Utility to convert hex to RGB
const hexToRgb = (hex: string) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 255, b: 0 };
};

// --- Components ---

const CollapsibleSection: React.FC<{
  title: string;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  rightElement?: React.ReactNode;
}> = ({ title, isOpen, onToggle, children, rightElement }) => {
  return (
    <div className="border-b border-gray-700 bg-gray-800">
      <div 
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-750 transition-colors select-none"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
           <span className="text-gray-400 text-xs">
             {isOpen ? '▼' : '▶'} 
           </span>
           <h2 className="text-xs font-bold text-gray-300 uppercase tracking-widest">{title}</h2>
        </div>
        {rightElement && <div onClick={e => e.stopPropagation()}>{rightElement}</div>}
      </div>
      {isOpen && (
        <div className="p-4 pt-0 space-y-4 animate-in fade-in slide-in-from-top-1 duration-200">
          {children}
        </div>
      )}
    </div>
  );
};

const SliderControl: React.FC<{
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

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let val = parseFloat(e.target.value);
    if (isNaN(val)) return;
    const limitMax = max * displayMultiplier;
    const limitMin = min * displayMultiplier;
    if (val > limitMax) val = limitMax;
    if (val < limitMin) val = limitMin;
    onChange(val / displayMultiplier);
  };

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-xs text-gray-400">
        <label>{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            value={displayValue}
            onChange={handleNumberChange}
            className="w-12 bg-gray-900 border border-gray-700 rounded px-1 text-right text-xs focus:ring-1 focus:ring-blue-500 outline-none"
          />
          <span className="w-3">{unit}</span>
        </div>
      </div>
      <input 
        type="range" 
        min={min} max={max} step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
      />
    </div>
  );
};

const App: React.FC = () => {
  // --- State ---
  const [foregroundSrc, setForegroundSrc] = useState<string | null>(null);
  const [backgroundSrc, setBackgroundSrc] = useState<string | null>(null);
  const [viewportZoom, setViewportZoom] = useState(1.0);
  
  // Sections State
  const [sections, setSections] = useState({
    assets: true,
    chroma: true,
    adjustments: false,
    geometry: false,
    export: true
  });
  
  const toggleSection = (key: keyof typeof sections) => {
    setSections(p => ({ ...p, [key]: !p[key] }));
  };

  const [chromaSettings, setChromaSettings] = useState<ChromaSettings>({
    similarity: 0.4,
    smoothness: 0.08,
    spill: 0.1,
    keyColor: '#00FF00'
  });

  const [imageAdjustments, setImageAdjustments] = useState<ImageAdjustments>({
    exposure: 0,
    brilliance: 0,
    highlights: 0,
    shadows: 0,
    contrast: 0,
    brightness: 0,
    blackPoint: 0,
    saturation: 0,
    warmth: 0,
    tint: 0,
    sharpness: 0
  });

  const [transformSettings, setTransformSettings] = useState<TransformSettings>({
    rotate: 0,
    vertical: 0,
    horizontal: 0,
    scale: 1.0,
    panX: 0,
    panY: 0,
    crop: { x: 0, y: 0, width: 1, height: 1 }
  });

  // Crop Mode State
  const [isCropping, setIsCropping] = useState(false);
  const cropContainerRef = useRef<HTMLDivElement>(null);
  const mainAreaRef = useRef<HTMLDivElement>(null);

  const [aiPrompt, setAiPrompt] = useState('');
  const [status, setStatus] = useState<ProcessingStatus>(ProcessingStatus.IDLE);
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: 'image/png',
    quality: 0.9,
    maxSizeKB: undefined,
    scale: 1.0
  });

  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadSize, setDownloadSize] = useState<string>('');

  // --- Refs ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  
  // Cache images
  const [fgImg, setFgImg] = useState<HTMLImageElement | null>(null);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);

  // --- Handlers ---
  const handleForegroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setFgImg(img);
        setForegroundSrc(url);
        // Reset zoom on new image
        setViewportZoom(1.0);
      };
      img.src = url;
    }
  };

  const handleBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setBgImg(img);
        setBackgroundSrc(url);
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
      console.error(error);
      alert("Failed to generate background. Check API Key or try again.");
      setStatus(ProcessingStatus.ERROR);
    }
  };

  // Zoom Handler
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        const delta = -e.deltaY;
        setViewportZoom(prev => {
           const newZoom = prev + delta * 0.002;
           return Math.min(Math.max(0.1, newZoom), 5.0);
        });
      }
    };

    const el = mainAreaRef.current;
    if (el) {
       el.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
       if (el) el.removeEventListener('wheel', handleWheel);
    };
  }, []);

  // --- Core Processing Logic ---
  const processComposite = useCallback(() => {
    const displayCanvas = canvasRef.current;
    if (!displayCanvas || !fgImg) return;

    // We do all composition on an off-screen buffer first
    // This buffer is always the size of the original foreground image
    const width = fgImg.width;
    const height = fgImg.height;

    const bufferCanvas = document.createElement('canvas');
    bufferCanvas.width = width;
    bufferCanvas.height = height;
    const ctx = bufferCanvas.getContext('2d', { willReadFrequently: true });
    
    if (!ctx) return;

    // 1. Draw Background to Buffer
    if (bgImg) {
      const bgRatio = bgImg.width / bgImg.height;
      const canvasRatio = width / height;
      let renderWidth, renderHeight, offsetX, offsetY;

      if (bgRatio > canvasRatio) {
        renderHeight = height;
        renderWidth = bgImg.width * (height / bgImg.height);
        offsetX = (width - renderWidth) / 2;
        offsetY = 0;
      } else {
        renderWidth = width;
        renderHeight = bgImg.height * (width / bgImg.width);
        offsetX = 0;
        offsetY = (height - renderHeight) / 2;
      }
      ctx.drawImage(bgImg, offsetX, offsetY, renderWidth, renderHeight);
    } else {
      const s = 20;
      for(let y=0; y<height; y+=s) {
        for(let x=0; x<width; x+=s) {
          ctx.fillStyle = ((x/s + y/s) % 2 === 0) ? '#333' : '#444';
          ctx.fillRect(x,y,s,s);
        }
      }
    }

    // 2. Prepare Foreground (Pixel Processing)
    const workCanvas = document.createElement('canvas');
    workCanvas.width = width;
    workCanvas.height = height;
    const workCtx = workCanvas.getContext('2d', { willReadFrequently: true });
    if (!workCtx) return;

    workCtx.drawImage(fgImg, 0, 0);
    const frameData = workCtx.getImageData(0, 0, width, height);
    const data = frameData.data;
    const l = data.length / 4;
    const target = hexToRgb(chromaSettings.keyColor);
    
    // -- Optimization Constants --
    const smoothnessInv = chromaSettings.smoothness > 0 ? 1 / chromaSettings.smoothness : 0;
    const spillThreshold = chromaSettings.similarity + chromaSettings.spill;

    // Adjustments
    const exposureMult = Math.pow(2, imageAdjustments.exposure / 100);
    const contrastVal = imageAdjustments.contrast * 2.55;
    const contrastFactor = (259 * (contrastVal + 255)) / (255 * (259 - contrastVal));
    const brightnessVal = imageAdjustments.brightness; 
    const blackPointVal = imageAdjustments.blackPoint;
    const satVal = imageAdjustments.saturation / 100;
    const warmthVal = imageAdjustments.warmth;
    const tintVal = imageAdjustments.tint;
    const brillianceVal = imageAdjustments.brilliance;
    const highlightsVal = imageAdjustments.highlights;
    const shadowsVal = imageAdjustments.shadows;
    const sharpVal = imageAdjustments.sharpness / 100;

    // Blur data for sharpness
    let blurData: Uint8ClampedArray | null = null;
    if (sharpVal > 0) {
      const bCanvas = document.createElement('canvas');
      bCanvas.width = width;
      bCanvas.height = height;
      const bCtx = bCanvas.getContext('2d');
      if (bCtx) {
         bCtx.filter = 'blur(2px)';
         bCtx.drawImage(fgImg, 0, 0);
         blurData = bCtx.getImageData(0, 0, width, height).data;
      }
    }

    for (let i = 0; i < l; i++) {
      const offset = i * 4;
      let r = data[offset];
      let g = data[offset + 1];
      let b = data[offset + 2];
      
      const dist = Math.sqrt((r - target.r) ** 2 + (g - target.g) ** 2 + (b - target.b) ** 2);
      const similarity = dist / 442;
      let alpha = 255;

      if (similarity < chromaSettings.similarity) {
        alpha = 0;
      } else if (similarity < (chromaSettings.similarity + chromaSettings.smoothness)) {
        alpha = Math.floor(((similarity - chromaSettings.similarity) * smoothnessInv) * 255);
      }

      if (similarity < spillThreshold && alpha > 0) {
         const maxRB = (r + b) / 2;
         if (g > maxRB) g = maxRB;
      }

      if (alpha > 0) {
        if (blurData && sharpVal > 0) {
            const br = blurData[offset];
            const bg = blurData[offset + 1];
            const bb = blurData[offset + 2];
            r += (r - br) * sharpVal * 2;
            g += (g - bg) * sharpVal * 2;
            b += (b - bb) * sharpVal * 2;
        }

        if (exposureMult !== 1) { r *= exposureMult; g *= exposureMult; b *= exposureMult; }
        if (brillianceVal !== 0) {
            const lum = 0.299*r + 0.587*g + 0.114*b;
            const adj = (brillianceVal / 100) * (128 - lum) * 0.5; 
            r += adj; g += adj; b += adj;
        }
        if (highlightsVal !== 0 || shadowsVal !== 0) {
           const lum = 0.299*r + 0.587*g + 0.114*b;
           if (shadowsVal !== 0 && lum < 128) {
              const adj = shadowsVal * ((128 - lum) / 128) * 0.6;
              r += adj; g += adj; b += adj;
           }
           if (highlightsVal !== 0 && lum > 128) {
              const adj = highlightsVal * ((lum - 128) / 128) * 0.6;
              r += adj; g += adj; b += adj;
           }
        }
        if (contrastVal !== 0) {
            r = contrastFactor * (r - 128) + 128;
            g = contrastFactor * (g - 128) + 128;
            b = contrastFactor * (b - 128) + 128;
        }
        if (brightnessVal !== 0) { r += brightnessVal; g += brightnessVal; b += brightnessVal; }
        if (blackPointVal !== 0) {
            r = Math.max(0, r - blackPointVal);
            g = Math.max(0, g - blackPointVal);
            b = Math.max(0, b - blackPointVal);
        }
        if (satVal !== 0) {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = gray + (r - gray) * (1 + satVal);
            g = gray + (g - gray) * (1 + satVal);
            b = gray + (b - gray) * (1 + satVal);
        }
        if (warmthVal !== 0) { r += warmthVal; b -= warmthVal; }
        if (tintVal !== 0) { g += tintVal; }

        data[offset] = Math.min(255, Math.max(0, r));
        data[offset + 1] = Math.min(255, Math.max(0, g));
        data[offset + 2] = Math.min(255, Math.max(0, b));
      }
      data[offset + 3] = alpha;
    }

    workCtx.putImageData(frameData, 0, 0);

    // 3. Apply Geometric Transforms (Perspective -> Rotate -> Scale/Pan)
    const perspectiveCanvas = document.createElement('canvas');
    perspectiveCanvas.width = width;
    perspectiveCanvas.height = height;
    const pCtx = perspectiveCanvas.getContext('2d');

    if (pCtx) {
       let sourceForVertical = workCanvas;
       if (Math.abs(transformSettings.horizontal) > 0) {
          const hTemp = document.createElement('canvas');
          hTemp.width = width;
          hTemp.height = height;
          const hCtx = hTemp.getContext('2d');
          if (hCtx) {
              const strength = transformSettings.horizontal / 200; 
              for (let x = 0; x < width; x+=2) { 
                  const normX = (x - width/2) / (width/2);
                  const scale = 1 - (normX * strength);
                  if (scale <= 0) continue;
                  const h = height * scale;
                  const y = (height - h) / 2;
                  hCtx.drawImage(workCanvas, x, 0, 2, height, x, y, 2, h);
              }
              sourceForVertical = hTemp;
          }
       }

       if (Math.abs(transformSettings.vertical) > 0) {
          const strength = transformSettings.vertical / 200;
          for (let y = 0; y < height; y+=2) {
              const normY = (y - height/2) / (height/2);
              const scale = 1 - (normY * strength);
              if (scale <= 0) continue;
              const w = width * scale;
              const x = (width - w) / 2;
              pCtx.drawImage(sourceForVertical, 0, y, width, 2, x, y, w, 2);
          }
       } else {
          pCtx.drawImage(sourceForVertical, 0, 0);
       }
    }

    // 4. Composite Foreground onto Buffer
    ctx.save();
    // Move to center + pan
    const panXPx = (transformSettings.panX / 100) * width;
    const panYPx = (transformSettings.panY / 100) * height;
    ctx.translate(width/2 + panXPx, height/2 + panYPx);
    ctx.rotate((transformSettings.rotate * Math.PI) / 180);
    ctx.scale(transformSettings.scale, transformSettings.scale);
    ctx.drawImage(perspectiveCanvas, -width/2, -height/2);
    ctx.restore();

    // 5. Output to Display Canvas
    // Logic: If 'isCropping' is true, we show the full buffer so the user can interact with the crop tool over the full image.
    //        If 'isCropping' is false, we visually apply the crop to the display canvas (zooming in).
    const displayCtx = displayCanvas.getContext('2d');
    if (!displayCtx) return;

    if (isCropping) {
        // Show Full Image for Editing
        displayCanvas.width = bufferCanvas.width;
        displayCanvas.height = bufferCanvas.height;
        displayCtx.drawImage(bufferCanvas, 0, 0);
    } else {
        // Show Cropped Result
        const { crop } = transformSettings;
        // Ensure crop dimensions are valid
        const cropW = Math.max(1, bufferCanvas.width * crop.width);
        const cropH = Math.max(1, bufferCanvas.height * crop.height);
        const cropX = bufferCanvas.width * crop.x;
        const cropY = bufferCanvas.height * crop.y;

        displayCanvas.width = cropW;
        displayCanvas.height = cropH;
        displayCtx.drawImage(bufferCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    }

  }, [fgImg, bgImg, chromaSettings, imageAdjustments, transformSettings.rotate, transformSettings.vertical, transformSettings.horizontal, transformSettings.scale, transformSettings.panX, transformSettings.panY, isCropping, transformSettings.crop]);

  useEffect(() => {
    if (fgImg) {
      requestAnimationFrame(processComposite);
    }
  }, [processComposite, fgImg]);

  // --- Crop Logic ---
  const handleCropDrag = (e: React.MouseEvent, handle: string) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!cropContainerRef.current) return;
    const rect = cropContainerRef.current.getBoundingClientRect();
    
    const startX = e.clientX;
    const startY = e.clientY;
    
    // Snapshot current crop state
    const startCrop = { ...transformSettings.crop };
    
    const moveHandler = (moveEvent: MouseEvent) => {
      const deltaX = (moveEvent.clientX - startX) / rect.width;
      const deltaY = (moveEvent.clientY - startY) / rect.height;
      
      let newCrop = { ...startCrop };
      
      // Update based on handle
      if (handle === 'move') {
          newCrop.x = Math.min(Math.max(0, startCrop.x + deltaX), 1 - startCrop.width);
          newCrop.y = Math.min(Math.max(0, startCrop.y + deltaY), 1 - startCrop.height);
      } else {
          if (handle.includes('e')) newCrop.width = Math.min(Math.max(0.05, startCrop.width + deltaX), 1 - startCrop.x);
          if (handle.includes('s')) newCrop.height = Math.min(Math.max(0.05, startCrop.height + deltaY), 1 - startCrop.y);
          if (handle.includes('w')) {
             const maxDelta = startCrop.width - 0.05;
             const d = Math.min(deltaX, maxDelta);
             newCrop.x = Math.max(0, startCrop.x + d);
             newCrop.width = startCrop.width - d;
          }
          if (handle.includes('n')) {
             const maxDelta = startCrop.height - 0.05;
             const d = Math.min(deltaY, maxDelta);
             newCrop.y = Math.max(0, startCrop.y + d);
             newCrop.height = startCrop.height - d;
          }
      }
      
      setTransformSettings(prev => ({ ...prev, crop: newCrop }));
    };

    const upHandler = () => {
      document.removeEventListener('mousemove', moveHandler);
      document.removeEventListener('mouseup', upHandler);
    };

    document.addEventListener('mousemove', moveHandler);
    document.addEventListener('mouseup', upHandler);
  };


  const handleExport = async () => {
    if (!canvasRef.current) return;
    setStatus(ProcessingStatus.COMPRESSING);
    setDownloadUrl(null);
    await new Promise(r => setTimeout(r, 50));

    const displayCanvas = canvasRef.current;
    let currentQuality = exportSettings.quality;
    const currentScale = exportSettings.scale;
    
    // Create a new canvas for export based on the current display content
    const sourceWidth = displayCanvas.width;
    const sourceHeight = displayCanvas.height;
    
    const finalW = Math.floor(sourceWidth * currentScale);
    const finalH = Math.floor(sourceHeight * currentScale);

    const exportCanvas = document.createElement('canvas');
    exportCanvas.width = finalW;
    exportCanvas.height = finalH;
    const ctx = exportCanvas.getContext('2d');
    if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(displayCanvas, 0, 0, finalW, finalH);
    }
    
    let attempts = 0;
    const maxAttempts = 10;
    
    const tryCompress = async (q: number): Promise<Blob | null> => {
       return new Promise((resolve) => {
         exportCanvas.toBlob(blob => {
           resolve(blob);
         }, exportSettings.format, q);
       });
    };

    let resultBlob: Blob | null = await tryCompress(currentQuality);

    if (exportSettings.maxSizeKB && exportSettings.maxSizeKB > 0 && resultBlob) {
      const targetBytes = exportSettings.maxSizeKB * 1024;
      while (resultBlob && resultBlob.size > targetBytes && attempts < maxAttempts) {
        attempts++;
        currentQuality -= 0.1;
        if (currentQuality < 0.1) currentQuality = 0.1;
        resultBlob = await tryCompress(currentQuality);
        if (currentQuality <= 0.1 && resultBlob.size > targetBytes) break;
      }
    }

    if (resultBlob) {
      setDownloadUrl(URL.createObjectURL(resultBlob));
      setDownloadSize(`${(resultBlob.size / 1024).toFixed(1)} KB`);
    }
    setStatus(ProcessingStatus.DONE);
  };

  const resetAdjustments = () => {
    setImageAdjustments({
        exposure: 0, brilliance: 0, highlights: 0, shadows: 0,
        contrast: 0, brightness: 0, blackPoint: 0, saturation: 0,
        warmth: 0, tint: 0, sharpness: 0
    });
  };

  const resetTransforms = () => {
    setTransformSettings({
      rotate: 0, vertical: 0, horizontal: 0, scale: 1.0, panX: 0, panY: 0,
      crop: { x: 0, y: 0, width: 1, height: 1 }
    });
    setIsCropping(false);
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100 font-sans">
      <header className="flex-none p-4 bg-gray-800 border-b border-gray-700 flex items-center justify-between shadow-md z-10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-green-500 rounded-lg flex items-center justify-center font-bold text-gray-900">CK</div>
          <h1 className="text-xl font-semibold tracking-tight">ChromaKey <span className="text-blue-400">AI Composer</span></h1>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Left: Collapsible Sidebar - Now Contains ALL Controls */}
        <aside className="w-80 flex-none bg-gray-800 border-r border-gray-700 flex flex-col z-20">
          
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            <CollapsibleSection title="1. Assets" isOpen={sections.assets} onToggle={() => toggleSection('assets')}>
                <div className="grid grid-cols-2 gap-2">
                    <button onClick={() => fileInputRef.current?.click()} className="flex flex-col items-center justify-center p-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition">
                        <span className="text-lg">👤</span>
                        <span className="text-xs mt-1">Person</span>
                    </button>
                    <button onClick={() => bgInputRef.current?.click()} className="flex flex-col items-center justify-center p-3 bg-gray-700 hover:bg-gray-600 rounded-lg transition">
                        <span className="text-lg">🖼️</span>
                        <span className="text-xs mt-1">Background</span>
                    </button>
                    <input type="file" ref={fileInputRef} onChange={handleForegroundUpload} className="hidden" accept="image/*" />
                    <input type="file" ref={bgInputRef} onChange={handleBackgroundUpload} className="hidden" accept="image/*" />
                </div>
                <div className="relative">
                    <input 
                    type="text" 
                    className="w-full bg-gray-900 border border-gray-700 rounded pl-2 pr-8 py-2 text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                    placeholder="Generate AI Background..."
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleGenerateBackground()}
                    />
                    <button 
                    onClick={handleGenerateBackground}
                    disabled={!aiPrompt || status === ProcessingStatus.GENERATING_BG}
                    className="absolute right-1 top-1 p-1 text-blue-400 hover:text-white disabled:opacity-50"
                    >
                    {status === ProcessingStatus.GENERATING_BG ? (
                        <svg className="animate-spin h-4 w-4 text-blue-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        '✨'
                    )}
                    </button>
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="2. Green Screen" isOpen={sections.chroma} onToggle={() => toggleSection('chroma')}>
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-gray-400">Key Color</span>
                    <input type="color" value={chromaSettings.keyColor} onChange={e => setChromaSettings({...chromaSettings, keyColor: e.target.value})} className="w-6 h-6 rounded bg-transparent cursor-pointer border-0" />
                </div>
                <SliderControl label="Threshold" value={chromaSettings.similarity} min={0} max={0.8} step={0.01} displayMultiplier={100} unit="%" onChange={v => setChromaSettings({...chromaSettings, similarity: v})} />
                <SliderControl label="Smoothness" value={chromaSettings.smoothness} min={0} max={0.5} step={0.01} displayMultiplier={100} unit="%" onChange={v => setChromaSettings({...chromaSettings, smoothness: v})} />
                <SliderControl label="Spill" value={chromaSettings.spill} min={0} max={0.5} step={0.01} displayMultiplier={100} unit="%" onChange={v => setChromaSettings({...chromaSettings, spill: v})} />
            </CollapsibleSection>

            <CollapsibleSection title="3. Adjustments" isOpen={sections.adjustments} onToggle={() => toggleSection('adjustments')} rightElement={<button onClick={resetAdjustments} className="text-xs text-blue-400 hover:text-blue-300">Reset</button>}>
                <div className="space-y-4">
                    <SliderControl label="Exposure" value={imageAdjustments.exposure} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, exposure: v}))} />
                    <SliderControl label="Brilliance" value={imageAdjustments.brilliance} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, brilliance: v}))} />
                    <SliderControl label="Highlights" value={imageAdjustments.highlights} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, highlights: v}))} />
                    <SliderControl label="Shadows" value={imageAdjustments.shadows} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, shadows: v}))} />
                    <SliderControl label="Contrast" value={imageAdjustments.contrast} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, contrast: v}))} />
                    <SliderControl label="Brightness" value={imageAdjustments.brightness} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, brightness: v}))} />
                    <SliderControl label="Black Point" value={imageAdjustments.blackPoint} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, blackPoint: v}))} />
                    <SliderControl label="Saturation" value={imageAdjustments.saturation} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, saturation: v}))} />
                    <SliderControl label="Warmth" value={imageAdjustments.warmth} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, warmth: v}))} />
                    <SliderControl label="Tint" value={imageAdjustments.tint} min={-100} max={100} onChange={v => setImageAdjustments(p => ({...p, tint: v}))} />
                    <SliderControl label="Sharpness" value={imageAdjustments.sharpness} min={0} max={100} onChange={v => setImageAdjustments(p => ({...p, sharpness: v}))} />
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="4. Geometry" isOpen={sections.geometry} onToggle={() => toggleSection('geometry')} rightElement={<button onClick={resetTransforms} className="text-xs text-blue-400 hover:text-blue-300">Reset</button>}>
                <div className="space-y-4">
                    <SliderControl label="Straighten" value={transformSettings.rotate} min={-45} max={45} step={0.5} unit="°" onChange={v => setTransformSettings(p => ({...p, rotate: v}))} />
                    <SliderControl label="Vertical" value={transformSettings.vertical} min={-100} max={100} onChange={v => setTransformSettings(p => ({...p, vertical: v}))} />
                    <SliderControl label="Horizontal" value={transformSettings.horizontal} min={-100} max={100} onChange={v => setTransformSettings(p => ({...p, horizontal: v}))} />
                    
                    <div className="pt-2 border-t border-gray-700">
                        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-bold">Subject Position</p>
                        <div className="space-y-4">
                            <SliderControl label="Zoom" value={transformSettings.scale} min={1.0} max={3.0} step={0.01} onChange={v => setTransformSettings(p => ({...p, scale: v}))} />
                            <SliderControl label="Pos X" value={transformSettings.panX} min={-100} max={100} unit="%" onChange={v => setTransformSettings(p => ({...p, panX: v}))} />
                            <SliderControl label="Pos Y" value={transformSettings.panY} min={-100} max={100} unit="%" onChange={v => setTransformSettings(p => ({...p, panY: v}))} />
                        </div>
                    </div>

                    <div className="pt-2 border-t border-gray-700">
                    <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider font-bold">Final Crop</p>
                    <Button 
                        variant={isCropping ? 'primary' : 'secondary'} 
                        className="w-full text-xs h-8" 
                        onClick={() => setIsCropping(!isCropping)}
                        >
                        {isCropping ? '✓ Finish Cropping' : '✂️ Interactive Crop'}
                    </Button>
                    </div>
                </div>
            </CollapsibleSection>

            <CollapsibleSection title="5. Export Settings" isOpen={sections.export} onToggle={() => toggleSection('export')}>
                <div className="space-y-5">
                <div className="grid grid-cols-2 gap-2 bg-gray-900 p-1 rounded-lg">
                    <button onClick={() => setExportSettings(p => ({...p, format: 'image/png'}))} className={`text-xs py-1.5 rounded-md transition ${exportSettings.format === 'image/png' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}>PNG</button>
                    <button onClick={() => setExportSettings(p => ({...p, format: 'image/jpeg'}))} className={`text-xs py-1.5 rounded-md transition ${exportSettings.format === 'image/jpeg' ? 'bg-gray-700 text-white shadow' : 'text-gray-400 hover:text-white'}`}>JPEG</button>
                </div>
                {exportSettings.format === 'image/jpeg' && (
                    <SliderControl label="Quality" value={exportSettings.quality} min={0.1} max={1.0} step={0.01} displayMultiplier={100} unit="%" onChange={v => setExportSettings(p => ({...p, quality: v}))} />
                )}
                <SliderControl label="Scale" value={exportSettings.scale} min={0.1} max={3.0} step={0.1} displayMultiplier={100} unit="%" onChange={v => setExportSettings(p => ({...p, scale: v}))} />
                
                <div>
                    <label className="text-xs text-gray-400 block mb-1">Max Size (KB)</label>
                    <input type="number" value={exportSettings.maxSizeKB || ''} onChange={e => setExportSettings(p => ({...p, maxSizeKB: e.target.value ? parseInt(e.target.value) : undefined}))} placeholder="Unlimited" className="w-full bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none" />
                </div>
                </div>
            </CollapsibleSection>

          </div>
            
          <div className="p-4 border-t border-gray-700 bg-gray-800">
                <Button variant="primary" className="w-full" onClick={handleExport} disabled={!foregroundSrc || status === ProcessingStatus.COMPRESSING} isLoading={status === ProcessingStatus.COMPRESSING}>
                    Export Image
                </Button>
                {downloadUrl && (
                    <div className="mt-3 text-center animate-fade-in">
                        <p className="text-xs text-gray-500 mb-2">Size: <span className="text-white">{downloadSize}</span></p>
                        <a href={downloadUrl} download={`chromakey-${Date.now()}.${exportSettings.format === 'image/png' ? 'png' : 'jpg'}`} className="block w-full py-2 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium transition">Download</a>
                    </div>
                )}
          </div>
        </aside>

        {/* Center Canvas Area - Now with Zoom & Scroll */}
        <div ref={mainAreaRef} className="flex-1 bg-[#0f0f0f] relative overflow-auto flex items-center justify-center p-8">
            <div className="absolute top-4 left-4 z-10 flex gap-2 pointer-events-none fixed">
                 <div className="bg-black/50 backdrop-blur px-2 py-1 rounded text-xs text-gray-400">
                    Zoom: {Math.round(viewportZoom * 100)}% (Ctrl+Scroll)
                 </div>
            </div>

            <div 
               style={{ 
                 transform: `scale(${viewportZoom})`, 
                 transformOrigin: 'center center',
                 transition: 'transform 0.1s ease-out' 
               }}
               className="relative shadow-2xl inline-block"
            >
                {!foregroundSrc && (
                    <div className="text-gray-600 flex flex-col items-center p-20 border-2 border-dashed border-gray-800 rounded-lg">
                        <span className="text-5xl mb-4 opacity-20">📸</span>
                        <p className="opacity-40">Load images to begin</p>
                    </div>
                )}
                 
                 {/* Canvas Container */}
                 <div ref={cropContainerRef} className="relative inline-block">
                   <canvas ref={canvasRef} className={`block max-w-full object-contain border border-gray-800 ${!foregroundSrc ? 'hidden' : ''}`} />
                   
                   {/* Crop Overlay */}
                   {isCropping && foregroundSrc && (
                     <>
                        <div className="absolute inset-0 bg-black/50 pointer-events-none" />
                        <div 
                           className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)] cursor-move"
                           style={{
                             left: `${transformSettings.crop.x * 100}%`,
                             top: `${transformSettings.crop.y * 100}%`,
                             width: `${transformSettings.crop.width * 100}%`,
                             height: `${transformSettings.crop.height * 100}%`
                           }}
                           onMouseDown={(e) => handleCropDrag(e, 'move')}
                        >
                           {/* Handles */}
                           {['nw', 'ne', 'sw', 'se'].map(h => (
                             <div 
                               key={h}
                               className={`absolute w-3 h-3 bg-white border border-gray-400 rounded-full cursor-${h}-resize z-10`}
                               style={{
                                 top: h.includes('n') ? '-6px' : 'auto',
                                 bottom: h.includes('s') ? '-6px' : 'auto',
                                 left: h.includes('w') ? '-6px' : 'auto',
                                 right: h.includes('e') ? '-6px' : 'auto'
                               }}
                               onMouseDown={(e) => handleCropDrag(e, h)}
                             />
                           ))}
                           
                           {/* Grid Lines (Rule of Thirds) */}
                           <div className="absolute inset-0 pointer-events-none opacity-30">
                             <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white" />
                             <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white" />
                             <div className="absolute top-1/3 left-0 right-0 h-px bg-white" />
                             <div className="absolute top-2/3 left-0 right-0 h-px bg-white" />
                           </div>
                        </div>
                     </>
                   )}
                 </div>
            </div>
        </div>

      </main>
    </div>
  );
};

export default App;
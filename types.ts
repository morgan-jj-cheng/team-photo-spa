export interface ChromaSettings {
  similarity: number;
  smoothness: number;
  spill: number;
  keyColor: string; // Hex code
}

export interface ImageAdjustments {
  exposure: number;    // -100 to 100
  brilliance: number;  // -100 to 100
  highlights: number;  // -100 to 100
  shadows: number;     // -100 to 100
  contrast: number;    // -100 to 100
  brightness: number;  // -100 to 100
  blackPoint: number;  // -100 to 100
  saturation: number;  // -100 to 100
  warmth: number;      // -100 to 100
  tint: number;        // -100 to 100
  sharpness: number;   // 0 to 100
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformSettings {
  rotate: number;      // -45 to 45 degrees
  vertical: number;    // -100 to 100 (Perspective Tilt X)
  horizontal: number;  // -100 to 100 (Perspective Pan Y)
  scale: number;       // 1.0 to 3.0 (Crop/Zoom)
  panX: number;        // -100 to 100 (% of width)
  panY: number;        // -100 to 100 (% of height)
  crop: CropRect;      // Normalized 0-1
}

export interface ExportSettings {
  format: 'image/png' | 'image/jpeg';
  quality: number; // 0 to 1
  maxSizeKB?: number;
  scale: number; // 0.1 to 3.0
}

export enum ProcessingStatus {
  IDLE = 'IDLE',
  PROCESSING = 'PROCESSING',
  COMPRESSING = 'COMPRESSING',
  GENERATING_BG = 'GENERATING_BG',
  DONE = 'DONE',
  ERROR = 'ERROR'
}
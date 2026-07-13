export const IMAGE_UPLOAD_COMPRESSION_THRESHOLD_BYTES = 600 * 1024;
export const IMAGE_UPLOAD_COMPRESSION_MAX_BYTES = IMAGE_UPLOAD_COMPRESSION_THRESHOLD_BYTES;
export const IMAGE_UPLOAD_COMPRESSION_MAX_EDGE_PX = 2048;

const SAFE_COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const LOSSY_COMPRESSIBLE_TYPES = new Set(['image/jpeg', 'image/webp']);
const MAX_EDGE_CANDIDATES = [2048, 1600, 1280];
const LOSSY_QUALITY_CANDIDATES = [0.82, 0.74, 0.66];

export type ImageUploadCompressionSkipReason =
  | 'below_threshold'
  | 'unsupported_type'
  | 'decode_failed'
  | 'encode_failed'
  | 'not_smaller';

export interface ImageUploadCompressionResult {
  file: File;
  originalSize: number;
  finalSize: number;
  compressed: boolean;
  skippedReason?: ImageUploadCompressionSkipReason;
}

interface ImageUploadCompressionOptions {
  thresholdBytes?: number;
  targetBytes?: number;
  maxEdgePx?: number;
}

type DecodedImage = (ImageBitmap | HTMLImageElement) & { close?: () => void };

function canvasOutputType(inputType: string): string {
  if (inputType === 'image/webp') return 'image/webp';
  if (inputType === 'image/png') return 'image/png';
  return 'image/jpeg';
}

function dimensionsOf(image: DecodedImage): { width: number; height: number } {
  return {
    width: 'naturalWidth' in image ? image.naturalWidth : image.width,
    height: 'naturalHeight' in image ? image.naturalHeight : image.height,
  };
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(file);
  }

  if (typeof Image !== 'function' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('image decode unavailable');
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('image decode failed'));
    };
    image.src = url;
  });
}

function drawScaled(image: DecodedImage, maxEdgePx: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;

  const { width, height } = dimensionsOf(image);
  if (!width || !height) return null;

  const scale = Math.min(1, maxEdgePx / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  if (typeof canvas.toBlob !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function buildCompressedFile(source: File, blob: Blob, type: string): File {
  const file = new File([blob], source.name, {
    type: blob.type || type || source.type,
    lastModified: source.lastModified,
  });
  if (typeof file.arrayBuffer !== 'function') {
    Object.defineProperty(file, 'arrayBuffer', {
      value: () => {
        if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer();
        if (typeof Response === 'function') return new Response(blob).arrayBuffer();
        return Promise.reject(new Error('arrayBuffer unavailable'));
      },
    });
  }
  return file;
}

/**
 * Prepare an admin-uploaded image for the Facebook publish media pool.
 *
 * The function is deliberately conservative:
 * - <= 600KB files are returned unchanged.
 * - GIFs are returned unchanged to avoid silently dropping animation frames.
 * - Any decode/encode failure returns the original file.
 * - A compressed candidate is used only when it is smaller than the original.
 * - Drawing always uses the full source image with proportional scaling, never crop/pad/stretch.
 */
export async function prepareImageForUpload(
  file: File,
  options: ImageUploadCompressionOptions = {},
): Promise<ImageUploadCompressionResult> {
  const thresholdBytes = options.thresholdBytes ?? IMAGE_UPLOAD_COMPRESSION_THRESHOLD_BYTES;
  const targetBytes = options.targetBytes ?? IMAGE_UPLOAD_COMPRESSION_MAX_BYTES;
  const maxEdgePx = options.maxEdgePx ?? IMAGE_UPLOAD_COMPRESSION_MAX_EDGE_PX;

  if (file.size <= thresholdBytes) {
    return {
      file,
      originalSize: file.size,
      finalSize: file.size,
      compressed: false,
      skippedReason: 'below_threshold',
    };
  }

  if (!SAFE_COMPRESSIBLE_TYPES.has(file.type)) {
    return {
      file,
      originalSize: file.size,
      finalSize: file.size,
      compressed: false,
      skippedReason: 'unsupported_type',
    };
  }

  let image: DecodedImage;
  try {
    image = await decodeImage(file);
  } catch {
    return {
      file,
      originalSize: file.size,
      finalSize: file.size,
      compressed: false,
      skippedReason: 'decode_failed',
    };
  }

  const outputType = canvasOutputType(file.type);
  const lossy = LOSSY_COMPRESSIBLE_TYPES.has(outputType);
  const edgeCandidates = [maxEdgePx, ...MAX_EDGE_CANDIDATES.filter((edge) => edge !== maxEdgePx)];
  const qualityCandidates = lossy ? LOSSY_QUALITY_CANDIDATES : [undefined];
  let bestBlob: Blob | null = null;
  let encodedAnyCandidate = false;

  try {
    for (const edge of edgeCandidates) {
      const canvas = drawScaled(image, edge);
      if (!canvas) continue;

      for (const quality of qualityCandidates) {
        const blob = await encodeCanvas(canvas, outputType, quality);
        if (!blob) continue;
        encodedAnyCandidate = true;
        if (blob.size < file.size && (!bestBlob || blob.size < bestBlob.size)) {
          bestBlob = blob;
        }
        if (blob.size > 0 && blob.size <= targetBytes && blob.size < file.size) {
          const compressed = buildCompressedFile(file, blob, outputType);
          return {
            file: compressed,
            originalSize: file.size,
            finalSize: compressed.size,
            compressed: true,
          };
        }
      }
    }
  } finally {
    image.close?.();
  }

  if (!bestBlob) {
    return {
      file,
      originalSize: file.size,
      finalSize: file.size,
      compressed: false,
      skippedReason: encodedAnyCandidate ? 'not_smaller' : 'encode_failed',
    };
  }

  if (bestBlob.size >= file.size) {
    return {
      file,
      originalSize: file.size,
      finalSize: file.size,
      compressed: false,
      skippedReason: 'not_smaller',
    };
  }

  const compressed = buildCompressedFile(file, bestBlob, outputType);
  return {
    file: compressed,
    originalSize: file.size,
    finalSize: compressed.size,
    compressed: true,
  };
}

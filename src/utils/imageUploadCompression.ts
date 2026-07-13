export const IMAGE_UPLOAD_COMPRESSION_TARGET_BYTES = 600 * 1024;
export const IMAGE_UPLOAD_COMPRESSION_MAX_EDGE_PX = 2048;

const OUTPUT_TYPE = 'image/jpeg';
const MAX_EDGE_CANDIDATES = [2048, 1600, 1280];
const JPEG_QUALITY_CANDIDATES = [0.82, 0.74, 0.66, 0.58];

export type ImageUploadCompressionRejectReason =
  | 'unsupported_type'
  | 'decode_failed'
  | 'encode_failed'
  | 'not_smaller';

export type ImageUploadCompressionResult =
  | {
      ok: true;
      file: File;
      originalName: string;
      originalSize: number;
      finalSize: number;
      outputType: 'image/jpeg';
      compressed: true;
    }
  | {
      ok: false;
      originalName: string;
      originalSize: number;
      reason: ImageUploadCompressionRejectReason;
    };

interface ImageUploadCompressionSuccess {
  ok: true;
  file: File;
  originalName: string;
  originalSize: number;
  finalSize: number;
  outputType: 'image/jpeg';
  compressed: true;
}

interface ImageUploadCompressionOptions {
  targetBytes?: number;
  maxEdgePx?: number;
}

type DecodedImage = (ImageBitmap | HTMLImageElement) & { close?: () => void };

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
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function encodeCanvas(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  if (typeof canvas.toBlob !== 'function') return Promise.resolve(null);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

function jpegFilename(filename: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return 'image.jpg';
  const withoutExtension = trimmed.replace(/\.[^.\\/]+$/, '');
  return `${withoutExtension || 'image'}.jpg`;
}

function buildCompressedFile(source: File, blob: Blob): File {
  const file = new File([blob], jpegFilename(source.name), {
    type: OUTPUT_TYPE,
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

function reject(file: File, reason: ImageUploadCompressionRejectReason): ImageUploadCompressionResult {
  return {
    ok: false,
    originalName: file.name,
    originalSize: file.size,
    reason,
  };
}

function success(file: File, compressed: File, originalSize: number): ImageUploadCompressionSuccess {
  return {
    ok: true,
    file: compressed,
    originalName: file.name,
    originalSize,
    finalSize: compressed.size,
    outputType: OUTPUT_TYPE,
    compressed: true,
  };
}

/**
 * Prepare an admin-uploaded image for the Facebook publish media pool.
 *
 * The media pool is optimized for Facebook publish speed, so this function is
 * intentionally strict:
 * - every accepted image must be decoded and re-encoded as JPEG;
 * - transparent pixels are flattened on a white background;
 * - decode/encode/no-smaller-candidate failures are rejected instead of uploading originals;
 * - Drawing always uses the full source image with proportional scaling, never crop/pad/stretch.
 */
export async function prepareImageForUpload(
  file: File,
  options: ImageUploadCompressionOptions = {},
): Promise<ImageUploadCompressionResult> {
  const targetBytes = options.targetBytes ?? IMAGE_UPLOAD_COMPRESSION_TARGET_BYTES;
  const maxEdgePx = options.maxEdgePx ?? IMAGE_UPLOAD_COMPRESSION_MAX_EDGE_PX;

  if (!file.type.startsWith('image/')) {
    return reject(file, 'unsupported_type');
  }

  let image: DecodedImage;
  try {
    image = await decodeImage(file);
  } catch {
    return reject(file, 'decode_failed');
  }

  const edgeCandidates = [maxEdgePx, ...MAX_EDGE_CANDIDATES.filter((edge) => edge !== maxEdgePx)];
  let bestBlob: Blob | null = null;
  let encodedAnyCandidate = false;

  try {
    for (const edge of edgeCandidates) {
      const canvas = drawScaled(image, edge);
      if (!canvas) continue;

      for (const quality of JPEG_QUALITY_CANDIDATES) {
        const blob = await encodeCanvas(canvas, OUTPUT_TYPE, quality);
        if (!blob) continue;
        encodedAnyCandidate = true;
        if (blob.size < file.size && (!bestBlob || blob.size < bestBlob.size)) {
          bestBlob = blob;
        }
        if (blob.size > 0 && blob.size <= targetBytes && blob.size < file.size) {
          return success(file, buildCompressedFile(file, blob), file.size);
        }
      }
    }
  } finally {
    image.close?.();
  }

  if (!bestBlob) {
    return reject(file, encodedAnyCandidate ? 'not_smaller' : 'encode_failed');
  }

  if (bestBlob.size >= file.size) {
    return reject(file, 'not_smaller');
  }

  return success(file, buildCompressedFile(file, bestBlob), file.size);
}

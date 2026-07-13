import { afterEach, describe, expect, it, vi } from 'vitest';
import { IMAGE_UPLOAD_COMPRESSION_THRESHOLD_BYTES, prepareImageForUpload } from './imageUploadCompression';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function fileOfSize(size: number, name: string, type: string): File {
  return new File([new Uint8Array(size)], name, { type, lastModified: 123 });
}

function mockCanvas(blobBytes: Uint8Array, type = 'image/jpeg') {
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 3024, height: 4032, close: vi.fn() })),
  );
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(callback, requestedType) {
    const bytes = blobBytes.buffer.slice(blobBytes.byteOffset, blobBytes.byteOffset + blobBytes.byteLength) as ArrayBuffer;
    const blob = new Blob([bytes], { type: requestedType || type });
    Object.defineProperty(blob, 'arrayBuffer', { value: () => Promise.resolve(bytes.slice(0)) });
    callback(blob);
  });
  return { drawImage };
}

describe('prepareImageForUpload', () => {
  it('skips files at or below the 600KB threshold', async () => {
    const file = fileOfSize(IMAGE_UPLOAD_COMPRESSION_THRESHOLD_BYTES, 'small.jpg', 'image/jpeg');

    const result = await prepareImageForUpload(file);

    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
    expect(result.skippedReason).toBe('below_threshold');
  });

  it('compresses large JPEG files without changing the filename or MIME type', async () => {
    const compressedBytes = new Uint8Array([1, 2, 3, 4]);
    const { drawImage } = mockCanvas(compressedBytes, 'image/jpeg');
    const file = fileOfSize(800 * 1024, 'large.jpg', 'image/jpeg');

    const result = await prepareImageForUpload(file);

    expect(drawImage).toHaveBeenCalled();
    expect(result.compressed).toBe(true);
    expect(result.file).not.toBe(file);
    expect(result.file.name).toBe('large.jpg');
    expect(result.file.type).toBe('image/jpeg');
    expect(result.finalSize).toBe(compressedBytes.length);
    await expect(result.file.arrayBuffer()).resolves.toEqual(compressedBytes.buffer);
  });

  it('keeps GIF files unchanged to avoid dropping animation frames', async () => {
    const file = fileOfSize(800 * 1024, 'animated.gif', 'image/gif');

    const result = await prepareImageForUpload(file);

    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
    expect(result.skippedReason).toBe('unsupported_type');
  });

  it('falls back to the original file when compression cannot produce a smaller result', async () => {
    mockCanvas(new Uint8Array(900 * 1024), 'image/jpeg');
    const file = fileOfSize(800 * 1024, 'large.jpg', 'image/jpeg');

    const result = await prepareImageForUpload(file);

    expect(result.file).toBe(file);
    expect(result.compressed).toBe(false);
    expect(result.skippedReason).toBe('not_smaller');
  });
});

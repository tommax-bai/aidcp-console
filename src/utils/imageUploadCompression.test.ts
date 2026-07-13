import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareImageForUpload } from './imageUploadCompression';

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
  const fillRect = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage,
    fillRect,
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function toBlob(callback, requestedType) {
    const bytes = blobBytes.buffer.slice(blobBytes.byteOffset, blobBytes.byteOffset + blobBytes.byteLength) as ArrayBuffer;
    const blob = new Blob([bytes], { type: requestedType || type });
    Object.defineProperty(blob, 'arrayBuffer', { value: () => Promise.resolve(bytes.slice(0)) });
    callback(blob);
  });
  return { drawImage, fillRect };
}

describe('prepareImageForUpload', () => {
  it('converts small PNG files to compressed JPEG instead of uploading the original format', async () => {
    const compressedBytes = new Uint8Array([1, 2, 3, 4]);
    mockCanvas(compressedBytes, 'image/jpeg');
    const file = fileOfSize(100 * 1024, 'small.png', 'image/png');

    const result = await prepareImageForUpload(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.file).not.toBe(file);
    expect(result.file.name).toBe('small.jpg');
    expect(result.file.type).toBe('image/jpeg');
    expect(result.finalSize).toBe(compressedBytes.length);
  });

  it('compresses large JPEG files without changing the full image bounds', async () => {
    const compressedBytes = new Uint8Array([1, 2, 3, 4]);
    const { drawImage, fillRect } = mockCanvas(compressedBytes, 'image/jpeg');
    const file = fileOfSize(800 * 1024, 'large.jpg', 'image/jpeg');

    const result = await prepareImageForUpload(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(fillRect).toHaveBeenCalled();
    expect(drawImage).toHaveBeenCalled();
    expect(result.compressed).toBe(true);
    expect(result.file).not.toBe(file);
    expect(result.file.name).toBe('large.jpg');
    expect(result.file.type).toBe('image/jpeg');
    expect(result.finalSize).toBe(compressedBytes.length);
    await expect(result.file.arrayBuffer()).resolves.toEqual(compressedBytes.buffer);
  });

  it('converts GIF files to static JPEG when the browser can decode them', async () => {
    mockCanvas(new Uint8Array([5, 6, 7]), 'image/jpeg');
    const file = fileOfSize(800 * 1024, 'animated.gif', 'image/gif');

    const result = await prepareImageForUpload(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected success');
    expect(result.file.name).toBe('animated.jpg');
    expect(result.file.type).toBe('image/jpeg');
  });

  it('rejects files when JPEG compression cannot produce a smaller result', async () => {
    mockCanvas(new Uint8Array(900 * 1024), 'image/jpeg');
    const file = fileOfSize(800 * 1024, 'large.jpg', 'image/jpeg');

    const result = await prepareImageForUpload(file);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.reason).toBe('not_smaller');
  });

  it('rejects files when the browser cannot decode them', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => {
      throw new Error('decode failed');
    }));
    const file = fileOfSize(800 * 1024, 'bad.png', 'image/png');

    const result = await prepareImageForUpload(file);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected rejection');
    expect(result.reason).toBe('decode_failed');
  });
});

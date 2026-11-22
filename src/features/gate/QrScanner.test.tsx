// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import QRCode from 'qrcode';
import { QrScanner } from './QrScanner';
import { CAMERA_MESSAGES } from '@/services/gateCore';

vi.mock('jsqr', () => ({ default: vi.fn() }));

const PAYLOAD = 'AXLEOPS-FLEET:org-ja:mc-5:J105';

function makeStream() {
  const listeners: Record<string, Array<() => void>> = {};
  const track = {
    stop: vi.fn(),
    addEventListener: vi.fn((ev: string, fn: () => void) => {
      (listeners[ev] ??= []).push(fn);
    }),
  };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track, fire: (ev: string) => listeners[ev]?.forEach((f) => f()) };
}

function setSecure(value: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value, configurable: true });
}

function setGetUserMedia(fn: unknown) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: fn === undefined ? undefined : { getUserMedia: fn },
    configurable: true,
  });
}

async function flush(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe('QrScanner', () => {
  let jsqrMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.useFakeTimers();
    setSecure(true);
    Object.defineProperty(HTMLMediaElement.prototype, 'readyState', { get: () => 4, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { get: () => 8, configurable: true });
    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { get: () => 8, configurable: true });
    HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({ data: new Uint8ClampedArray(8 * 8 * 4), width: 8, height: 8 })),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    jsqrMock = (await import('jsqr')).default as unknown as ReturnType<typeof vi.fn>;
    jsqrMock.mockReset();
    jsqrMock.mockReturnValue(null);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('requests the rear camera and shows the preview and hint', async () => {
    const { stream } = makeStream();
    const gum = vi.fn().mockResolvedValue(stream);
    setGetUserMedia(gum);
    render(<QrScanner active onDecode={vi.fn()} />);
    await flush();
    expect(gum).toHaveBeenCalledWith({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const video = screen.getByTestId('qr-video') as HTMLVideoElement;
    expect(video.srcObject).toBe(stream);
    expect(video.muted).toBe(true);
    expect(screen.getByText('Point the camera at the QR code on the Collection Note')).toBeTruthy();
  });

  it('decodes within 250 ms, calls onDecode once with unmodified text and stops tracks', async () => {
    const { stream, track } = makeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const text = '  AXLEOPS-FLEET:org-ja:mc-5:J105\n';
    jsqrMock.mockReturnValue({ data: text });
    const onDecode = vi.fn();
    render(<QrScanner active onDecode={onDecode} />);
    await flush(250);
    expect(onDecode).toHaveBeenCalledTimes(1);
    expect(onDecode).toHaveBeenCalledWith(text);
    expect(track.stop).toHaveBeenCalled();
    expect((screen.getByTestId('qr-video') as HTMLVideoElement).srcObject).toBeNull();
    await flush(1000);
    expect(onDecode).toHaveBeenCalledTimes(1);
  });

  it('keeps scanning while no code is found', async () => {
    const { stream, track } = makeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const onDecode = vi.fn();
    render(<QrScanner active onDecode={onDecode} />);
    await flush(1000);
    expect(jsqrMock.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(onDecode).not.toHaveBeenCalled();
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('stops tracks on unmount and delivers nothing afterwards', async () => {
    const { stream, track } = makeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const onDecode = vi.fn();
    const { unmount } = render(<QrScanner active onDecode={onDecode} />);
    await flush();
    unmount();
    expect(track.stop).toHaveBeenCalled();
    jsqrMock.mockReturnValue({ data: 'x' });
    await flush(1000);
    expect(onDecode).not.toHaveBeenCalled();
  });

  it('stops tracks when active becomes false', async () => {
    const { stream, track } = makeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const onDecode = vi.fn();
    const { rerender } = render(<QrScanner active onDecode={onDecode} />);
    await flush();
    rerender(<QrScanner active={false} onDecode={onDecode} />);
    expect(track.stop).toHaveBeenCalled();
    jsqrMock.mockReturnValue({ data: 'x' });
    await flush(1000);
    expect(onDecode).not.toHaveBeenCalled();
  });

  it('stops tracks immediately when getUserMedia resolves after unmount', async () => {
    const { stream, track } = makeStream();
    let resolve!: (s: MediaStream) => void;
    setGetUserMedia(vi.fn(() => new Promise<MediaStream>((r) => (resolve = r))));
    const { unmount } = render(<QrScanner active onDecode={vi.fn()} />);
    unmount();
    resolve(stream);
    await flush();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('reports OTHER when a track ends after start', async () => {
    const { stream, fire } = makeStream();
    setGetUserMedia(vi.fn().mockResolvedValue(stream));
    const onError = vi.fn();
    render(<QrScanner active onDecode={vi.fn()} onError={onError} />);
    await flush();
    act(() => fire('ended'));
    expect(onError).toHaveBeenCalledWith('OTHER');
    expect(screen.getByRole('alert').textContent).toBe(CAMERA_MESSAGES.OTHER);
  });

  describe('camera errors', () => {
    const cases: Array<[string, string, keyof typeof CAMERA_MESSAGES]> = [
      ['NotAllowedError', 'NotAllowedError', 'DENIED'],
      ['SecurityError', 'SecurityError', 'DENIED'],
      ['NotFoundError', 'NotFoundError', 'NOT_FOUND'],
      ['OverconstrainedError', 'OverconstrainedError', 'NOT_FOUND'],
      ['other name', 'AbortError', 'OTHER'],
    ];
    it.each(cases)('maps %s', async (_label, name, code) => {
      setGetUserMedia(vi.fn().mockRejectedValue({ name }));
      const onError = vi.fn();
      render(<QrScanner active onDecode={vi.fn()} onError={onError} />);
      await flush();
      expect(onError).toHaveBeenCalledWith(code);
      expect(screen.getByRole('alert').textContent).toBe(CAMERA_MESSAGES[code]);
    });

    it('insecure context wins and never calls getUserMedia', async () => {
      setSecure(false);
      const gum = vi.fn();
      setGetUserMedia(gum);
      const onError = vi.fn();
      render(<QrScanner active onDecode={vi.fn()} onError={onError} />);
      await flush();
      expect(gum).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith('INSECURE');
      expect(screen.getByRole('alert').textContent).toBe(CAMERA_MESSAGES.INSECURE);
    });

    it('insecure wins over missing getUserMedia', async () => {
      setSecure(false);
      setGetUserMedia(undefined);
      const onError = vi.fn();
      render(<QrScanner active onDecode={vi.fn()} onError={onError} />);
      await flush();
      expect(onError).toHaveBeenCalledWith('INSECURE');
    });

    it('missing getUserMedia in a secure context is UNSUPPORTED', async () => {
      setGetUserMedia(undefined);
      const onError = vi.fn();
      render(<QrScanner active onDecode={vi.fn()} onError={onError} />);
      await flush();
      expect(onError).toHaveBeenCalledWith('UNSUPPORTED');
      expect(screen.getByRole('alert').textContent).toBe(CAMERA_MESSAGES.UNSUPPORTED);
    });
  });
});

describe('jsqr smoke test', () => {
  it('decodes a QR image generated with qrcode to the exact payload', async () => {
    const jsQR = (await vi.importActual<typeof import('jsqr')>('jsqr')).default;
    const qr = QRCode.create(PAYLOAD, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;
    const data = qr.modules.data as unknown as ArrayLike<number>;
    const scale = 4;
    const quiet = 4;
    const dim = (size + quiet * 2) * scale;
    const rgba = new Uint8ClampedArray(dim * dim * 4).fill(255);
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const col = Math.floor(x / scale) - quiet;
        const row = Math.floor(y / scale) - quiet;
        if (col >= 0 && row >= 0 && col < size && row < size && data[row * size + col]) {
          const i = (y * dim + x) * 4;
          rgba[i] = 0;
          rgba[i + 1] = 0;
          rgba[i + 2] = 0;
        }
      }
    }
    const result = jsQR(rgba, dim, dim);
    expect(result?.data).toBe(PAYLOAD);
  });
});

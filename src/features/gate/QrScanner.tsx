import { useEffect, useRef, useState } from 'react';
import { CAMERA_MESSAGES, mapCameraError, type CameraErrorCode } from '@/services/gateCore';

export interface QrScannerProps {
  /** false stops the camera. */
  active: boolean;
  /** Called at most once per start, with the unmodified decoded text. */
  onDecode: (text: string) => void;
  onError?: (code: CameraErrorCode) => void;
}

const TICK_MS = 200;

type JsQr = (
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options?: { inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst' },
) => { data: string } | null;

export function QrScanner({ active, onDecode, onError }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onDecodeRef = useRef(onDecode);
  const onErrorRef = useRef(onError);
  const [errorCode, setErrorCode] = useState<CameraErrorCode | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    onDecodeRef.current = onDecode;
    onErrorRef.current = onError;
  });

  useEffect(() => {
    if (!active) return;

    let cancelled = false;
    let done = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let stream: MediaStream | null = null;

    const release = () => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const fail = (code: CameraErrorCode) => {
      if (cancelled || done) return;
      release();
      setReady(false);
      setErrorCode(code);
      onErrorRef.current?.(code);
    };

    setErrorCode(null);
    setReady(false);

    const isSecure = typeof window !== 'undefined' && window.isSecureContext;
    const hasGetUserMedia = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

    if (!isSecure || !hasGetUserMedia) {
      fail(mapCameraError({ isSecureContext: isSecure, hasGetUserMedia }));
      return () => {
        cancelled = true;
      };
    }

    const start = async () => {
      let s: MediaStream;
      try {
        s = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch (err) {
        fail(mapCameraError({ isSecureContext: true, hasGetUserMedia: true }, err as { name?: string }));
        return;
      }
      if (cancelled) {
        s.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = s;
      s.getTracks().forEach((t) => t.addEventListener('ended', () => fail('OTHER')));

      const video = videoRef.current;
      if (video) {
        video.srcObject = s;
        void video.play?.()?.catch?.(() => undefined);
      }
      setReady(true);

      let jsQR: JsQr;
      try {
        jsQR = (await import('jsqr')).default as unknown as JsQr;
      } catch {
        fail('OTHER');
        return;
      }
      if (cancelled || done) return;

      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });

      const tick = () => {
        const v = videoRef.current;
        if (done || cancelled || !v || !ctx || v.readyState < 2) return;
        const w = v.videoWidth;
        const h = v.videoHeight;
        if (!w || !h) return;
        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(v, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const result = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (!result) return;
        done = true;
        release();
        onDecodeRef.current(result.data);
      };
      timer = setInterval(tick, TICK_MS);
    };

    void start();

    return () => {
      cancelled = true;
      done = true;
      release();
    };
  }, [active]);

  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-lg border bg-black aspect-video">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          data-testid="qr-video"
          className="h-full w-full object-cover"
        />
        {!ready && !errorCode && active && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">
            Starting camera…
          </div>
        )}
      </div>
      {errorCode ? (
        <p role="alert" className="text-sm text-destructive">
          {CAMERA_MESSAGES[errorCode]}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">Point the camera at the QR code on the Collection Note</p>
      )}
    </div>
  );
}

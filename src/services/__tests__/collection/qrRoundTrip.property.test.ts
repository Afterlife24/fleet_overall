import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  buildQrPayload,
  parseQrPayload,
  resolveQr,
  fleetNumberOf,
  QR_PREFIX,
  type MachineLite,
} from '@/services/collectionCore';

// Ids and org ids never contain ':' (the payload separator).
const token = fc.stringMatching(/^[A-Za-z0-9_-]{1,24}$/);
// Fleet numbers: printable ASCII with at least one non-space char; may contain ':'.
const fleetNo = fc
  .stringMatching(/^[ -~]{1,24}$/)
  .filter((s) => s.trim() !== '');

const machineArb: fc.Arbitrary<MachineLite> = fc
  .record({
    id: token,
    orgId: token,
    fleetNo,
    assetNumber: fc.stringMatching(/^[A-Za-z0-9-]{1,12}$/),
  })
  .map((m) => ({ ...m }));

function renderQr(payload: string): { data: Uint8ClampedArray; size: number } {
  const modules = QRCode.create(payload, { errorCorrectionLevel: 'M' }).modules;
  const n = modules.size;
  const quiet = 4;
  const scale = 4;
  const size = (n + quiet * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!modules.get(y, x)) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (x + quiet) * scale + dx;
          const py = (y + quiet) * scale + dy;
          const i = (py * size + px) * 4;
          data[i] = 0;
          data[i + 1] = 0;
          data[i + 2] = 0;
        }
      }
    }
  }
  return { data, size };
}

describe('Property 3: QR payload round trip', () => {
  // Feature: offhire-collection-docs, Property 3: QR payload round trip
  // **Validates: Requirements 5.1, 5.2, 7.5**
  it('parseQrPayload(buildQrPayload(m)) returns org, id and fleet number', () => {
    fc.assert(
      fc.property(machineArb, (m) => {
        const payload = buildQrPayload(m);
        expect(payload.startsWith(`${QR_PREFIX}:`)).toBe(true);
        expect(payload.startsWith('AXLEOPS-FLEET:')).toBe(true);
        expect(parseQrPayload(payload)).toEqual({
          orgId: m.orgId,
          machineId: m.id,
          fleetNo: fleetNumberOf(m),
        });
      }),
      { numRuns: 200 },
    );
  });

  // Feature: offhire-collection-docs, Property 3: QR payload round trip
  // **Validates: Requirements 5.1, 5.2, 7.5**
  // 100 runs: encode + decode of a pixel bitmap is fast enough at this size.
  it('QR bitmap rendered with qrcode decodes with jsqr to the identical payload and resolves', () => {
    fc.assert(
      fc.property(machineArb, (m) => {
        const payload = buildQrPayload(m);
        const { data, size } = renderQr(payload);
        const decoded = jsQR(data, size, size);
        expect(decoded).not.toBeNull();
        expect(decoded!.data).toBe(payload);
        const res = resolveQr(decoded!.data, m.orgId, [m]);
        expect(res).toEqual({ ok: true, machine: m });
      }),
      { numRuns: 100 },
    );
  });
});

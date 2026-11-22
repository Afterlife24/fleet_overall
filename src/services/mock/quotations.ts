import type { Quotation, QuotationPhase, PhaseHistoryEntry } from '@/types/quotation';
import { JA_ORG_ID } from '@/store/authStore';

const day = (n: number) => new Date(Date.UTC(2026, 10, n, 9, 0, 0)).toISOString();

function make(
  n: number, opportunity: string, hireAgreementNo: string, customerName: string, email: string | undefined,
  amount: number, path: QuotationPhase[], lostReason?: string,
): Quotation {
  const salesRep = 'Administrator';
  const history: PhaseHistoryEntry[] = [];
  let prev: QuotationPhase | null = null;
  path.forEach((p, i) => {
    history.push({
      id: `seed-${n}-${i}`, timestamp: day(1 + i + (n % 5)), user: salesRep,
      fromPhase: prev, toPhase: p,
      ...(p === 'Lost' && lostReason ? { reason: lostReason } : {}),
    });
    prev = p;
  });
  const phase = path[path.length - 1];
  const last = history[history.length - 1];
  return {
    id: `qt-seed-${n}`, orgId: JA_ORG_ID,
    number: `QT-2026-${String(n).padStart(4, '0')}`,
    opportunity, hireAgreementNo, email,
    customerId: `CUS-${hireAgreementNo.slice(-4)}`, customerName, amount, currency: 'AED',
    phase, salesRep,
    ...(phase === 'Lost' ? { lostReason, lostAt: last.timestamp, lostBy: salesRep } : {}),
    createdAt: history[0].timestamp, updatedAt: last.timestamp, history,
  };
}

export const seedQuotations: Quotation[] = [
  make(1, "Administrator's opportunity", 'HA-2026-00001', 'Administrator', 'koushikvarmasagi2004@gmail.com', 20000, ['Awaiting', 'Tender', 'Won']),
  make(2, "CK Groups's opportunity", 'HA-2026-00004', 'CK Groups', 'ck3967@gmail.com', 200000, ['Awaiting', 'Tender']),
  make(3, "ABC Company's opportunity", 'HA-2026-00005', 'ABC Company', 'abcgroups@gmail.com', 2500, ['Awaiting']),
  make(4, 'DEF Company - Scissor Lift Hire', 'HA-2026-00007', 'DEF Company LLC', undefined, 5500, ['Awaiting', 'Tender']),
  make(5, 'ABC Company - Boom Lift Hire', 'HA-2026-00005', 'ABC Company', 'abcgroups@gmail.com', 8000, ['Awaiting', 'Tender', 'Won']),
  make(6, 'Damac Properties - Telehandler Hire', 'HA-2026-00008', 'Damac Properties', undefined, 54800, ['Awaiting', 'Tender', 'Lost'], 'Competitor chosen'),
  make(7, 'Arabtec - Scissor Lift Hire', 'HA-2026-00009', 'Arabtec Contracting', undefined, 22400, ['Awaiting', 'Lost'], 'Price too high'),
  // Quotations of the demo hire agreements (HA-2026-003 to 005), see demoHireLink.ts
  make(8, 'GHI Company - Articulating Boom Lift', 'HA-2026-00010', 'GHI Company PJSC', 'ghi@example.com', 14200, ['Awaiting']),
  make(9, 'JKL Company - Rough Terrain Scissor Lift', 'HA-2026-00011', 'JKL Company LLC', 'jkl@example.com', 16800, ['Awaiting', 'Tender', 'Lost'], 'Project cancelled'),
  make(10, 'MNO Company - Telescopic Boom Lift', 'HA-2026-00012', 'MNO Company LLC', 'mno@example.com', 27300, ['Awaiting', 'Tender', 'Won']),
];
import type { CustomerANI, CustomerANIStatus } from '@/types/customerani';
import { randInt, pick } from './_gen';

const COMPANIES = [
  'Al Futtaim Engineering', 'Arabtec Construction LLC', 'Nakheel Properties',
  'Emaar Developments', 'Al Naboodah Group', 'Aldar Properties PJSC',
  'CCC Consolidated Contractors', 'Hyundai Engineering & Construction',
  'Samsung C&T Middle East', 'Larsen & Toubro Gulf',
  'Drake & Scull International', 'Dutco Balfour Beatty',
  'Shapoorji Pallonji & Co', 'Al Habtoor Engineering', 'Bin Ladin Group ME',
  'Multiplex Construction Gulf', 'Interserve Construction UAE',
  'Wates Group MENA', 'Atkins Middle East', 'AECOM Gulf',
];

const ATTN_NAMES = [
  'Mr. Ahmed Khan', 'Ms. Sara Ali', 'Mr. John Smith', 'Ms. Priya Nair',
  'Mr. Mohammed Al Rashid', 'Ms. Fatima Al Zaabi', 'Mr. David Chen',
  'Ms. Aisha Al Mansoori', 'Mr. Raj Sharma', 'Ms. Leila Hassan',
];

const BRANCHES = ['Dubai HQ', 'Abu Dhabi', 'Sharjah', 'Al Ain', 'Riyadh', 'Jeddah'];
const STATUSES: CustomerANIStatus[] = ['Active', 'Active', 'Active', 'Inactive', 'Suspended'];

function padId(n: number): string {
  return `FL-${String(n).padStart(5, '0')}`;
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

function makeCustomerANI(index: number): CustomerANI {
  const name = COMPANIES[index % COMPANIES.length];
  const branch = pick(BRANCHES);
  const status = STATUSES[index % STATUSES.length];
  const aniActive = status === 'Active';
  const shortCode = name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 4);
  const country = index % 4 === 0 ? 'KSA' : 'UAE';
  const countryCode = country === 'KSA' ? '966' : '971';
  const city = pick(['Dubai', 'Abu Dhabi', 'Riyadh', 'Jeddah', 'Sharjah', 'Al Ain']);
  const trn = `1${randInt(10000000, 99999999)}00003`;
  const attl = randInt(50, 950) * 1000;
  const phone = `+${countryCode} ${randInt(50, 59)} ${randInt(1000000, 9999999)}`;
  const street = pick(['Sheikh Zayed Rd', 'Al Khail Rd', 'Airport Rd', 'Corniche St', 'Business Bay Blvd']);
  const addressLine = `${randInt(1, 999)} ${street}, ${city}, ${country}`;
  const attn = pick(ATTN_NAMES);
  const firstName = attn.split(' ').slice(-1)[0].toLowerCase();
  const companySlug = name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '');
  const email = `${firstName}@${companySlug}.com`;

  return {
    id: `cani-${index + 1}`,
    fleetLogId: padId(index + 1),
    aniRavaliActive: aniActive,
    customerId: `${shortCode}-${randInt(1000, 9999)}`,
    customerName: name,
    trn,
    attn,
    address: addressLine,
    billingAddress: addressLine,
    email,
    attl,
    contactNumber: phone,
    status,
    branchName: branch,
    notes: index % 5 === 0 ? 'VIP account — requires senior account manager sign-off.' : undefined,
    createdAt: daysAgo(randInt(30, 730)),
    updatedAt: daysAgo(randInt(1, 29)),
  };
}

export const customerANIs: CustomerANI[] = Array.from({ length: 20 }, (_, i) => makeCustomerANI(i));

export function getCustomerANIById(id: string): CustomerANI | undefined {
  return customerANIs.find((c) => c.id === id);
}

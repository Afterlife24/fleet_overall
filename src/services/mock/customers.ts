import { Customer } from '@/types/customer';
import { NOW_ISO, randId, randInt, randFloat, pick, daysAgoISO } from './_gen';
import { makeEntity } from './branches';

const NAMES = [
  'Arabtec Construction LLC', 'Al Naboodah Construction', 'Bin Brook Architecture',
  'Nakheel Properties', 'Emaar Construction', 'Aldar Properties',
  'Saudi Binladin Group', 'CCC Consolidated Contractors', 'Hyundai Engineering',
  'Dragados Middle East',
];

const syntheticCustomers: Customer[] = NAMES.map((name, i) => {
  const createdAt = daysAgoISO(randInt(100, 900));
  return {
    ...makeEntity(`cu-${i + 1}`),
    name,
    contactPerson: 'Procurement Manager',
    phone: `+${pick(['971', '966'])} ${randInt(50, 99)} ${randInt(1000000, 9999999)}`,
    email: `procurement@${name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}.com`,
    city: pick(['Dubai', 'Abu Dhabi', 'Riyadh', 'Jeddah']),
    country: i % 3 === 0 ? 'KSA' : 'UAE',
    activeBookings: randInt(1, 8),
    totalRevenue: randFloat(50000, 850000, 0),
    rating: randFloat(3.5, 5, 1),
    status: i === 9 ? 'Inactive' : 'Active',
    createdAt,
    updatedAt: NOW_ISO(),
  };
});

// ═══════════════════════════════════════════════════════════════════════════════
// USE SYNTHETIC DEMO DATA (Default)
// ═══════════════════════════════════════════════════════════════════════════════

export const customers = syntheticCustomers;  // USE DEMO DATA

// To switch to real Excel data, uncomment:
// import { realCustomers } from './realData';
// export const customers = realCustomers;

export function getCustomerById(id: string): Customer | undefined {
  return customers.find((c) => c.id === id);
}

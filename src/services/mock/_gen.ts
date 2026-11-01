// Deterministic PRNG so mock data is consistent across reloads

let _seed = 4927381;

export function seedMockData(seed = 4927381) {
  _seed = seed;
}

export function rand(): number {
  _seed = (_seed * 1664525 + 1013904223) % 4294967296;
  return _seed / 4294967296;
}

export function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

export function randFloat(min: number, max: number, decimals = 2): number {
  const val = rand() * (max - min) + min;
  return parseFloat(val.toFixed(decimals));
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function pickMany<T>(arr: T[], count: number): T[] {
  const result: T[] = [];
  const pool = [...arr];
  for (let i = 0; i < Math.min(count, pool.length); i++) {
    const idx = Math.floor(rand() * pool.length);
    result.push(pool.splice(idx, 1)[0]);
  }
  return result;
}

export function randId(): string {
  return randInt(1000, 9999999).toString();
}

// Cricket player first names (used for all synthetic staff — technicians, drivers, contacts)
const FIRST_NAMES = [
  'Virat', 'Rohit', 'Steve', 'Kane', 'Joe', 'Ben', 'David', 'Pat',
  'Jos', 'Jasprit', 'James', 'Mitchell', 'Babar', 'Trent', 'Rashid',
  'Quinton', 'Shubman', 'Marnus', 'Travis', 'Glenn', 'Hardik', 'Kagiso',
  'Shaheen', 'Ravindra', 'Faf', 'Chris', 'AB', 'Brian', 'Ricky', 'Wasim',
];

const LAST_NAMES = [
  'Kohli', 'Sharma', 'Smith', 'Williamson', 'Root', 'Stokes', 'Warner',
  'Cummins', 'Buttler', 'Bumrah', 'Anderson', 'Starc', 'Azam', 'Boult',
  'Khan', 'de Kock', 'Gill', 'Labuschagne', 'Head', 'Maxwell', 'Pandya',
  'Rabada', 'Afridi', 'Jadeja', 'du Plessis', 'Gayle', 'de Villiers', 'Lara',
];

export function randName(): string {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

export function randPhone(): string {
  const c = pick(['+971', '+966']);
  const num = randInt(50, 99).toString() + randInt(1000000, 9999999).toString();
  return `${c} ${num.slice(0, 2)} ${num.slice(2, 5)} ${num.slice(5)}`;
}

export function randEmail(name: string): string {
  const domains = ['gmail.com', 'johnsonarabia.com', 'fleet.ae'];
  const handle = name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z.]/g, '') + randInt(1, 99);
  return `${handle}@${pick(domains)}`;
}

const NOW = new Date();

export function NOW_ISO(): string {
  return NOW.toISOString();
}

export const NOW_ISO_CONST = NOW.toISOString();

export function daysAgoISO(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() - days);
  d.setHours(randInt(7, 18), randInt(0, 59), 0, 0);
  return d.toISOString();
}

export function daysAheadISO(days: number): string {
  const d = new Date(NOW);
  d.setDate(d.getDate() + days);
  d.setHours(randInt(7, 18), randInt(0, 59), 0, 0);
  return d.toISOString();
}

export function hoursAgoISO(hours: number): string {
  const d = new Date(NOW);
  d.setHours(d.getHours() - hours);
  return d.toISOString();
}

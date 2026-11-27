/** Name fragment every integration-test database must contain. */
export const TEST_DB_MARKER = 'fleet_test';

/** Extracts the database name from a PostgreSQL connection URL. */
export function databaseNameFromUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Integration tests: database URL is not a valid URL.');
  }
  return decodeURIComponent(parsed.pathname.replace(/^\//, ''));
}

/** Throws unless the URL targets a database whose name contains `fleet_test`. */
export function assertTestDatabase(url: string | undefined): string {
  if (!url) {
    throw new Error(
      'Integration tests: set TEST_DATABASE_URL (or DATABASE_URL) to a fleet_test database.',
    );
  }
  const name = databaseNameFromUrl(url);
  if (!name.includes(TEST_DB_MARKER)) {
    throw new Error(
      `Integration tests refuse to run: database "${name}" does not contain "${TEST_DB_MARKER}".`,
    );
  }
  return name;
}

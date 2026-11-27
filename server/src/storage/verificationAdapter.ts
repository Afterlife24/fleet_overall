import { ConfigError, type ServerConfig } from '../config.js';

export type ScanStatus = 'Pending' | 'Clean' | 'Rejected' | 'Failed';

export interface VerificationInput {
  fileId: string;
  key: string;
  bytes: number;
  sha256: string;
  mime: string;
}
export interface VerificationResult {
  status: ScanStatus;
  /** Recorded in the audit trail. */
  auditMarker: string;
}
export interface VerificationAdapter {
  readonly name: string;
  scan(input: VerificationInput): Promise<VerificationResult>;
}

export const DEV_STUB_MARKER = 'development-stub: no malware scan was performed';

/** Marks every file Clean without scanning. Only for artificial local fixtures. */
export class DevelopmentStubVerifier implements VerificationAdapter {
  readonly name = 'development-stub';
  async scan(): Promise<VerificationResult> {
    return { status: 'Clean', auditMarker: DEV_STUB_MARKER };
  }
}

/** Placeholder for the approved scanner: not integrated yet, so files stay Pending and inaccessible. */
export class UnconfiguredScanner implements VerificationAdapter {
  readonly name = 'approved-scanner';
  async scan(): Promise<VerificationResult> {
    return { status: 'Pending', auditMarker: 'approved-scanner: not configured; file left Pending' };
  }
}

/** The development stub is selectable only when NODE_ENV is development or test. */
export function createVerificationAdapter(config: Pick<ServerConfig, 'nodeEnv' | 'fileScanDriver'>): VerificationAdapter {
  if (config.fileScanDriver === 'development-stub') {
    if (config.nodeEnv !== 'development' && config.nodeEnv !== 'test') {
      throw new ConfigError(['FILE_SCAN_DRIVER: forbidden_in_production']);
    }
    return new DevelopmentStubVerifier();
  }
  return new UnconfiguredScanner();
}

import { MIN_DISTINCT_CHARS, MIN_KEY_LENGTH, validateOwnerAccessKeyConfig } from '../web/ownerGate';

export interface BetaEnvValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateBetaEnvironment(env: NodeJS.ProcessEnv = process.env): BetaEnvValidationResult {
  const errors: string[] = [];
  const ownerKey = env.G4X_OWNER_ACCESS_KEY || env.OWNER_ACCESS_KEY;
  const result = validateOwnerAccessKeyConfig(ownerKey);

  if (!result.valid) {
    errors.push(
      `G4X_OWNER_ACCESS_KEY must be at least ${MIN_KEY_LENGTH} characters with at least ${MIN_DISTINCT_CHARS} distinct characters: ${result.reason}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

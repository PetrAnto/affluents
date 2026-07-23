/**
 * Fail-fast validation of every address / wallet-id the orchestrator uses.
 *
 * Motivated by a real incident (2026-07-23): a malformed VAULT_ADDRESS — two
 * .env values collided onto one line, so the variable held
 * `0x…ee0USDC_ADDRESS=0x36…` — passed the truthiness check that was the only
 * gate at the time. The pipeline then moved money through sweep, fx and reserve
 * before the earn step failed on it. Anything shaped like this must stop the
 * process at boot, before a single step runs.
 *
 * NOTHING here ever includes a value in its output: .env holds keys and entity
 * secrets, and pm2 logs get pasted into chats. Variable names and the reason
 * only.
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Address vars that must always be valid when set. */
const ADDRESS_VARS = ['USDC_ADDRESS', 'EURC_ADDRESS'] as const;

/**
 * Role vars: the money-moving configuration. Absent as a set = the legitimate
 * pre-Circle-setup state. Present but partial or malformed = fatal.
 */
const ROLE_ADDRESS_VARS = [
  'TREASURY_WALLET_ADDRESS',
  'SPEND_WALLET_ADDRESS',
  'RESERVE_WALLET_ADDRESS',
  'VAULT_ADDRESS',
] as const;
const ROLE_UUID_VARS = ['TREASURY_WALLET_ID', 'SPEND_WALLET_ID', 'RESERVE_WALLET_ID'] as const;

export type EnvLike = Record<string, string | undefined>;

export interface ValidationResult {
  /** Human-readable failures — variable NAMES and reasons only, never values. */
  errors: string[];
  /** True when no role var is set at all: valid pre-setup state, pipeline no-ops. */
  roleConfigAbsent: boolean;
}

function checkShape(env: EnvLike, name: string, re: RegExp, shape: string, errors: string[]): void {
  const v = env[name];
  if (v === undefined || v === '') return; // presence handled by the caller
  if (!re.test(v)) {
    // Length is a safe, useful hint: it distinguishes a typo from a collision
    // (the incident's value was 60+ chars) without revealing the value.
    errors.push(`${name}: not a valid ${shape} (length ${v.length})`);
  }
}

export function validateEnvConfig(env: EnvLike): ValidationResult {
  const errors: string[] = [];

  for (const name of ADDRESS_VARS) checkShape(env, name, ADDRESS_RE, 'address (^0x[0-9a-fA-F]{40}$)', errors);
  for (const name of ROLE_ADDRESS_VARS) checkShape(env, name, ADDRESS_RE, 'address (^0x[0-9a-fA-F]{40}$)', errors);
  for (const name of ROLE_UUID_VARS) checkShape(env, name, UUID_RE, 'UUID', errors);

  const roleVars = [...ROLE_ADDRESS_VARS, ...ROLE_UUID_VARS];
  const setRoleVars = roleVars.filter((n) => env[n] !== undefined && env[n] !== '');

  // All absent = pre-setup, fine. Some absent = a half-configured deployment
  // that would verify payments and then silently no-op instead of routing —
  // the trap this validation exists to remove. Fatal.
  const roleConfigAbsent = setRoleVars.length === 0;
  if (!roleConfigAbsent && setRoleVars.length < roleVars.length) {
    const missing = roleVars.filter((n) => !setRoleVars.includes(n));
    errors.push(`role config is partially set — missing: ${missing.join(', ')}`);
  }

  return { errors, roleConfigAbsent };
}

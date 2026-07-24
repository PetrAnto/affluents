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

  validateFxConfig(env, errors);

  return { errors, roleConfigAbsent };
}

/**
 * Live-FX configuration (App Kit). FX_MODE=demo (the default) needs nothing;
 * FX_MODE=live requires KIT_KEY and an EXPLICIT FX_ORACLE_MAX_DEVIATION_BPS —
 * the testnet pool sits ~2,000 bps from the ECB fiat rate (measured
 * 2026-07-24), so the production default of 200 would refuse every swap.
 * Making the override mandatory keeps it a visible, validated line in .env
 * rather than a silent default (operator decision 2026-07-24).
 */
function validateFxConfig(env: EnvLike, errors: string[]): void {
  const mode = env.FX_MODE ?? 'demo';
  if (mode !== 'live' && mode !== 'demo') {
    errors.push(`FX_MODE: must be 'live' or 'demo' (length ${env.FX_MODE?.length ?? 0})`);
    return;
  }

  const intInRange = (name: string, min: number, max: number): number | null => {
    const v = env[name];
    if (v === undefined || v === '') return null;
    if (!/^\d+$/.test(v) || Number(v) < min || Number(v) > max) {
      errors.push(`${name}: must be an integer in [${min},${max}] (length ${v.length})`);
      return null;
    }
    return Number(v);
  };

  const baseTol = intInRange('FX_TOLERANCE_BPS', 0, 10000);
  intInRange('FX_TOLERANCE_MIN_EURC6', 0, 1_000_000_000);
  const maxDev = intInRange('FX_ORACLE_MAX_DEVIATION_BPS', 1, 10000);

  const ladderRaw = env.FX_TOLERANCE_LADDER;
  if (ladderRaw !== undefined && ladderRaw !== '') {
    const parts = ladderRaw.split(',').map((p) => p.trim());
    if (parts.length === 0 || parts.some((p) => !/^\d+$/.test(p) || Number(p) > 10000)) {
      errors.push(`FX_TOLERANCE_LADDER: must be comma-separated integers in [0,10000] (length ${ladderRaw.length})`);
    } else {
      const nums = parts.map(Number);
      if (nums.some((v, i) => i > 0 && v <= nums[i - 1]!)) {
        errors.push('FX_TOLERANCE_LADDER: values must be strictly increasing');
      }
      if (baseTol !== null && nums[0] !== baseTol) {
        errors.push('FX_TOLERANCE_LADDER: first rung must equal FX_TOLERANCE_BPS');
      }
    }
  }

  if (env.FX_ORACLE_URL !== undefined && env.FX_ORACLE_URL !== '') {
    try {
      const u = new URL(env.FX_ORACLE_URL);
      if (u.protocol !== 'https:') errors.push('FX_ORACLE_URL: must be https');
    } catch {
      errors.push(`FX_ORACLE_URL: not a valid URL (length ${env.FX_ORACLE_URL.length})`);
    }
  }

  if (mode === 'live') {
    if (!env.KIT_KEY) errors.push('KIT_KEY: required when FX_MODE=live');
    if (maxDev === null && (env.FX_ORACLE_MAX_DEVIATION_BPS === undefined || env.FX_ORACLE_MAX_DEVIATION_BPS === '')) {
      errors.push(
        'FX_ORACLE_MAX_DEVIATION_BPS: must be set EXPLICITLY when FX_MODE=live ' +
          '(testnet pool ≈2,000 bps from ECB — the 200 bps production default would refuse every swap)',
      );
    }
  }
}

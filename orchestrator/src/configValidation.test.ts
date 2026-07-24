import { describe, expect, it } from 'vitest';
import { validateEnvConfig, type EnvLike } from './configValidation';

const VALID_ADDR = '0x2c22bf430369aaa2caf83a473a702d3aa2a99ee0';
const VALID_UUID = '977f3ee0-9d5e-59d9-b519-5b98ee0c9b59';

/** A fully valid role config to mutate per-case. */
function goodEnv(): EnvLike {
  return {
    USDC_ADDRESS: '0x3600000000000000000000000000000000000000',
    EURC_ADDRESS: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
    TREASURY_WALLET_ADDRESS: VALID_ADDR,
    SPEND_WALLET_ADDRESS: VALID_ADDR,
    RESERVE_WALLET_ADDRESS: VALID_ADDR,
    VAULT_ADDRESS: VALID_ADDR,
    TREASURY_WALLET_ID: VALID_UUID,
    SPEND_WALLET_ID: VALID_UUID,
    RESERVE_WALLET_ID: VALID_UUID,
  };
}

describe('validateEnvConfig', () => {
  it('accepts a fully valid config', () => {
    const r = validateEnvConfig(goodEnv());
    expect(r.errors).toEqual([]);
    expect(r.roleConfigAbsent).toBe(false);
  });

  it('treats a completely absent role config as the valid pre-setup state', () => {
    const r = validateEnvConfig({ USDC_ADDRESS: '0x3600000000000000000000000000000000000000' });
    expect(r.errors).toEqual([]);
    expect(r.roleConfigAbsent).toBe(true);
  });

  it('REJECTS the exact collided string from the 2026-07-23 incident', () => {
    // Two .env values landed on one line, so VAULT_ADDRESS held the vault
    // address immediately followed by `USDC_ADDRESS=0x3600…`. This is the value
    // that passed the old truthiness gate and moved money through three steps.
    const env = goodEnv();
    env.VAULT_ADDRESS =
      '0x2c22bf430369aaa2caf83a473a702d3aa2a99ee0USDC_ADDRESS=0x3600000000000000000000000000000000000000';
    const r = validateEnvConfig(env);
    expect(r.errors.some((e) => e.startsWith('VAULT_ADDRESS:'))).toBe(true);
  });

  it('rejects a role UUID that is actually an address', () => {
    const env = goodEnv();
    env.SPEND_WALLET_ID = VALID_ADDR;
    const r = validateEnvConfig(env);
    expect(r.errors.some((e) => e.startsWith('SPEND_WALLET_ID:'))).toBe(true);
  });

  it('flags a partially-set role config (a half-configured deployment)', () => {
    const env = goodEnv();
    delete env.VAULT_ADDRESS;
    const r = validateEnvConfig(env);
    expect(r.roleConfigAbsent).toBe(false);
    expect(r.errors.some((e) => e.includes('partially set') && e.includes('VAULT_ADDRESS'))).toBe(true);
  });

  it('never includes a variable VALUE in any error message', () => {
    const env = goodEnv();
    env.VAULT_ADDRESS = '0xdeadbeefNOTANADDRESS_secret_material_here';
    const r = validateEnvConfig(env);
    for (const e of r.errors) {
      expect(e).not.toContain('deadbeef');
      expect(e).not.toContain('secret_material');
    }
  });
});

describe('validateEnvConfig — FX (operator decision 2026-07-24: overrides are visible, validated lines)', () => {
  it('demo mode (default) needs no FX vars at all', () => {
    expect(validateEnvConfig(goodEnv()).errors).toEqual([]);
  });

  it('FX_MODE=live REQUIRES an explicit FX_ORACLE_MAX_DEVIATION_BPS and KIT_KEY', () => {
    const env = { ...goodEnv(), FX_MODE: 'live' };
    const r = validateEnvConfig(env);
    expect(r.errors.some((e) => e.startsWith('FX_ORACLE_MAX_DEVIATION_BPS:') && e.includes('EXPLICITLY'))).toBe(true);
    expect(r.errors.some((e) => e.startsWith('KIT_KEY:'))).toBe(true);
  });

  it('accepts the intended testnet live config (3000 bps override)', () => {
    const env = {
      ...goodEnv(),
      FX_MODE: 'live',
      KIT_KEY: 'k',
      FX_ORACLE_MAX_DEVIATION_BPS: '3000',
      FX_TOLERANCE_BPS: '50',
      FX_TOLERANCE_LADDER: '50,75,100',
      FX_TOLERANCE_MIN_EURC6: '10000',
    };
    expect(validateEnvConfig(env).errors).toEqual([]);
  });

  it('rejects a malformed mode, ladder, tolerance and oracle URL — names only', () => {
    const env = {
      ...goodEnv(),
      FX_MODE: 'liv',
    };
    expect(validateEnvConfig(env).errors.some((e) => e.startsWith('FX_MODE:'))).toBe(true);

    const env2 = {
      ...goodEnv(),
      FX_TOLERANCE_LADDER: '50,abc',
      FX_TOLERANCE_BPS: '20000',
      FX_ORACLE_URL: 'http://insecure.example',
    };
    const r2 = validateEnvConfig(env2);
    expect(r2.errors.some((e) => e.startsWith('FX_TOLERANCE_LADDER:'))).toBe(true);
    expect(r2.errors.some((e) => e.startsWith('FX_TOLERANCE_BPS:'))).toBe(true);
    expect(r2.errors.some((e) => e === 'FX_ORACLE_URL: must be https')).toBe(true);
    for (const e of r2.errors) expect(e).not.toContain('abc');
  });

  it('rejects a non-increasing ladder and a ladder whose first rung differs from the base', () => {
    const r = validateEnvConfig({ ...goodEnv(), FX_TOLERANCE_LADDER: '50,50,100' });
    expect(r.errors.some((e) => e.includes('strictly increasing'))).toBe(true);
    const r2 = validateEnvConfig({ ...goodEnv(), FX_TOLERANCE_BPS: '25', FX_TOLERANCE_LADDER: '50,75,100' });
    expect(r2.errors.some((e) => e.includes('first rung'))).toBe(true);
  });
});

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

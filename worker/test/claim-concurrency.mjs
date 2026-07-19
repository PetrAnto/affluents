// D1 wallet-claim concurrency test (SPEC §3.1 invariant):
// two concurrent invoice creations can never receive the same wallet.
//
// Runs against a live Worker (local `wrangler dev` or deployed) using the
// authenticated internal API to seed dummy pool wallets, then fires more
// concurrent invoice creations than there are wallets and asserts that no
// wallet was assigned twice and the overflow got `awaiting_wallet`.
//
// Usage: BASE_URL=https://... INTERNAL_API_KEY=... node test/claim-concurrency.mjs

const BASE_URL = process.env.BASE_URL;
const KEY = process.env.INTERNAL_API_KEY;
if (!BASE_URL || !KEY) {
  console.error('BASE_URL and INTERNAL_API_KEY env vars are required');
  process.exit(2);
}

const WALLETS = 8;
const CREATIONS = 20;

function randomAddress() {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return '0x' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cleanup(addresses) {
  await fetch(`${BASE_URL}/api/internal/test-cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': KEY },
    body: JSON.stringify({ addresses }),
  });
}

async function main() {
  const addresses = Array.from({ length: WALLETS }, () => randomAddress());
  const seed = await fetch(`${BASE_URL}/api/internal/wallets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Key': KEY },
    body: JSON.stringify({ wallets: addresses.map((address) => ({ address })) }),
  });
  if (!seed.ok) throw new Error(`seeding wallets failed: ${seed.status} ${await seed.text()}`);

  let results;
  try {
    results = await Promise.all(
      Array.from({ length: CREATIONS }, (_, i) =>
        fetch(`${BASE_URL}/api/invoices`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: '1.00', label: `concurrency-test-${i}` }),
        }).then((r) => {
          if (!r.ok) throw new Error(`invoice creation failed: ${r.status}`);
          return r.json();
        }),
      ),
    );
  } catch (e) {
    await cleanup(addresses);
    throw e;
  }

  const withWallet = results.filter((r) => r.depositAddress);
  const without = results.filter((r) => !r.depositAddress);
  const unique = new Set(withWallet.map((r) => r.depositAddress));

  await cleanup(addresses);

  console.log(`created ${results.length} invoices concurrently`);
  console.log(`assigned wallets: ${withWallet.length}, unique: ${unique.size}, awaiting_wallet: ${without.length}`);

  if (unique.size !== withWallet.length) {
    console.error('FAIL: a wallet was assigned to more than one invoice');
    process.exit(1);
  }
  if (withWallet.length !== WALLETS) {
    console.error(`FAIL: expected exactly ${WALLETS} assignments (pool size), got ${withWallet.length}`);
    process.exit(1);
  }
  if (!without.every((r) => r.status === 'awaiting_wallet')) {
    console.error('FAIL: overflow invoices are not in awaiting_wallet');
    process.exit(1);
  }
  console.log('PASS: wallet-claim atomicity holds under concurrency');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

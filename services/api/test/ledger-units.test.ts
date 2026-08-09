import test from 'node:test';
import assert from 'node:assert/strict';
import {
  creditsToUsdCents,
  isFinanceOpsFrozen,
  resolveUsdCentsPerCredit,
  splitWalletCreditsLedger,
  usdCentsToPayAmountMajor,
} from '../src/common/ledger-units';

test('isFinanceOpsFrozen defaults on; respects falsey override', () => {
  const prev = process.env.FINANCE_OPS_FROZEN;
  try {
    delete process.env.FINANCE_OPS_FROZEN;
    assert.equal(isFinanceOpsFrozen(), true);
    process.env.FINANCE_OPS_FROZEN = '0';
    assert.equal(isFinanceOpsFrozen(), false);
    process.env.FINANCE_OPS_FROZEN = 'false';
    assert.equal(isFinanceOpsFrozen(), false);
    process.env.FINANCE_OPS_FROZEN = '1';
    assert.equal(isFinanceOpsFrozen(), true);
  } finally {
    if (prev === undefined) delete process.env.FINANCE_OPS_FROZEN;
    else process.env.FINANCE_OPS_FROZEN = prev;
  }
});

test('creditsToUsdCents requires explicit rate (no invented FX)', () => {
  assert.equal(creditsToUsdCents(10n, null), null);
  assert.equal(creditsToUsdCents(10n, 0), null);
  assert.equal(creditsToUsdCents(10n, 1), 10n);
  assert.equal(creditsToUsdCents(10n, 0.5), 5n);
});

test('resolveUsdCentsPerCredit prefers setting then env', () => {
  const prev = process.env.USD_CENTS_PER_CREDIT;
  try {
    delete process.env.USD_CENTS_PER_CREDIT;
    assert.equal(resolveUsdCentsPerCredit(null), null);
    assert.equal(resolveUsdCentsPerCredit(2), 2);
    process.env.USD_CENTS_PER_CREDIT = '3';
    assert.equal(resolveUsdCentsPerCredit(null), 3);
  } finally {
    if (prev === undefined) delete process.env.USD_CENTS_PER_CREDIT;
    else process.env.USD_CENTS_PER_CREDIT = prev;
  }
});

test('usdCentsToPayAmountMajor converts once (cents → major)', () => {
  assert.equal(usdCentsToPayAmountMajor(5n), '0.05');
  assert.equal(usdCentsToPayAmountMajor(299n), '2.99');
  assert.equal(usdCentsToPayAmountMajor(100n), '1.00');
});

test('splitWalletCreditsLedger fails closed without rate', () => {
  const prev = process.env.USD_CENTS_PER_CREDIT;
  const prevFrozen = process.env.FINANCE_OPS_FROZEN;
  try {
    delete process.env.USD_CENTS_PER_CREDIT;
    process.env.FINANCE_OPS_FROZEN = '0';
    assert.equal(splitWalletCreditsLedger(10n, 0.7, { financeFrozen: false }), null);
  } finally {
    if (prev === undefined) delete process.env.USD_CENTS_PER_CREDIT;
    else process.env.USD_CENTS_PER_CREDIT = prev;
    if (prevFrozen === undefined) delete process.env.FINANCE_OPS_FROZEN;
    else process.env.FINANCE_OPS_FROZEN = prevFrozen;
  }
});

test('splitWalletCreditsLedger freezes creator income without settleable debt', () => {
  const split = splitWalletCreditsLedger(10n, 0.7, {
    usdCentsPerCredit: 1,
    financeFrozen: true,
  });
  assert.ok(split);
  assert.equal(split.amountUsdCents, 10n);
  assert.equal(split.creatorIncomeUsdCents, 0n);
  assert.equal(split.platformFeeUsdCents, 10n);
  assert.equal(split.deferredCreatorIncomeUsdCents, 7n);
  assert.equal(split.financeFrozen, true);

  const live = splitWalletCreditsLedger(10n, 0.7, {
    usdCentsPerCredit: 1,
    financeFrozen: false,
  });
  assert.ok(live);
  assert.equal(live.creatorIncomeUsdCents, 7n);
  assert.equal(live.platformFeeUsdCents, 3n);
  assert.equal(live.deferredCreatorIncomeUsdCents, null);
});

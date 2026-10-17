import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { estimateCost, estimateForRequest, hourlyRate } from '../src/cost.js';

const close = (actual: number, expected: number, epsilon = 0.0005): void => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} is not within ${epsilon} of ${expected}`);
};

describe('hourlyRate', () => {
  it('small is about 3 cents an hour and medium about 10.5 cents', () => {
    close(hourlyRate('small'), 0.0299);
    close(hourlyRate('medium'), 0.1046);
  });

  it('medium costs more than small', () => {
    assert.ok(hourlyRate('medium') > hourlyRate('small'));
  });
});

describe('estimateCost', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');

  it('computes cost so far and projected cost at expiry', () => {
    const cost = estimateCost({ size: 'medium', launchedAt: '2026-10-20T11:00:00Z', expiresAt: '2026-10-20T13:00:00Z', now });
    close(cost.soFar ?? -1, 0.1046);
    close(cost.projected ?? -1, 0.2092);
  });

  it('returns nulls when the launch time is unknown', () => {
    const cost = estimateCost({ size: 'small', launchedAt: null, expiresAt: '2026-10-20T13:00:00Z', now });
    assert.equal(cost.soFar, null);
    assert.equal(cost.projected, null);
  });

  it('never goes negative if the launch time is in the future', () => {
    const cost = estimateCost({ size: 'small', launchedAt: '2026-10-20T13:00:00Z', expiresAt: null, now });
    assert.equal(cost.soFar, 0);
  });
});

describe('estimateForRequest', () => {
  it('total is the hourly rate times the TTL', () => {
    const estimate = estimateForRequest('medium', 2);
    close(estimate.total, estimate.hourly * 2);
    assert.equal(estimate.nodes, 2);
  });
});

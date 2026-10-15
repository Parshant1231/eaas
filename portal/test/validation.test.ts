import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isIpv4, isValidEnvId, parseCreateRequest } from '../src/validation.js';

describe('isValidEnvId', () => {
  it('accepts valid names', () => {
    for (const name of ['demo', 'dev1', 'my-env-2', 'abc', 'a' + 'b'.repeat(19)]) {
      assert.equal(isValidEnvId(name), true, name);
    }
  });

  it('rejects invalid names and injection attempts', () => {
    const bad = ['', 'ab', 'Demo', '1abc', 'a_b', '-abc', 'demo;rm -rf /', 'demo ', 'demo\n', 'a'.repeat(21), '../etc'];
    for (const name of bad) assert.equal(isValidEnvId(name), false, JSON.stringify(name));
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 5, {}, []]) assert.equal(isValidEnvId(value), false);
  });
});

describe('parseCreateRequest', () => {
  it('accepts a valid request', () => {
    const result = parseCreateRequest({ name: 'demo1', size: 'medium', ttlHours: 2 });
    assert.deepEqual(result, { ok: true, value: { name: 'demo1', size: 'medium', ttlHours: 2 } });
  });

  it('rejects bad input', () => {
    const cases: unknown[] = [
      null,
      [],
      'text',
      { name: 'Bad_Name', size: 'small', ttlHours: 1 },
      { name: 'demo1', size: 'large', ttlHours: 1 },
      { name: 'demo1', size: 'small', ttlHours: 3 },
      { name: 'demo1', size: 'small', ttlHours: '1' },
      { name: 'demo1', size: 'small' },
      { size: 'small', ttlHours: 1 },
    ];
    for (const body of cases) assert.equal(parseCreateRequest(body).ok, false, JSON.stringify(body));
  });
});

describe('isIpv4', () => {
  it('accepts IPv4 addresses only', () => {
    assert.equal(isIpv4('13.201.10.20'), true);
    for (const value of ['999.1.1.1', '1.2.3', '1.2.3.4; evil', 'a.b.c.d', '', undefined]) {
      assert.equal(isIpv4(value), false, String(value));
    }
  });
});

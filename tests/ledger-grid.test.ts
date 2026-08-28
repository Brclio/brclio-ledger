import { describe, expect, it } from 'vitest';

import {
  normalizePastedDate,
  parseGridAmount,
} from '../src/lib/grid-input.js';

describe('ledger grid input normalization', () => {
  it('accepts safe currency amounts without coercing invalid text or negatives to zero', () => {
    expect(parseGridAmount('￥ 1,234.50')).toBe(1_234.5);
    expect(parseGridAmount('￥ 1，234.50')).toBe(1_234.5);
    expect(parseGridAmount('0')).toBe(0);
    expect(parseGridAmount('abc')).toBeNull();
    expect(parseGridAmount('12,34')).toBeNull();
    expect(parseGridAmount('1,2,3')).toBeNull();
    expect(parseGridAmount('1 2 3')).toBeNull();
    expect(parseGridAmount('-25')).toBeNull();
    expect(parseGridAmount('(25)')).toBeNull();
    expect(parseGridAmount('1000000000001')).toBeNull();
  });

  it('normalizes real calendar dates and rejects empty or impossible values', () => {
    expect(normalizePastedDate('2026/8/29')).toBe('2026-08-29');
    expect(normalizePastedDate('2026年8月29日')).toBe('2026-08-29');
    expect(normalizePastedDate('2026-02-30')).toBeNull();
    expect(normalizePastedDate('')).toBeNull();
  });
});

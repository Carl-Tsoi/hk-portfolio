/**
 * 單元測試：formatStockCode & toYahooCode
 */
import { describe, it, expect } from 'vitest';
import { formatStockCode, toYahooCode } from '@/services/portfolioService';

describe('formatStockCode', () => {
  it('should pad "700" to "00700"', () => {
    expect(formatStockCode('700')).toBe('00700');
  });

  it('should pad "5" to "00005"', () => {
    expect(formatStockCode('5')).toBe('00005');
  });

  it('should pad "9988" to "09988"', () => {
    expect(formatStockCode('9988')).toBe('09988');
  });

  it('should keep 5-digit code unchanged', () => {
    expect(formatStockCode('00700')).toBe('00700');
  });

  it('should trim spaces', () => {
    expect(formatStockCode(' 700 ')).toBe('00700');
  });

  it('should strip non-digits', () => {
    expect(formatStockCode('700.HK')).toBe('00700');
  });

  it('should return empty for empty input', () => {
    expect(formatStockCode('')).toBe('');
  });

  it('should return empty for all spaces', () => {
    expect(formatStockCode('   ')).toBe('');
  });

  it('should return empty for all non-digits', () => {
    expect(formatStockCode('abc')).toBe('');
  });

  it('should not truncate >5 digits', () => {
    expect(formatStockCode('123456')).toBe('123456');
  });
});

describe('toYahooCode', () => {
  it('should convert 00700 to 0700.HK', () => {
    expect(toYahooCode('00700')).toBe('0700.HK');
  });

  it('should convert 00005 to 0005.HK', () => {
    expect(toYahooCode('00005')).toBe('0005.HK');
  });

  it('should convert 09988 to 9988.HK', () => {
    expect(toYahooCode('09988')).toBe('9988.HK');
  });
});

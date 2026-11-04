import { describe, expect, test } from 'bun:test';
import { initials } from '../src/auth/mock-user';
import { isDark, parseTheme } from '../src/theme/theme';

describe('theme', () => {
  test('a stored theme is kept; anything else is system', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme(null)).toBe('system');
    expect(parseTheme('blue')).toBe('system');
  });

  test('system follows the operating system; light and dark ignore it', () => {
    expect(isDark('system', true)).toBe(true);
    expect(isDark('system', false)).toBe(false);
    expect(isDark('dark', false)).toBe(true);
    expect(isDark('light', true)).toBe(false);
  });
});

describe('user initials', () => {
  test('first and last name', () => {
    expect(initials('Ana Maria Silva')).toBe('AS');
    expect(initials('  bia  ')).toBe('B');
  });
});

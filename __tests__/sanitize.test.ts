import { sanitize } from '../src/sanitize';

describe('sanitize', () => {
  test('handles leading number', () => {
    expect(sanitize('1thing')).toBe('thing');
  });

  test('allows non-leading numbers', () => {
    expect(sanitize('i18n')).toBe('i18n');
  });

  test('introduces camel case', () => {
    expect(sanitize('this:thing')).toBe('thisThing');
  });

  test('trailing illegal char', () => {
    expect(sanitize('this-is: the hint!')).toBe('thisIsTheHint');
  });
});

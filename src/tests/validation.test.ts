import { describe, expect, it } from 'vitest';
import { cnicProblem, emailProblem, mobileProblem, ntnProblem, phoneProblem, strnProblem } from '../lib/validation';

describe('form validation', () => {
  it('optional fields may be empty but must be valid when filled', () => {
    expect(emailProblem('')).toBeUndefined();
    expect(emailProblem('  ')).toBeUndefined();
    expect(emailProblem('a@b')).toBeDefined();
    expect(emailProblem('ali@insectkiller.pk')).toBeUndefined();
    expect(emailProblem('', { required: true, label: 'Contact email' })).toBe('Contact email is required.');
  });

  it('checks Pakistani mobile and landline numbers', () => {
    expect(mobileProblem('0300 1234567')).toBeUndefined();
    expect(mobileProblem('+92 300 1234567')).toBeUndefined();
    expect(mobileProblem('021-1234567')).toBeDefined();
    expect(mobileProblem('12345')).toBeDefined();
    expect(phoneProblem('021-1234567')).toBeUndefined();
    expect(phoneProblem('042 12345678')).toBeUndefined();
    expect(phoneProblem('abc')).toBeDefined();
  });

  it('checks CNIC, NTN and STRN formats', () => {
    expect(cnicProblem('42101-1234567-1')).toBeUndefined();
    expect(cnicProblem('42101-12345')).toBeDefined();
    expect(ntnProblem('1234567-8')).toBeUndefined();
    expect(ntnProblem('1234567')).toBeUndefined();
    expect(ntnProblem('12-34')).toBeDefined();
    expect(strnProblem('1234567890123')).toBeUndefined();
    expect(strnProblem('S1234567-8')).toBeUndefined();
    expect(strnProblem('123')).toBeDefined();
  });
});

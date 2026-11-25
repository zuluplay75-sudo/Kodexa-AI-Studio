import { describe, expect, it } from 'vitest';
import { applyKodexaEnv } from './branding-env';

describe('Kodexa environment compatibility', () => {
  it('accepts new names without mutating the input', () => {
    const input = { KODEXA_PORT: '4747', KODEXA_DEMO: '0' };
    expect(applyKodexaEnv(input)).toMatchObject({ HABBLAUD_PORT: '4747', HABBLAUD_DEMO: '0' });
    expect(input).not.toHaveProperty('HABBLAUD_PORT');
  });
  it('preserves existing explicit safety settings and empty values', () => {
    expect(applyKodexaEnv({ HABBLAUD_TERMINAL: '0', KODEXA_TERMINAL: '1', HABBLAUD_ALLOWED_HOSTS: '', KODEXA_ALLOWED_HOSTS: 'example.com' })).toMatchObject({ HABBLAUD_TERMINAL: '0', HABBLAUD_ALLOWED_HOSTS: '' });
  });
  it('does not alias Academy keys or other namespaces', () => {
    expect(applyKodexaEnv({ KODEXA_ACADEMY_AUTO: '1', OPENAI_API_KEY: 'test' })).toEqual({ KODEXA_ACADEMY_AUTO: '1', OPENAI_API_KEY: 'test' });
  });
});

import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findRoot, loadConfig } from './config';
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

describe('Kodexa package and server configuration', () => {
  it.each(['kodexa-ai-studio', 'habblaud'])('finds the package root for %s', (name) => {
    const root = mkdtempSync(join(tmpdir(), 'kodexa-root-'));
    try {
      const nested = join(root, 'dist', 'server');
      mkdirSync(nested, { recursive: true });
      writeFileSync(join(root, 'package.json'), JSON.stringify({ name }));
      expect(findRoot(nested)).toBe(root);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('keeps terminal and messages blocked on an exposed host', () => {
    const config = loadConfig({ KODEXA_HOST: '0.0.0.0', KODEXA_PORT: '4747', KODEXA_DEMO: '0', KODEXA_WORLD: '0', KODEXA_TERMINAL: '1', KODEXA_IN_DOCKER: '0' }, []);
    expect(config).toMatchObject({ host: '0.0.0.0', port: 4747, demo: false, terminal: false, messages: false, world: { enabled: false } });
  });
});

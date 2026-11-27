// O AppxManifest precisa ser XML válido (o makeappx recusa o pacote inteiro). Sem parser XML no Node, confere o que
// já quebrou e o essencial: comentários sem "--", marcadores trocados pelo build.ps1 e a identidade do app.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = readFileSync(new URL('./AppxManifest.xml', import.meta.url), 'utf8');

describe('AppxManifest do Kodexa Conector', () => {
  it('comentários XML sem "--" dentro (o makeappx recusa)', () => {
    for (const [, body] of manifest.matchAll(/<!--([\s\S]*?)-->/g)) expect(body.includes('--'), body.trim().slice(0, 60)).toBe(false);
  });
  it('tem os marcadores que o build.ps1 troca e o executável do conector', () => {
    for (const mark of ['__IDENTITY_NAME__', '__PUBLISHER__', '__PUBLISHER_DISPLAY__', '__VERSION__']) expect(manifest).toContain(mark);
    expect(manifest).toContain('Executable="KodexaConector.exe" EntryPoint="Windows.FullTrustApplication"');
    expect(manifest).toContain('<rescap:Capability Name="runFullTrust" />');
  });
});

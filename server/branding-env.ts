// Compatibility bridge for the Kodexa rename. Existing installations and integrations retain their identifiers.
// Legacy settings win when both names are provided, including explicit empty or disabled values.
// Academy owns its KODEXA_ACADEMY_* namespace and is not part of this bridge.
export function applyKodexaEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...env };
  for (const [key, value] of Object.entries(env)) {
    if (!/^KODEXA_[A-Z0-9_]+$/.test(key) || key.startsWith('KODEXA_ACADEMY_') || value === undefined) continue;
    const legacy = 'HABBLAUD_' + key.slice('KODEXA_'.length);
    if (result[legacy] === undefined) result[legacy] = value;
  }
  return result;
}

// Preferências locais de apresentação e equipe. Não são autenticação, permissões ou sessões de IA.
export const TEAM = [
  ['scout','Kodexa Scout','Pesquisa de campo e inovação'],
  ['academy','Kodexa Academy','Aprendizado e conhecimento'],
  ['manager','Kodexa Manager','Gerência técnica'],
  ['dev','Kodexa Dev','Programação'],
  ['network','Kodexa Network','Backend e infraestrutura'],
  ['design','Kodexa Design','Design e interfaces'],
  ['qa','Kodexa QA','Testes e qualidade'],
  ['shield','Kodexa Shield','Segurança cibernética'],
] as const;
export type Provider = 'unconfigured' | 'claude' | 'codex';
export type Member = { id: string; name: string; role: string; provider: Provider };
export type StudioPrefs = { schema: 1; company: string; theme: 'midnight' | 'ocean' | 'graphite'; members: Member[] };
const KEY = 'kodexa.studio.preferences.v1';
export function defaultMembers(): Member[] {
  return TEAM.map(([id,name,role]) => ({id,name,role,provider:'unconfigured'}));
}
export function parsePrefs(raw: string | null): StudioPrefs | null {
  try {
    const p = JSON.parse(raw ?? 'null') as StudioPrefs | null;
    if (!p || p.schema !== 1 || typeof p.company !== 'string' || !p.company.trim() || p.company.length > 80 || !['midnight','ocean','graphite'].includes(p.theme) || !Array.isArray(p.members) || p.members.length > 32) return null;
    const ids = new Set<string>();
    for (const m of p.members) {
      if (!m || typeof m.id !== 'string' || !m.id || m.id.length > 80 || ids.has(m.id) || typeof m.name !== 'string' || !m.name.trim() || m.name.length > 80 || typeof m.role !== 'string' || !m.role.trim() || m.role.length > 120 || !['unconfigured','claude','codex'].includes(m.provider)) return null;
      ids.add(m.id);
    }
    return p;
  } catch { return null; }
}
export function readPrefs(): StudioPrefs | null {
  try { return parsePrefs(localStorage.getItem(KEY)); } catch { return null; }
}
export function savePrefs(prefs: StudioPrefs): boolean {
  const value = JSON.stringify(prefs);
  if (!parsePrefs(value)) return false;
  try { localStorage.setItem(KEY,value); return true; } catch { return false; }
}

// Single-owner login behind a private Codespaces proxy or an explicitly configured HTTPS tunnel.
// Never infer trusted hostnames from incoming request headers.
export function codespaceLoginHost(env: NodeJS.ProcessEnv): string | undefined {
  if (env.CODESPACES !== 'true') return undefined;
  const name = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (!name || !/^[a-z0-9-]{1,63}$/.test(name) || domain !== 'app.github.dev') return undefined;
  if (env.KODEXA_TUNNEL_HOST !== undefined) {
    const host = env.KODEXA_TUNNEL_HOST.trim().toLowerCase();
    // Only an explicit DNS hostname, not URLs, ports, wildcards or IP literals.
    const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
    const labels = host.split('.');
    if (host.length > 253 || labels.length < 2 || !labels.every(x => label.test(x)) ||
        !/^[a-z]/.test(labels[labels.length - 1]) ||
        /(?:^|\.)(?:localhost|local|internal|invalid|test|example)$/.test(host)) return undefined;
    return host;
  }
  return name + '-4748.' + domain;
}

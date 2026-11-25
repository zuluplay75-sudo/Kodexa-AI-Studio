// Explicit single-owner login behind the private GitHub Codespaces HTTPS port proxy.
// No forwarded header is used to decide whether authentication is required.
export function codespaceLoginHost(env: NodeJS.ProcessEnv): string | undefined {
  if (env.CODESPACES !== 'true') return undefined;
  const name = env.CODESPACE_NAME;
  const domain = env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
  if (!name || !/^[a-z0-9-]{1,63}$/.test(name) || domain !== 'app.github.dev') return undefined;
  return name + '-4748.' + domain;
}

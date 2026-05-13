// Headers every /api/* proxy route must attach when forwarding to the agent.
//
// `x-agent-internal-bearer` is a service-to-service shared secret: the agent
// only accepts requests carrying it (when AGENT_INTERNAL_BEARER is set in the
// agent's env). Both services receive the same value at deploy time via
// Terraform secret_env. This prevents an attacker from hitting the agent's
// *.run.app URL directly to drive LLM spend — they'd have to mint a valid
// Firebase ID token AND know this secret.
//
// Returns an empty object when the env var is unset, so local dev / tests
// continue to work without the secret. The `authorization` header (Firebase
// ID token, browser-supplied) is added by each route separately.
export function agentInternalHeaders(): Record<string, string> {
  const bearer = process.env.AGENT_INTERNAL_BEARER;
  return bearer ? { 'x-agent-internal-bearer': bearer } : {};
}

import { describe, expect, it } from 'vitest';
import { UPGRADE_TO_PRO_TOOL_NAME, createUpgradeToProTool } from './upgradeToPro.js';

function exec(tool: ReturnType<typeof createUpgradeToProTool>) {
  // biome-ignore lint/suspicious/noExplicitAny: ADK tool internals
  return (tool as any).execute({});
}

describe('upgrade_to_pro tool', () => {
  it('has the expected name and a description that forbids trailing text', () => {
    const t = createUpgradeToProTool();
    expect(t.name).toBe(UPGRADE_TO_PRO_TOOL_NAME);
    // Same widget-is-the-turn rule as connect_workspace / auth_user.
    expect(t.description.toLowerCase()).toContain('no additional text');
  });

  it('returns {status: upgrade_prompted} and carries no auth or billing values', async () => {
    const r = await exec(createUpgradeToProTool());
    expect(r).toEqual({ status: 'upgrade_prompted' });
    // The LLM must never see anything billing-shaped here. Reinforces the
    // same "LLM-never-touches-auth-or-payment" boundary as Phase 10.
    const json = JSON.stringify(r);
    expect(json).not.toMatch(
      /access_token|refresh_token|client_secret|stripe|customer|subscription_id|price_id/i,
    );
  });
});

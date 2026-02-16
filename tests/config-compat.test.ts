import test from 'node:test';
import assert from 'node:assert/strict';

import { defaultConfig, loadConfig, validateConfig } from '../src/config';

test('config compatibility: validateConfig accepts SINGLE_WINNER alias', () => {
  const cfg = JSON.parse(JSON.stringify(defaultConfig));
  cfg.local.jobDefaults.consensusPolicy.type = 'SINGLE_WINNER';

  const result = validateConfig(cfg);
  assert.equal(result.errors.length, 0);
});

test('config compatibility: loadConfig normalizes SINGLE_WINNER to FIRST_SUBMISSION_WINS', () => {
  const loaded = loadConfig({
    config: {
      getPluginConfig: () => ({
        mode: 'local',
        local: {
          storage: { kind: 'json', path: './.openclaw/consensus-tools.json' },
          server: { enabled: false, host: '127.0.0.1', port: 9888, authToken: '' },
          slashingEnabled: false,
          jobDefaults: {
            reward: 10,
            stakeRequired: 1,
            maxParticipants: 3,
            minParticipants: 1,
            expiresSeconds: 86400,
            consensusPolicy: { type: 'SINGLE_WINNER', trustedArbiterAgentId: '' },
            slashingPolicy: { enabled: false, slashPercent: 0, slashFlat: 0 }
          },
          ledger: { faucetEnabled: false, initialCreditsPerAgent: 0, balancesMode: 'initial', balances: {} }
        },
        global: { baseUrl: 'http://localhost:9888', accessToken: '' },
        agentIdentity: { agentIdSource: 'openclaw', manualAgentId: '' },
        safety: { requireOptionalToolsOptIn: true, allowNetworkSideEffects: false }
      })
    }
  });

  assert.equal(loaded.local.jobDefaults.consensusPolicy.type, 'FIRST_SUBMISSION_WINS');
});

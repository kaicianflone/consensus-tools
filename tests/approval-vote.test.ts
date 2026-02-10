import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { JsonStorage } from '../src/storage/JsonStorage';
import { LedgerEngine } from '../src/ledger/ledger';
import { JobEngine } from '../src/jobs/engine';
import { defaultConfig } from '../src/config';

async function createEngine() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'consensus-tools-approval-'));
  const file = path.join(dir, 'state.json');
  const storage = new JsonStorage(file);
  await storage.init();
  const ledger = new LedgerEngine(storage, defaultConfig);
  const engine = new JobEngine(storage, ledger, defaultConfig);
  return { engine, ledger };
}

test('APPROVAL_VOTE: highest yes/no score wins (tie-break earliest)', async () => {
  const { engine, ledger } = await createEngine();
  await ledger.faucet('owner', 100, 'test');
  await ledger.faucet('a', 10, 'test');
  await ledger.faucet('b', 10, 'test');
  await ledger.faucet('v1', 10, 'test');

  const job = await engine.postJob('owner', {
    title: 'approval',
    description: 'test',
    reward: 1,
    stakeRequired: 0,
    expiresSeconds: 3600,
    consensusPolicy: {
      type: 'APPROVAL_VOTE',
      quorum: 1,
      minScore: 1,
      minMargin: 0,
      tieBreak: 'earliest',
      approvalVote: { weightMode: 'equal', settlement: 'immediate' }
    }
  });

  const s1 = await engine.submitJob('a', job.id, { summary: 'a', artifacts: { x: 1 }, confidence: 0.5 });
  const s2 = await engine.submitJob('b', job.id, { summary: 'b', artifacts: { x: 2 }, confidence: 0.5 });

  // Vote YES on s2 => score +1, making it winner.
  await engine.vote('v1', job.id, { submissionId: s2.id, score: 1 });

  const res = await engine.resolveJob('owner', job.id, {});
  assert.equal(res.winningSubmissionIds[0], s2.id);
});

test('APPROVAL_VOTE staked: wrong votes get slashed (voteSlashPercent)', async () => {
  const { engine, ledger } = await createEngine();
  await ledger.faucet('owner', 100, 'test');
  await ledger.faucet('a', 10, 'test');
  await ledger.faucet('b', 10, 'test');
  await ledger.faucet('v1', 10, 'test');

  const job = await engine.postJob('owner', {
    title: 'approval-staked',
    description: 'test',
    reward: 1,
    stakeRequired: 0,
    expiresSeconds: 3600,
    consensusPolicy: {
      type: 'APPROVAL_VOTE',
      quorum: 1,
      minScore: 1,
      minMargin: 0,
      tieBreak: 'earliest',
      approvalVote: { weightMode: 'equal', settlement: 'staked', voteSlashPercent: 0.5 }
    }
  });

  const s1 = await engine.submitJob('a', job.id, { summary: 'a', artifacts: { x: 1 }, confidence: 0.5 });
  const s2 = await engine.submitJob('b', job.id, { summary: 'b', artifacts: { x: 2 }, confidence: 0.5 });

  // Make s2 win.
  await engine.vote('v1', job.id, { submissionId: s2.id, score: 1, stakeAmount: 4 });
  // Wrong vote: YES on losing submission s1.
  await engine.vote('v1', job.id, { submissionId: s1.id, score: 1, stakeAmount: 4 });

  const res = await engine.resolveJob('owner', job.id, {});
  // At least one slash entry for v1.
  assert.ok(res.slashes.some((s) => s.agentId === 'v1' && s.reason === 'vote_wrong'));
});

test('APPROVAL_VOTE oracle settlement requires trusted arbiter manual resolution', async () => {
  const { engine, ledger } = await createEngine();
  await ledger.faucet('owner', 100, 'test');
  await ledger.faucet('arb', 100, 'test');
  await ledger.faucet('a', 10, 'test');

  const job = await engine.postJob('owner', {
    title: 'approval-oracle',
    description: 'test',
    reward: 1,
    stakeRequired: 0,
    expiresSeconds: 3600,
    consensusPolicy: {
      type: 'APPROVAL_VOTE',
      trustedArbiterAgentId: 'arb',
      approvalVote: { settlement: 'oracle', oracle: 'trusted_arbiter' }
    }
  });

  const s1 = await engine.submitJob('a', job.id, { summary: 'a', artifacts: { ok: true }, confidence: 0.5 });

  await assert.rejects(() => engine.resolveJob('owner', job.id, {}));
  await assert.rejects(() => engine.resolveJob('arb', job.id, {}));

  const res = await engine.resolveJob('arb', job.id, { manualWinners: ['a'], manualSubmissionId: s1.id });
  assert.equal(res.winners[0], 'a');
});

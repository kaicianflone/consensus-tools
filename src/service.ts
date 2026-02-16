import type { ConsensusToolsConfig, Job } from './types';

export interface ConsensusToolsBackend {
  listJobs(filters?: Record<string, string | undefined>): Promise<Job[]>;
  getJob(jobId: string): Promise<Job | undefined>;
}

export function createService(
  config: ConsensusToolsConfig,
  backend: ConsensusToolsBackend,
  agentId: string,
  capabilities: string[],
  logger?: any
) {
  return {
    id: 'consensus-tools-service',
    start: async () => {
      if (config.mode === 'global') return;
      logger?.debug?.(`consensus-tools: service started (agentId=${agentId}, capabilities=${Array.isArray(capabilities) ? capabilities.join(',') : ''})`);
    },
    stop: async () => {
      if (config.mode === 'global') return;
      logger?.debug?.('consensus-tools: service stopped');
    }
  };
}

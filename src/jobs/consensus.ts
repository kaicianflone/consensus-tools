import type { ConsensusPolicyType, Job, Submission, Vote } from '../types';

export interface ConsensusResult {
  winners: string[];
  winningSubmissionIds: string[];
  consensusTrace: Record<string, unknown>;
  finalArtifact: Record<string, unknown> | null;
}

export interface ConsensusInput {
  job: Job;
  submissions: Submission[];
  votes: Vote[];
  reputation: (agentId: string) => number;
  manualWinnerAgentIds?: string[];
  manualSubmissionId?: string;
}

export function resolveConsensus(input: ConsensusInput): ConsensusResult {
  const policy = input.job.consensusPolicy.type as ConsensusPolicyType;
  if (policy === 'TRUSTED_ARBITER') {
    if (input.manualWinnerAgentIds && input.manualWinnerAgentIds.length) {
      return {
        winners: input.manualWinnerAgentIds,
        winningSubmissionIds: input.manualSubmissionId ? [input.manualSubmissionId] : [],
        consensusTrace: { policy, mode: 'manual' },
        finalArtifact: findArtifact(input, input.manualSubmissionId)
      };
    }
    return {
      winners: [],
      winningSubmissionIds: [],
      consensusTrace: { policy, mode: 'awaiting_arbiter' },
      finalArtifact: null
    };
  }

  if (policy === 'OWNER_PICK') {
    if (input.manualWinnerAgentIds && input.manualWinnerAgentIds.length) {
      return {
        winners: input.manualWinnerAgentIds,
        winningSubmissionIds: input.manualSubmissionId ? [input.manualSubmissionId] : [],
        consensusTrace: { policy, mode: 'manual' },
        finalArtifact: findArtifact(input, input.manualSubmissionId)
      };
    }
    return {
      winners: [],
      winningSubmissionIds: [],
      consensusTrace: { policy, reason: 'no_owner_selection' },
      finalArtifact: null
    };
  }

  if (!input.submissions.length) {
    return { winners: [], winningSubmissionIds: [], consensusTrace: { policy, reason: 'no_submissions' }, finalArtifact: null };
  }

  if (policy === 'FIRST_SUBMISSION_WINS') {
    const sorted = [...input.submissions].sort((a, b) => Date.parse(a.submittedAt) - Date.parse(b.submittedAt));
    const winner = sorted[0];
    return {
      winners: [winner.agentId],
      winningSubmissionIds: [winner.id],
      consensusTrace: { policy, method: 'first_submission' },
      finalArtifact: winner.artifacts
    };
  }

  if (policy === 'APPROVAL_VOTE') {
    const quorum = input.job.consensusPolicy.quorum;
    const minScore = input.job.consensusPolicy.minScore ?? 1;
    const minMargin = input.job.consensusPolicy.minMargin ?? 0;
    const tieBreak = input.job.consensusPolicy.tieBreak ?? 'earliest';

    const weightMode = input.job.consensusPolicy.approvalVote?.weightMode ?? 'equal';
    const settlement = input.job.consensusPolicy.approvalVote?.settlement ?? 'immediate';

    // Oracle settlement can always be manually finalized by the arbiter, even with no votes.
    if (settlement === 'oracle' && input.manualWinnerAgentIds && input.manualWinnerAgentIds.length) {
      return {
        winners: input.manualWinnerAgentIds,
        winningSubmissionIds: input.manualSubmissionId ? [input.manualSubmissionId] : [],
        consensusTrace: { policy, settlement, mode: 'manual' },
        finalArtifact: findArtifact(input, input.manualSubmissionId)
      };
    }

    const scores: Record<string, number> = {};
    const voteCounts: Record<string, number> = {};

    // Only consider votes that target submissions.
    const votes = input.votes.filter((v) => v.submissionId || (v.targetType === 'SUBMISSION' && v.targetId));
    if (quorum && votes.length < quorum) {
      return {
        winners: [],
        winningSubmissionIds: [],
        consensusTrace: { policy, settlement, reason: 'quorum_not_met', quorum, votes: votes.length },
        finalArtifact: null
      };
    }

    for (const vote of votes) {
      const sid = vote.submissionId ?? (vote.targetType === 'SUBMISSION' ? vote.targetId : undefined);
      if (!sid) continue;

      let weight = 1;
      if (weightMode === 'explicit') weight = vote.weight ?? 1;
      if (weightMode === 'reputation') weight = input.reputation(vote.agentId);

      // score should be +1 (YES) or -1 (NO); clamp to [-1,1] to avoid weirdness.
      const s = Math.max(-1, Math.min(1, vote.score ?? 0));
      scores[sid] = (scores[sid] || 0) + s * weight;
      voteCounts[sid] = (voteCounts[sid] || 0) + 1;
    }

    // rank submissions by score desc
    const ranked = input.submissions
      .map((sub) => ({ sub, score: scores[sub.id] || 0, votes: voteCounts[sub.id] || 0 }))
      .sort((a, b) => {
        if (b.score === a.score) {
          if (tieBreak === 'confidence') return b.sub.confidence - a.sub.confidence;
          // default earliest
          return Date.parse(a.sub.submittedAt) - Date.parse(b.sub.submittedAt);
        }
        return b.score - a.score;
      });

    const best = ranked[0];
    const second = ranked[1];
    const margin = second ? best.score - second.score : best.score;

    if (!best || best.votes === 0) {
      return {
        winners: [],
        winningSubmissionIds: [],
        consensusTrace: { policy, settlement, reason: 'no_votes', scores, voteCounts },
        finalArtifact: null
      };
    }

    if (best.score < minScore || margin < minMargin) {
      return {
        winners: [],
        winningSubmissionIds: [],
        consensusTrace: { policy, settlement, reason: 'threshold_not_met', minScore, minMargin, best: best.score, margin, scores, voteCounts },
        finalArtifact: null
      };
    }

    if (settlement === 'oracle' || tieBreak === 'arbiter') {
      // Oracle / arbiter settlement: allow manual finalization, otherwise provide a recommendation.
      if (input.manualWinnerAgentIds && input.manualWinnerAgentIds.length) {
        return {
          winners: input.manualWinnerAgentIds,
          winningSubmissionIds: input.manualSubmissionId ? [input.manualSubmissionId] : [],
          consensusTrace: {
            policy,
            settlement,
            mode: 'manual',
            recommendedSubmissionId: best.sub.id,
            recommendedAgentId: best.sub.agentId,
            scores,
            voteCounts
          },
          finalArtifact: findArtifact(input, input.manualSubmissionId)
        };
      }
      return {
        winners: [],
        winningSubmissionIds: [],
        consensusTrace: { policy, settlement, mode: 'awaiting_oracle', recommendedSubmissionId: best.sub.id, recommendedAgentId: best.sub.agentId, scores, voteCounts },
        finalArtifact: null
      };
    }

    return {
      winners: [best.sub.agentId],
      winningSubmissionIds: [best.sub.id],
      consensusTrace: { policy, settlement, scores, voteCounts, minScore, minMargin, tieBreak },
      finalArtifact: best.sub.artifacts
    };
  }

  if (policy === 'HIGHEST_CONFIDENCE_SINGLE') {
    const minConfidence = input.job.consensusPolicy.minConfidence ?? 0;
    const sorted = [...input.submissions]
      .filter((sub) => sub.confidence >= minConfidence)
      .sort((a, b) => {
        if (b.confidence === a.confidence) {
          return Date.parse(a.submittedAt) - Date.parse(b.submittedAt);
        }
        return b.confidence - a.confidence;
      });
    const winner = sorted[0];
    if (!winner) {
      return {
        winners: [],
        winningSubmissionIds: [],
        consensusTrace: { policy, reason: 'min_confidence_not_met', minConfidence },
        finalArtifact: null
      };
    }
    return {
      winners: [winner.agentId],
      winningSubmissionIds: [winner.id],
      consensusTrace: { policy, minConfidence, method: 'highest_confidence' },
      finalArtifact: winner.artifacts
    };
  }

  if (policy === 'TOP_K_SPLIT') {
    const ordering = input.job.consensusPolicy.ordering ?? 'confidence';
    const topK = Math.max(1, input.job.consensusPolicy.topK ?? 2);
    const scores: Record<string, number> = {};

    if (ordering === 'score') {
      for (const vote of input.votes) {
        if (!vote.submissionId) continue;
        const weight = vote.weight ?? vote.score ?? 1;
        scores[vote.submissionId] = (scores[vote.submissionId] || 0) + (vote.score ?? 1) * weight;
      }
    }

    const ranked = input.submissions
      .map((sub) => ({
        submission: sub,
        metric: ordering === 'score' ? scores[sub.id] || 0 : sub.confidence
      }))
      .sort((a, b) => {
        if (b.metric === a.metric) {
          return Date.parse(a.submission.submittedAt) - Date.parse(b.submission.submittedAt);
        }
        return b.metric - a.metric;
      })
      .slice(0, topK);

    if (!ranked.length) {
      return {
        winners: [],
        winningSubmissionIds: [],
        consensusTrace: { policy, ordering, topK, reason: 'no_submissions' },
        finalArtifact: null
      };
    }

    return {
      winners: ranked.map((entry) => entry.submission.agentId),
      winningSubmissionIds: ranked.map((entry) => entry.submission.id),
      consensusTrace: { policy, ordering, topK, scores },
      finalArtifact: ranked[0].submission.artifacts
    };
  }

  const quorum = input.job.consensusPolicy.quorum;
  if (quorum && input.votes.length < quorum) {
    return {
      winners: [],
      winningSubmissionIds: [],
      consensusTrace: { policy, reason: 'quorum_not_met', quorum, votes: input.votes.length },
      finalArtifact: null
    };
  }

  const scores: Record<string, number> = {};
  const voteCounts: Record<string, number> = {};

  for (const vote of input.votes) {
    let weight = 1;
    if (policy === 'WEIGHTED_REPUTATION') {
      weight = input.reputation(vote.agentId);
    } else if (policy === 'WEIGHTED_VOTE_SIMPLE') {
      weight = vote.weight ?? vote.score ?? 1;
    }
    if (vote.submissionId) {
      scores[vote.submissionId] = (scores[vote.submissionId] || 0) + (vote.score ?? 1) * weight;
      voteCounts[vote.submissionId] = (voteCounts[vote.submissionId] || 0) + 1;
    }
  }

  const best = input.submissions
    .map((sub) => ({
      submission: sub,
      score: scores[sub.id] || 0,
      votes: voteCounts[sub.id] || 0
    }))
    .sort((a, b) => {
      if (b.score === a.score) {
        return Date.parse(a.submission.submittedAt) - Date.parse(b.submission.submittedAt);
      }
      return b.score - a.score;
    })[0];

  return {
    winners: [best.submission.agentId],
    winningSubmissionIds: [best.submission.id],
    consensusTrace: { policy, scores, voteCounts },
    finalArtifact: best.submission.artifacts
  };
}

function findArtifact(input: ConsensusInput, submissionId?: string): Record<string, unknown> | null {
  if (!submissionId) return null;
  const match = input.submissions.find((sub) => sub.id === submissionId);
  return match?.artifacts || null;
}

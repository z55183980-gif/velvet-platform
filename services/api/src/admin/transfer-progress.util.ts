export type TransferOrchestrationStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled';

export type TransferTranscodeStatus =
  | 'pending'
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export type TransferProgressPhase =
  | 'queued'
  | 'transferring'
  | 'transcoding'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** Combine download orchestration with live per-episode transcode states. */
export function deriveTransferProgress(
  transferStatus: TransferOrchestrationStatus,
  states: TransferTranscodeStatus[],
) {
  const transcode = {
    total: states.length,
    pending: states.filter((status) => status === 'pending').length,
    queued: states.filter((status) => status === 'queued').length,
    processing: states.filter((status) => status === 'processing').length,
    completed: states.filter((status) => status === 'completed').length,
    failed: states.filter((status) => status === 'failed').length,
    settled:
      states.length > 0 &&
      states.every((status) => status === 'completed' || status === 'failed'),
  };
  const transcodeInFlight = transcode.total > 0 && !transcode.settled;
  let status: TransferOrchestrationStatus = transferStatus;
  if (
    (transferStatus === 'completed' || transferStatus === 'failed') &&
    transcodeInFlight
  ) {
    status = 'running';
  } else if (transcode.settled && transcode.failed > 0) {
    status = 'failed';
  }
  const phase: TransferProgressPhase =
    transferStatus === 'cancelled'
      ? 'cancelled'
      : transferStatus === 'queued'
        ? 'queued'
        : transferStatus === 'running' || transferStatus === 'cancel_requested'
          ? 'transferring'
          : transcodeInFlight
            ? 'transcoding'
            : transferStatus === 'failed' || transcode.failed > 0
              ? 'failed'
              : 'completed';

  return { status, phase, transcode };
}

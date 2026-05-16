export type DepositPaymentPhase = 'waiting' | 'processing' | 'processed' | 'failed';

const PROCESSING_STATUSES = new Set([
  'confirming',
  'confirmed',
  'sending',
  'partially_paid',
  'processing',
]);

const FAILED_STATUSES = new Set(['failed', 'refunded', 'expired']);

export function mapDepositPaymentPhase(
  status: string | null | undefined,
  ledgerCredited?: boolean
): DepositPaymentPhase {
  if (ledgerCredited) return 'processed';
  const st = String(status || 'waiting').toLowerCase();
  if (FAILED_STATUSES.has(st)) return 'failed';
  if (st === 'finished') return 'processed';
  if (PROCESSING_STATUSES.has(st)) return 'processing';
  return 'waiting';
}

export const DEPOSIT_PHASE_LABELS: Record<DepositPaymentPhase, string> = {
  waiting: 'Waiting',
  processing: 'Processing',
  processed: 'Processed',
  failed: 'Failed',
};

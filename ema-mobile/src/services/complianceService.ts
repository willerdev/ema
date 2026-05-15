import { ComplianceProfilePayload, ComplianceProfileResponse } from '../types';
import { api } from './api';

export const complianceService = {
  getProfile: () => api.get<ComplianceProfileResponse>('/compliance/profile'),
  saveProfile: (payload: ComplianceProfilePayload) =>
    api.put<ComplianceProfileResponse>('/compliance/profile', payload),
};

export const COMPLIANCE_REQUIRED_CODE = 'COMPLIANCE_PROFILE_REQUIRED';

export function isComplianceRequiredError(error: unknown): boolean {
  const e = error as Error & { code?: string; status?: number };
  return e?.code === COMPLIANCE_REQUIRED_CODE || (e?.status === 403 && /compliance profile/i.test(String(e.message)));
}

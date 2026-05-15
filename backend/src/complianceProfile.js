const SOURCE_OF_FUNDS = ['employment', 'business', 'savings', 'investment_returns', 'inheritance', 'other'];
const INVESTMENT_DURATIONS = ['under_1y', '1_3y', '3_5y', 'over_5y'];

function trimStr(v) {
  return v != null ? String(v).trim() : '';
}

function validateCompliancePayload(body) {
  const errors = [];
  const legalFirstName = trimStr(body.legalFirstName ?? body.legal_first_name);
  const legalLastName = trimStr(body.legalLastName ?? body.legal_last_name);
  const country = trimStr(body.country);
  const profession = trimStr(body.profession);
  const sourceOfFunds = trimStr(body.sourceOfFunds ?? body.source_of_funds).toLowerCase();
  const sourceOfFundsDetail = trimStr(body.sourceOfFundsDetail ?? body.source_of_funds_detail);
  const plannedAmount = Number(body.plannedInvestmentAmount ?? body.planned_investment_amount);
  const plannedCurrency = trimStr(
    body.plannedInvestmentCurrency ?? body.planned_investment_currency ?? 'usd'
  ).toLowerCase();
  const plannedDuration = trimStr(body.plannedInvestmentDuration ?? body.planned_investment_duration).toLowerCase();
  const dateOfBirth = trimStr(body.dateOfBirth ?? body.date_of_birth) || null;
  const phone = trimStr(body.phone) || null;
  const addressLine = trimStr(body.addressLine ?? body.address_line) || null;
  const city = trimStr(body.city) || null;
  const acceptedTerms = Boolean(body.acceptedTerms ?? body.accept_terms);

  if (!legalFirstName) errors.push('legalFirstName is required');
  if (!legalLastName) errors.push('legalLastName is required');
  if (!country) errors.push('country is required');
  if (!profession) errors.push('profession is required');
  if (!SOURCE_OF_FUNDS.includes(sourceOfFunds)) errors.push('sourceOfFunds is invalid');
  if (sourceOfFunds === 'other' && !sourceOfFundsDetail) errors.push('sourceOfFundsDetail is required when source is other');
  if (!Number.isFinite(plannedAmount) || plannedAmount <= 0) errors.push('plannedInvestmentAmount must be greater than 0');
  if (!INVESTMENT_DURATIONS.includes(plannedDuration)) errors.push('plannedInvestmentDuration is invalid');
  if (!acceptedTerms) errors.push('acceptedTerms must be true');

  if (dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
    errors.push('dateOfBirth must be YYYY-MM-DD');
  }

  const normalized = {
    legal_first_name: legalFirstName,
    legal_last_name: legalLastName,
    country,
    profession,
    source_of_funds: sourceOfFunds,
    source_of_funds_detail: sourceOfFunds === 'other' ? sourceOfFundsDetail : sourceOfFundsDetail || null,
    planned_investment_amount: Number.isFinite(plannedAmount) ? plannedAmount : null,
    planned_investment_currency: plannedCurrency || 'usd',
    planned_investment_duration: plannedDuration,
    date_of_birth: dateOfBirth,
    phone,
    address_line: addressLine,
    city,
    accepted_terms_at: acceptedTerms ? new Date().toISOString() : null,
  };

  return { ok: errors.length === 0, errors, normalized };
}

function isComplianceProfileComplete(row) {
  if (!row) return false;
  return row.completed_at != null;
}

function toPublicComplianceProfile(row) {
  if (!row) return null;
  return {
    legalFirstName: row.legal_first_name,
    legalLastName: row.legal_last_name,
    country: row.country,
    profession: row.profession,
    sourceOfFunds: row.source_of_funds,
    sourceOfFundsDetail: row.source_of_funds_detail,
    plannedInvestmentAmount: row.planned_investment_amount != null ? Number(row.planned_investment_amount) : null,
    plannedInvestmentCurrency: row.planned_investment_currency,
    plannedInvestmentDuration: row.planned_investment_duration,
    dateOfBirth: row.date_of_birth,
    phone: row.phone,
    addressLine: row.address_line,
    city: row.city,
    acceptedTermsAt: row.accepted_terms_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  };
}

module.exports = {
  SOURCE_OF_FUNDS,
  INVESTMENT_DURATIONS,
  validateCompliancePayload,
  isComplianceProfileComplete,
  toPublicComplianceProfile,
};

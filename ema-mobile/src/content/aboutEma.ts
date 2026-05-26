export type AboutSectionKey = 'who' | 'what' | 'profit';

export const PREMIUM_ALERTS_TERMS =
  'Optional SMS and email alerts for completed deposits and withdrawals cost $2 per week while enabled. You may turn alerts off anytime in Settings; fees already charged for the current week are not refunded. Alerts require a valid phone (SMS) and account email (email). Message and data rates from your carrier may apply.';

export const ABOUT_EMA: Record<
  AboutSectionKey,
  { title: string; subtitle: string; paragraphs: string[] }
> = {
  who: {
    title: 'Who we are',
    subtitle: 'DAO · token holders · community capital',
    paragraphs: [
      'Airfarms is built as a decentralized autonomous organization (DAO). Governance and strategic direction are influenced by token holders who participate in platform decisions and share in long-term outcomes.',
      'We aggregate member capital into diversified programs: crypto treasury management, structured yield (airfarming and contracts), and expert-managed trading on connected MT5 accounts.',
      'Income is generated on daily or monthly cycles depending on the product you choose. Each program publishes its rhythm and risk profile before you allocate funds.',
      'Token holders align incentives with transparent reporting, risk limits, and policies approved through the community framework—not opaque promises.',
      'We are not a bank. You remain responsible for due diligence, tax reporting, and only deploying capital you can afford to lose.',
    ],
  },
  what: {
    title: 'What we do',
    subtitle: 'Products and safeguards in one app',
    paragraphs: [
      'Unified crypto wallet: deposits and withdrawals with compliance checks and whitelisted withdrawal addresses.',
      'Expert Account Manager: connect MT5, set risk per trade, drawdown caps, news and swing preferences, then enable managed execution within your limits.',
      'Trading hub: broker-linked forex (Alpaca), airfarming yield events, and contract accrual products—each with its own balance and rules.',
      'Security: two-factor authentication, AML review on withdrawals, and clear notices that we never call or text you to move funds.',
      'Our role is to provide infrastructure, risk tooling, and fee-transparent access to strategies—not to guarantee returns.',
    ],
  },
  profit: {
    title: 'How we profit',
    subtitle: 'Fees disclosed before you confirm',
    paragraphs: [
      'We retain up to 10% of net revenues from investment programs and trading profits generated on the platform, after strategy costs where applicable.',
      'Service fees apply to financial market access, premium features, and certain trading operations executed through integrated brokers and payment rails.',
      'Optional deposit and withdrawal SMS or email alerts are billed at $2 per week when you enable them in Settings. You choose the channels; charges recur weekly while the subscription stays on.',
      'Withdrawal processing fees may apply on outbound crypto transfers, as shown before you confirm a payout.',
      'Fee schedules can vary by product; amounts are presented in-app prior to commitment. Token-holder governance may adjust fee parameters over time.',
      'We do not profit from holding your assets outside these disclosed mechanisms, and we do not solicit off-app transfers.',
    ],
  },
};

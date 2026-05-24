import type {
  NowpaymentsCreateDepositResponse,
  RootStackParamList,
  TransactionHistoryTab,
  WalletActivityRow,
} from '../types';

type NavLike = {
  getParent: () => NavLike | undefined;
  navigate: (name: string, params?: object) => void;
};

/** Walk up navigators until we reach the root stack (parent of tab navigator). */
function getRootNavigation(navigation: NavLike): NavLike {
  let current: NavLike = navigation;
  let parent = current.getParent();
  while (parent?.getParent()) {
    current = parent;
    parent = current.getParent();
  }
  return parent ?? current;
}

export function navigateToTransactionHistory(
  navigation: NavLike,
  initialTab?: TransactionHistoryTab
) {
  const root = getRootNavigation(navigation);
  root.navigate('TransactionHistory', initialTab ? { initialTab } : undefined);
}

export function navigateToTransactionDetail(navigation: NavLike, row: WalletActivityRow) {
  const root = getRootNavigation(navigation);
  root.navigate('TransactionDetail', { row });
}

export function navigateToCryptoDepositPayment(
  navigation: NavLike,
  deposit: NowpaymentsCreateDepositResponse
) {
  const root = getRootNavigation(navigation);
  root.navigate('CryptoDepositPayment', { deposit });
}

export function navigateToSupport(
  navigation: NavLike,
  params?: RootStackParamList['Support']
) {
  const root = getRootNavigation(navigation);
  root.navigate('Support', params);
}

export function navigateToSendById(navigation: NavLike) {
  navigation.navigate('Extra', { screen: 'SendById' });
}

export function navigateToAirfarmingTrade(navigation: NavLike) {
  getRootNavigation(navigation).navigate('AirfarmingTrade');
}

export function navigateToVipFarmersTrade(navigation: NavLike) {
  getRootNavigation(navigation).navigate('VipFarmersTrade');
}

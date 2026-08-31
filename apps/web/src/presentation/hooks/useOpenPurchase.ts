// React binding over the open-purchase store. The store itself lives in
// infrastructure (`api/openPurchaseStore`) because AuthContext has to reset it
// on sign-out and infrastructure must not import from presentation.
import { useEffect, useState } from 'react';
import {
  getOpenPurchaseSnapshot,
  isOpenPurchaseLoading,
  refreshOpenPurchase,
  subscribeOpenPurchase,
  type OpenPurchaseState,
} from '../../infrastructure/api/openPurchaseStore';

export { refreshOpenPurchase };
export type { OpenPurchaseState };

export function useOpenPurchase(): OpenPurchaseState {
  const [value, setValue] = useState<OpenPurchaseState>(getOpenPurchaseSnapshot);
  useEffect(() => {
    const unsubscribe = subscribeOpenPurchase(setValue);
    // First consumer to mount triggers the read; the rest ride the same promise.
    if (getOpenPurchaseSnapshot() === undefined && !isOpenPurchaseLoading()) {
      void refreshOpenPurchase();
    }
    return unsubscribe;
  }, []);
  return value;
}

// React binding over the open-purchase store. The store itself lives in
// infrastructure (`api/openPurchaseStore`) because AuthContext has to reset it
// on sign-out and infrastructure must not import from presentation.
import { useEffect, useState } from 'react';
import {
  getOpenPurchaseSnapshot,
  getOpenPurchaseVerdict,
  subscribeOpenPurchaseVerdict,
  isOpenPurchaseLoading,
  refreshOpenPurchase,
  subscribeOpenPurchase,
  type OpenPurchaseState,
} from '../../infrastructure/api/openPurchaseStore';

import type { PurchaseVerdict } from '../../infrastructure/api/purchaseStatusClient';

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

/** The live diagnosis for `txnId`, or null. Subscribes to the store's verdict
 *  channel so a diagnosis made in the modal reaches the navbar pill without a
 *  remount. */
export function useOpenPurchaseVerdict(txnId: string | null): PurchaseVerdict | null {
  const [v, setV] = useState<PurchaseVerdict | null>(() => (txnId ? getOpenPurchaseVerdict(txnId) : null));
  useEffect(() => {
    const read = () => setV(txnId ? getOpenPurchaseVerdict(txnId) : null);
    read();
    return subscribeOpenPurchaseVerdict(read);
  }, [txnId]);
  return v;
}

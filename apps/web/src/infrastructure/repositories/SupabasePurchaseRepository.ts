// Supabase implementation of IPurchaseRepository.
//
// RLS handles row-level scoping: the `purchases` table has a SELECT policy
// `auth.uid() = user_id`. We never pass a user id to the query — the JWT
// in the active session is the authority.

import { supabase } from '../supabase/client';
import {
  IPurchaseRepository,
  OPEN_PURCHASE_MAX_AGE_MS,
  OPEN_PURCHASE_STATUSES,
  Purchase,
  PurchaseStatus,
} from '../../domain/repositories/IPurchaseRepository';

interface PurchaseRow {
  id: string;
  payment_reference: string | null;
  amount_taka: number;
  observed_amount_taka: number | null;
  credits_granted: number;
  status: string;
  created_at: string;
}

function toDomain(row: PurchaseRow): Purchase {
  return {
    id: row.id,
    paymentReference: row.payment_reference,
    amountTaka: row.amount_taka,
    observedAmountTaka: row.observed_amount_taka,
    creditsGranted: row.credits_granted,
    status: row.status as PurchaseStatus,
    createdAt: row.created_at,
  };
}

export class SupabasePurchaseRepository implements IPurchaseRepository {
  async listMyPurchases(limit = 20): Promise<Purchase[]> {
    const { data, error } = await supabase
      .from('purchases')
      .select('id, payment_reference, amount_taka, observed_amount_taka, credits_granted, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) {
      // Surface the error to the caller — letting it swallow silently was
      // the bug PurchaseHistorySection used to ship with.
      throw new Error(`Failed to load purchases: ${error.message}`);
    }
    return ((data ?? []) as PurchaseRow[]).map(toDomain);
  }

  async getOpenPurchase(): Promise<Purchase | null> {
    const since = new Date(Date.now() - OPEN_PURCHASE_MAX_AGE_MS).toISOString();
    const { data, error } = await supabase
      .from('purchases')
      .select('id, payment_reference, amount_taka, observed_amount_taka, credits_granted, status, created_at')
      .in('status', OPEN_PURCHASE_STATUSES)
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw new Error(`Failed to load open purchase: ${error.message}`);
    const row = (data ?? [])[0] as PurchaseRow | undefined;
    // A row with no payment_reference cannot be tracked or verified — every
    // lookup downstream is keyed on the TrxID — so it is not resumable.
    if (!row || !row.payment_reference) return null;
    return toDomain(row);
  }
}

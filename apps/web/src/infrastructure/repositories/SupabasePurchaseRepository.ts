// Supabase implementation of IPurchaseRepository.
//
// RLS handles row-level scoping: the `purchases` table has a SELECT policy
// `auth.uid() = user_id`. We never pass a user id to the query — the JWT
// in the active session is the authority.

import { supabase } from '../supabase/client';
import {
  IPurchaseRepository,
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
}

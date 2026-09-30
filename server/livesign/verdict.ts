/**
 * Turns LiveSign's envelope details (GET /api/Envelopes/{id}) into our per-person
 * verification status. Pure, so it can be unit-tested.
 */

export type PersonStatus = 'unverified' | 'verified' | 'failed' | 'needs_review';

/** A person counts as verified as soon as their LiveSign identity check passes with nothing flagged. */
export function personStatusFromCustomer(c: any): PersonStatus {
  if (!c) return 'unverified';
  if (c.voiReviewStatus === 'Rejected' || c.voiOutcome === 'Failed') return 'failed';
  if (c.voiReviewStatus === 'Approved') return 'verified';
  if (c.hasFlaggedItems) return 'needs_review';
  if (c.voiOutcome === 'Passed') return 'verified';
  return 'unverified';
}

/** Overall status of a form: verified only when every person is verified. */
export function overallStatus(statuses: PersonStatus[]): PersonStatus {
  if (!statuses.length) return 'unverified';
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('needs_review')) return 'needs_review';
  if (statuses.every(s => s === 'verified')) return 'verified';
  return 'unverified';
}

/** The LiveSign customers that represent people on the form (not deleted, not company owners). */
export function envelopeCustomers(envelope: any): any[] {
  return (Array.isArray(envelope?.customers) ? envelope.customers : []).filter((c: any) => c && !c.isDeleted && !c.isUbo);
}

/**
 * Finds the LiveSign customer for one of our people: by the saved customer id, then by the
 * index we sent (1-based position on the form), then by email + name.
 */
export function findCustomer(customers: any[], person: { livesign_customer_id?: string | null; party_index: number; email?: string; full_name?: string }) {
  if (person.livesign_customer_id) {
    const byId = customers.find(c => c.id === person.livesign_customer_id);
    if (byId) return byId;
  }
  const byIndex = customers.find(c => Number(c.index) === person.party_index + 1);
  if (byIndex) return byIndex;
  const email = (person.email || '').trim().toLowerCase();
  const name = (person.full_name || '').trim().toLowerCase();
  return customers.find(c =>
    email && String(c.emailAddress || '').toLowerCase() === email &&
    (!name || `${c.firstName || ''} ${c.lastName || ''}`.trim().toLowerCase() === name.replace(/\s+/g, ' ')));
}

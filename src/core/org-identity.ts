/**
 * The legal and banking identity printed on invoices and other documents.
 *
 * This used to be a pair of module-level constants naming one real company —
 * its address, IČO, DIČ, phone, mailbox and IBAN — with environment variables
 * as an optional override. On a shared server that means every tenant's invoice
 * carries the same bank account, and guests pay the wrong company.
 *
 * Values come from the organization record. Environment variables are still
 * honoured so an existing single-tenant deployment keeps working until its
 * owner fills in Settings → General.
 */
import { getSql } from './db/async.ts';
import { requireOrganizationId } from './auth/tenant-context.ts';

export interface OrgIdentity {
  name: string;
  legalAddress: string;
  registrationNo: string;
  vatNo: string;
  isVatPayer: boolean;
  phone: string;
  email: string;
  website: string;
  bankName: string;
  bankAccount: string;
  iban: string;
  swift: string;
}

const EMPTY: OrgIdentity = {
  name: '', legalAddress: '', registrationNo: '', vatNo: '', isVatPayer: false,
  phone: '', email: '', website: '', bankName: '', bankAccount: '', iban: '', swift: '',
};

/**
 * Whose identity goes on the document.
 *
 * Without an explicit id this used to take the FIRST organization by creation
 * date — so on a shared server the second hotel's invoices carried the first
 * hotel's company name, IČO and bank account, and its guests paid the wrong
 * company. It now asks the ambient tenant context, which every session-guarded
 * handler sets, and which still resolves a single-organization install without
 * anyone passing anything.
 */
export async function getOrgIdentity(organizationId?: string): Promise<OrgIdentity> {
  let row: any;
  try {
    const sql = getSql();
    const orgId = organizationId || await requireOrganizationId();
    row = await sql.row<any>('SELECT * FROM organizations WHERE id = ?', [orgId]);
  } catch {
    row = undefined;
  }

  let phone = '';
  try {
    const sql = getSql();
    const prop = await sql.row<any>('SELECT phone FROM properties WHERE organization_id = ? ORDER BY created_at LIMIT 1', [row?.id ?? organizationId ?? '']) as { phone?: string } | undefined;
    phone = prop?.phone ?? '';
  } catch {
    /* property is optional */
  }

  if (!row) return { ...EMPTY, phone };

  const env = process.env;
  return {
    name: row.legal_name || row.name || '',
    legalAddress: row.legal_address || '',
    registrationNo: row.registration_no || '',
    vatNo: row.vat_no || '',
    isVatPayer: !!row.is_vat_payer,
    phone,
    email: row.invoice_email || '',
    website: row.website || '',
    bankName: row.bank_name || env.BANK_NAME || '',
    bankAccount: row.bank_account || env.BANK_ACCOUNT || '',
    iban: row.iban || env.BANK_IBAN || '',
    swift: row.swift || env.BANK_BIC || '',
  };
}

/** Which required document fields are still blank — surfaces as a setup warning. */
export function missingInvoiceFields(id: OrgIdentity): string[] {
  const missing: string[] = [];
  if (!id.name) missing.push('юридична назва');
  if (!id.legalAddress) missing.push('юридична адреса');
  if (!id.registrationNo) missing.push('IČO');
  if (!id.iban && !id.bankAccount) missing.push('банківський рахунок');
  return missing;
}

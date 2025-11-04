import type { MailingListExportJobPayload, MailingListExportStatus } from '@shared/types';

import type { ListingFilters, RegionCircle } from '@/types';
import { assertSupabaseClient } from '@/services/supabaseClient';

export interface MailingListExportJob {
  id: string;
  status: MailingListExportStatus;
  downloadUrls: { csv: string | null; xlsx: string | null };
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MailingListExportRequest {
  filters: ListingFilters;
  regions: RegionCircle[];
}

interface InvokeResponse {
  job: MailingListExportJobPayload;
}

function parseJob(payload: MailingListExportJobPayload): MailingListExportJob {
  return {
    id: payload.id,
    status: payload.status,
    downloadUrls: {
      csv: payload.downloadUrls?.csv ?? null,
      xlsx: payload.downloadUrls?.xlsx ?? null,
    },
    error: payload.error ?? null,
    createdAt: new Date(payload.createdAt),
    updatedAt: new Date(payload.updatedAt),
  };
}

export async function requestMailingListExport(
  request: MailingListExportRequest,
): Promise<MailingListExportJob> {
  const client = assertSupabaseClient();
  const { data, error } = await client.functions.invoke<InvokeResponse>('mailing-list-export', {
    body: {
      action: 'create',
      filters: request.filters,
      regions: request.regions,
    },
  });

  if (error) {
    throw error;
  }

  if (!data || typeof data !== 'object' || !data.job) {
    throw new Error('Unexpected response from mailing list export function.');
  }

  return parseJob(data.job);
}

export async function fetchMailingListExportStatus(jobId: string): Promise<MailingListExportJob> {
  const client = assertSupabaseClient();
  const { data, error } = await client.functions.invoke<InvokeResponse>('mailing-list-export', {
    body: {
      action: 'status',
      jobId,
    },
  });

  if (error) {
    throw error;
  }

  if (!data || typeof data !== 'object' || !data.job) {
    throw new Error('Unexpected response while fetching mailing list export status.');
  }

  return parseJob(data.job);
}

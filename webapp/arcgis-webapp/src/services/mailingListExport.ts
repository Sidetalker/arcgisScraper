import type { MailingListExportJobPayload, MailingListExportStatus } from '@shared/types';

import type { ListingFilters, RegionCircle } from '@/types';
async function invokeMailingListExport<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/mailing-list-export', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error('Failed to parse mailing list export response.');
    }
  }

  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
        ? payload.error
        : 'Mailing list export request failed.';
    throw new Error(message);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Unexpected response from mailing list export service.');
  }

  return payload as T;
}

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
  const data = await invokeMailingListExport<InvokeResponse>({
    action: 'create',
    filters: request.filters,
    regions: request.regions,
  });

  if (!data.job) {
    throw new Error('Unexpected response from mailing list export service.');
  }

  return parseJob(data.job);
}

export async function fetchMailingListExportStatus(jobId: string): Promise<MailingListExportJob> {
  const data = await invokeMailingListExport<InvokeResponse>({
    action: 'status',
    jobId,
  });

  if (!data.job) {
    throw new Error('Unexpected response while fetching mailing list export status.');
  }

  return parseJob(data.job);
}

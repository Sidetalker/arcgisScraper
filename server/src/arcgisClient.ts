import fetch, { Response } from 'node-fetch';
import { URLSearchParams } from 'url';

export interface Geometry {
  x: number;
  y: number;
}

export interface Feature<TAttributes extends Record<string, unknown> = Record<string, unknown>> {
  attributes: TAttributes;
  geometry?: Geometry | null;
}

export interface QueryResponse<TAttributes extends Record<string, unknown>> {
  features: Feature<TAttributes>[];
  exceededTransferLimit?: boolean;
  fields?: Array<{ name: string; type: string }>;
}

export interface FetchOptions {
  where?: string;
  outFields?: string;
  resultRecordCount?: number;
  resultOffset?: number;
  returnGeometry?: boolean;
}

export interface ArcgisClientOptions {
  layerUrl: string;
  referer: string;
}

export class ArcgisClient {
  private readonly layerUrl: string;
  private readonly referer: string;

  constructor(options: ArcgisClientOptions) {
    this.layerUrl = options.layerUrl;
    this.referer = options.referer;
  }

  async fetchAllFeatures<TAttributes extends Record<string, unknown>>(
    options: FetchOptions = {}
  ): Promise<QueryResponse<TAttributes>> {
    const result: QueryResponse<TAttributes> = {
      features: [],
    };

    let offset = options.resultOffset ?? 0;
    const pageSize = options.resultRecordCount ?? 2000;
    let hasMore = true;

    while (hasMore) {
      const page = await this.query<TAttributes>({
        ...options,
        resultOffset: offset,
        resultRecordCount: pageSize,
      });

      result.features.push(...page.features);
      if (!result.fields && page.fields) {
        result.fields = page.fields;
      }

      if (page.exceededTransferLimit) {
        offset += pageSize;
      } else {
        hasMore = false;
      }
    }

    return result;
  }

  private async query<TAttributes extends Record<string, unknown>>(
    options: FetchOptions
  ): Promise<QueryResponse<TAttributes>> {
    const params = new URLSearchParams();
    params.set('f', 'json');
    params.set('where', options.where ?? '1=1');
    params.set('outFields', options.outFields ?? '*');
    params.set('outSR', '4326');
    params.set('returnGeometry', String(options.returnGeometry ?? true));
    params.set('resultOffset', String(options.resultOffset ?? 0));
    params.set('resultRecordCount', String(options.resultRecordCount ?? 2000));

    const response = await this.fetch(`${this.layerUrl}/query?${params.toString()}`);
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`ArcGIS query failed with status ${response.status}: ${body}`);
    }

    const payload = (await response.json()) as QueryResponse<TAttributes> & {
      error?: { message?: string };
    };

    if (payload.error) {
      throw new Error(payload.error.message ?? 'Unknown ArcGIS error');
    }

    payload.features = payload.features ?? [];

    return payload;
  }

  private async fetch(url: string): Promise<Response> {
    return fetch(url, {
      headers: {
        Referer: this.referer,
      },
    });
  }
}

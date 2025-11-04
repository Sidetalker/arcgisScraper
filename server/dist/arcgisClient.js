"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArcgisClient = void 0;
const node_fetch_1 = __importDefault(require("node-fetch"));
const url_1 = require("url");
class ArcgisClient {
    constructor(options) {
        this.layerUrl = options.layerUrl;
        this.referer = options.referer;
    }
    async fetchAllFeatures(options = {}) {
        const result = {
            features: [],
        };
        let offset = options.resultOffset ?? 0;
        const pageSize = options.resultRecordCount ?? 2000;
        let hasMore = true;
        while (hasMore) {
            const page = await this.query({
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
            }
            else {
                hasMore = false;
            }
        }
        return result;
    }
    async query(options) {
        const params = new url_1.URLSearchParams();
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
        const payload = (await response.json());
        if (payload.error) {
            throw new Error(payload.error.message ?? 'Unknown ArcGIS error');
        }
        payload.features = payload.features ?? [];
        return payload;
    }
    async fetch(url) {
        return (0, node_fetch_1.default)(url, {
            headers: {
                Referer: this.referer,
            },
        });
    }
}
exports.ArcgisClient = ArcgisClient;

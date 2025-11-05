import process from 'node:process';

process.env.REFRESH_METRICS_ENVIRONMENT = 'staging';
await import('./computeListingAggregates.mjs');

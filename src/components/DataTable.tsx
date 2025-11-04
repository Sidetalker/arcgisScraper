import { useMemo } from 'react';
import type { ArcGisFeature } from '../types';

interface DataTableProps {
  features: ArcGisFeature[];
  fields: string[];
  maxRows?: number;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

export function DataTable({ features, fields, maxRows = 500 }: DataTableProps) {
  const limitedFeatures = useMemo(() => {
    if (features.length <= maxRows) {
      return features;
    }
    return features.slice(0, maxRows);
  }, [features, maxRows]);

  if (fields.length === 0) {
    return <div className="empty-state">Select at least one field to view data in the table.</div>;
  }

  if (features.length === 0) {
    return <div className="empty-state">No features match the current filters.</div>;
  }

  return (
    <div className="table-wrapper">
      <table>
        <thead>
          <tr>
            {fields.map((field) => (
              <th key={field}>{field}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {limitedFeatures.map((feature, index) => {
            const key =
              (feature.attributes.OBJECTID as string | number | undefined) ??
              (feature.attributes.Schno as string | number | undefined) ??
              index;
            return (
              <tr key={key}>
                {fields.map((field) => (
                  <td key={field}>{formatValue(feature.attributes[field])}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {features.length > limitedFeatures.length ? (
        <div className="status-bar" style={{ padding: '0.75rem 1rem' }}>
          Showing {limitedFeatures.length} of {features.length} results. Adjust filters or export the
          dataset to inspect more rows.
        </div>
      ) : null}
    </div>
  );
}

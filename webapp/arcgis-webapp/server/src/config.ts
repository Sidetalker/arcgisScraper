import path from 'path';
import fs from 'fs';

export interface AppConfig {
  layerUrl: string;
  portalUrl: string;
  port: number;
  referer: string;
  sheetsDocId: string;
  complexGid: string;
  ownerGid: string;
}

const DEFAULT_LAYER_URL =
  'https://services6.arcgis.com/dmNYNuTJZDtkcRJq/arcgis/rest/services/STR_Licenses_October_2025_public_view_layer/FeatureServer/0';

const DEFAULT_PORTAL_URL = 'https://summitcountyco.maps.arcgis.com';
const DEFAULT_REFERER =
  'https://experience.arcgis.com/experience/706a6886322445479abadb904db00bc0/';
const DEFAULT_SHEETS_DOC_ID = '1kKuIBG3BQTKu3uiH3lcOg9o-fUJ79440FldeFO5gho0';
const DEFAULT_COMPLEX_GID = '2088119676';
const DEFAULT_OWNER_GID = '521649832';

function loadEnvFile(): void {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('dotenv').config({ path: envPath });
  }
}

export function loadConfig(): AppConfig {
  loadEnvFile();

  const layerUrl = process.env.ARCGIS_LAYER_URL ?? DEFAULT_LAYER_URL;
  const portalUrl = process.env.ARCGIS_PORTAL_URL ?? DEFAULT_PORTAL_URL;
  const referer = process.env.ARCGIS_REFERER ?? DEFAULT_REFERER;
  const port = Number(process.env.PORT ?? 3000);
  const sheetsDocId = process.env.SHEETS_DOC_ID ?? DEFAULT_SHEETS_DOC_ID;
  const complexGid = process.env.SHEETS_COMPLEX_GID ?? DEFAULT_COMPLEX_GID;
  const ownerGid = process.env.SHEETS_OWNER_GID ?? DEFAULT_OWNER_GID;

  return {
    layerUrl,
    portalUrl,
    referer,
    port,
    sheetsDocId,
    complexGid,
    ownerGid,
  };
}

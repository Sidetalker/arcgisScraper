import { ArcgisClient } from './arcgisClient';
import { formatOwnerTable } from './ownerTable';
import { loadConfig } from './config';

async function run() {
  const config = loadConfig();
  const client = new ArcgisClient({ layerUrl: config.layerUrl, referer: config.referer });
  const payload = await client.fetchAllFeatures({ returnGeometry: false, resultRecordCount: 1 });
  const raw = payload.features[0];
  console.log('raw attrs keys', Object.keys(raw.attributes));
  console.log('OwnerNamesPublicHTML', raw.attributes.OwnerNamesPublicHTML);
  console.log('OwnerFullName', raw.attributes.OwnerFullName);
  console.log('OwnerContactPublicMailingAddr', raw.attributes.OwnerContactPublicMailingAddr);
  console.log('PropertyScheduleText', raw.attributes.PropertyScheduleText);
  console.log('HC_RegistrationsOriginalCleaned', raw.attributes.HC_RegistrationsOriginalCleaned);
  console.log('SitusAddress', raw.attributes.SitusAddress);
  console.log('BriefPropertyDescription', raw.attributes.BriefPropertyDescription);
  console.log('SubdivisionName', raw.attributes.SubdivisionName);
  const formatted = formatOwnerTable(payload.features);
  console.log('formatted first', formatted[0]);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

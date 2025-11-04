import { Router } from 'express';
import { ArcgisClient } from './arcgisClient';
import { buildOwnerFields, formatOwnerTable } from './ownerTable';

export interface PropertiesRouterOptions {
  client: ArcgisClient;
}

export function createPropertiesRouter(options: PropertiesRouterOptions): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const payload = await options.client.fetchAllFeatures({
        returnGeometry: true,
      });
      const formattedFeatures = formatOwnerTable(payload.features ?? []);
      res.json({
        features: formattedFeatures,
        fields: buildOwnerFields(),
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

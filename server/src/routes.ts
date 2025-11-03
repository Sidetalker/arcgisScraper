import { Router } from 'express';
import { ArcgisClient } from './arcgisClient';

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
      res.json(payload);
    } catch (error) {
      next(error);
    }
  });

  return router;
}

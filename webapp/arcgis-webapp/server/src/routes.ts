import { Router } from 'express';
import { ArcgisClient } from './arcgisClient';
import {
  createOwnerFieldDefinitions,
  formatOwnerTableFeatures,
} from './ownerTable';

export interface PropertiesRouterOptions {
  client: ArcgisClient;
  sheetsDocId: string;
  complexGid: string;
  ownerGid: string;
}

export function createPropertiesRouter(options: PropertiesRouterOptions): Router {
  const router = Router();

  router.get('/', async (_req, res, next) => {
    try {
      const payload = await options.client.fetchAllFeatures({
        returnGeometry: true,
      });
      const features = formatOwnerTableFeatures(payload.features ?? [], {
        docId: options.sheetsDocId,
        complexGid: options.complexGid,
        ownerGid: options.ownerGid,
      });
      res.json({
        features,
        fields: createOwnerFieldDefinitions(),
        exceededTransferLimit: payload.exceededTransferLimit ?? false,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

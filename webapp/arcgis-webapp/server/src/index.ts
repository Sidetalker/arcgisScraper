import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { loadConfig } from './config';
import { ArcgisClient } from './arcgisClient';
import { createPropertiesRouter } from './routes';

const config = loadConfig();

const app = express();
app.use(cors());
app.use(express.json());

const client = new ArcgisClient({
  layerUrl: config.layerUrl,
  referer: config.referer,
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use(
  '/api/properties',
  createPropertiesRouter({
    client,
    sheetsDocId: config.sheetsDocId,
    complexGid: config.complexGid,
    ownerGid: config.ownerGid,
  }),
);

const clientBuildPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientBuildPath)) {
  app.use(express.static(clientBuildPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientBuildPath, 'index.html'));
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).json({ message: err.message });
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});

import type { IncomingMessage } from 'node:http';
import type { PluginOption, ViteDevServer } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const projectRootDir = fileURLToPath(new URL('.', import.meta.url));

async function readRequestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk));
    } else {
      chunks.push(chunk);
    }
  }

  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch (error) {
    throw new Error('Invalid JSON payload.');
  }
}

function mailingListExportProxy(): PluginOption {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const functionUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/mailing-list-export` : null;

  return {
    name: 'mailing-list-export-proxy',
    configureServer(server: ViteDevServer) {
      if (!functionUrl || !serviceRoleKey) {
        server.config.logger.warn(
          '[mailing-list-export-proxy] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing. Mailing list export requests will be sent directly to the browser.',
        );
        return;
      }

      server.middlewares.use('/api/mailing-list-export', async (req, res, next) => {
        if (!req || !res) {
          next();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed.' }));
          return;
        }

        let body: Record<string, unknown>;
        try {
          body = await readRequestBody(req);
        } catch (error) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: (error as Error).message }));
          return;
        }

        try {
          const response = await fetch(functionUrl, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${serviceRoleKey}`,
              apikey: serviceRoleKey,
            },
            body: JSON.stringify(body),
          });

          const text = await response.text();
          res.statusCode = response.status;
          res.setHeader('Content-Type', 'application/json');
          res.end(text || '{}');
        } catch (error) {
          server.config.logger.warn(`Failed to forward mailing list export request: ${(error as Error).message}`);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Mailing list export request failed.' }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), mailingListExportProxy()],
  resolve: {
    alias: {
      '@': path.resolve(projectRootDir, './src'),
      '@shared': path.resolve(projectRootDir, './shared'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './vitest.setup.ts',
  },
});

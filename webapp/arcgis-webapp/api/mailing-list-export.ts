const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const FUNCTION_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/mailing-list-export` : null;

function parseBody(input: unknown): Record<string, unknown> {
  if (!input) {
    return {};
  }
  if (typeof input === 'string') {
    try {
      return JSON.parse(input) as Record<string, unknown>;
    } catch (error) {
      throw new Error('Invalid JSON payload.');
    }
  }
  if (typeof input === 'object') {
    return input as Record<string, unknown>;
  }
  throw new Error('Invalid JSON payload.');
}

async function forwardToFunction(body: Record<string, unknown>) {
  if (!FUNCTION_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Mailing list export function is not configured.');
  }

  const response = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      console.error('Failed to parse mailing list export function response', error);
    }
  }

  return { response, payload };
}

export default async function handler(
  request: { method?: string; body?: unknown },
  response: { status: (statusCode: number) => { json: (payload: unknown) => void }; json: (payload: unknown) => void },
): Promise<void> {
  if (request.method !== 'POST') {
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  let body: Record<string, unknown>;
  try {
    body = parseBody(request.body);
  } catch (error) {
    response.status(400).json({ error: (error as Error).message });
    return;
  }

  try {
    const { response: functionResponse, payload } = await forwardToFunction(body);

    if (!functionResponse.ok) {
      const message =
        payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'
          ? payload.error
          : 'Mailing list export request failed.';
      response.status(functionResponse.status).json({ error: message });
      return;
    }

    response.status(functionResponse.status).json(payload ?? {});
  } catch (error) {
    console.error('Failed to forward mailing list export request', error);
    response.status(500).json({ error: 'Mailing list export request failed.' });
  }
}

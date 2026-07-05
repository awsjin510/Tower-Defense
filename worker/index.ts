import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);
const MAX_BODY_BYTES = 64 * 1024;
const CURRENT_SEASON = 'season-0';

interface AuthenticatedPlayer {
  uid: string;
  name: string;
}

interface SavePayload {
  version: number;
  coins: number;
  workshopLevels: Record<string, number>;
  bestWave: number;
  totalRuns: number;
  totalKills: number;
  updatedAt: number;
}

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store', ...headers },
  });
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim());
  return origin && allowed.includes(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, OPTIONS',
        Vary: 'Origin',
      }
    : {};
}

async function authenticate(request: Request, env: Env): Promise<AuthenticatedPlayer> {
  if (!env.FIREBASE_PROJECT_ID) throw new Error('Firebase project is not configured');
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) throw new Error('Missing bearer token');
  const token = authorization.slice('Bearer '.length);
  const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
    audience: env.FIREBASE_PROJECT_ID,
    issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`,
  });
  if (!payload.sub) throw new Error('Token has no subject');
  const name = typeof payload.name === 'string' ? payload.name.slice(0, 30) : 'Anonymous';
  return { uid: payload.sub, name };
}

async function readBody(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('Content-Length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new RangeError('Request body is too large');
  if (!request.body) throw new SyntaxError('Missing body');
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError('Request body is too large');
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text) as unknown;
}

function finiteInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= maximum;
}

function validSave(value: unknown): value is SavePayload {
  if (!value || typeof value !== 'object') return false;
  const save = value as Partial<SavePayload>;
  if (
    !finiteInteger(save.version, 1000) ||
    !finiteInteger(save.coins, 1_000_000_000_000_000) ||
    !finiteInteger(save.bestWave, 1_000_000) ||
    !finiteInteger(save.totalRuns, 100_000_000) ||
    !finiteInteger(save.totalKills, 1_000_000_000_000) ||
    !finiteInteger(save.updatedAt, Number.MAX_SAFE_INTEGER) ||
    !save.workshopLevels ||
    typeof save.workshopLevels !== 'object' ||
    Array.isArray(save.workshopLevels)
  ) {
    return false;
  }
  const levels = Object.entries(save.workshopLevels);
  return levels.length <= 100 && levels.every(([key, level]) => key.length <= 64 && finiteInteger(level, 1_000_000));
}

async function getSave(request: Request, env: Env, player: AuthenticatedPlayer): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT save_json, revision, updated_at FROM player_saves WHERE user_id = ?'
  )
    .bind(player.uid)
    .first<{ save_json: string; revision: number; updated_at: number }>();
  if (!row) return json({ save: null, revision: 0 }, 200, corsHeaders(request, env));
  return json(
    { save: JSON.parse(row.save_json) as unknown, revision: row.revision, updatedAt: row.updated_at },
    200,
    corsHeaders(request, env)
  );
}

async function putSave(request: Request, env: Env, player: AuthenticatedPlayer): Promise<Response> {
  const body = await readBody(request);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid body' }, 400, corsHeaders(request, env));
  const { save, revision } = body as { save?: unknown; revision?: unknown };
  if (!validSave(save) || !finiteInteger(revision, Number.MAX_SAFE_INTEGER)) {
    return json({ error: 'Invalid save payload' }, 400, corsHeaders(request, env));
  }

  const now = Date.now();
  const serialized = JSON.stringify(save);
  if (revision === 0) {
    const inserted = await env.DB.prepare(
      `INSERT OR IGNORE INTO player_saves
       (user_id, save_version, revision, save_json, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, ?)`
    )
      .bind(player.uid, save.version, serialized, now, now)
      .run();
    if (inserted.meta.changes === 1) {
      return json({ revision: 1, updatedAt: now }, 200, corsHeaders(request, env));
    }
  } else {
    const updated = await env.DB.prepare(
      `UPDATE player_saves
       SET save_version = ?, revision = revision + 1, save_json = ?, updated_at = ?
       WHERE user_id = ? AND revision = ?`
    )
      .bind(save.version, serialized, now, player.uid, revision)
      .run();
    if (updated.meta.changes === 1) {
      return json({ revision: revision + 1, updatedAt: now }, 200, corsHeaders(request, env));
    }
  }

  const current = await env.DB.prepare('SELECT revision, save_json FROM player_saves WHERE user_id = ?')
    .bind(player.uid)
    .first<{ revision: number; save_json: string }>();
  return json(
    { error: 'Save conflict', revision: current?.revision ?? 0, save: current ? JSON.parse(current.save_json) : null },
    409,
    corsHeaders(request, env)
  );
}

async function submitRun(request: Request, env: Env, player: AuthenticatedPlayer): Promise<Response> {
  const body = await readBody(request);
  if (!body || typeof body !== 'object') return json({ error: 'Invalid body' }, 400, corsHeaders(request, env));
  const result = body as { runId?: unknown; wave?: unknown; kills?: unknown; durationMs?: unknown };
  if (
    typeof result.runId !== 'string' ||
    !/^[0-9a-f-]{36}$/.test(result.runId) ||
    !finiteInteger(result.wave, 1_000_000) ||
    !finiteInteger(result.kills, 1_000_000_000) ||
    !finiteInteger(result.durationMs, 7 * 24 * 60 * 60 * 1000) ||
    Number(result.durationMs) < 1_000
  ) {
    return json({ error: 'Invalid run result' }, 400, corsHeaders(request, env));
  }
  const now = Date.now();
  const session = await env.DB.prepare(
    `UPDATE run_sessions SET completed_at = ?
     WHERE run_id = ? AND user_id = ? AND completed_at IS NULL
       AND started_at <= ? AND started_at >= ?`
  )
    .bind(now, result.runId, player.uid, now - Number(result.durationMs) + 10_000, now - 7 * 24 * 60 * 60 * 1000)
    .run();
  if (session.meta.changes !== 1) {
    return json({ error: 'Invalid or already submitted run' }, 409, corsHeaders(request, env));
  }
  await env.DB.prepare(
    `INSERT INTO leaderboard (season_id, user_id, player_name, best_wave, total_runs, updated_at)
     VALUES (?, ?, ?, ?, 1, ?)
     ON CONFLICT(season_id, user_id) DO UPDATE SET
       player_name = excluded.player_name,
       best_wave = MAX(leaderboard.best_wave, excluded.best_wave),
       total_runs = leaderboard.total_runs + 1,
       updated_at = excluded.updated_at`
  )
    .bind(CURRENT_SEASON, player.uid, player.name, result.wave, now)
    .run();
  return json({ accepted: true }, 200, corsHeaders(request, env));
}

async function startRun(request: Request, env: Env, player: AuthenticatedPlayer): Promise<Response> {
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  await env.DB.prepare('INSERT INTO run_sessions (run_id, user_id, started_at) VALUES (?, ?, ?)')
    .bind(runId, player.uid, startedAt)
    .run();
  return json({ runId, startedAt }, 201, corsHeaders(request, env));
}

async function leaderboard(request: Request, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT player_name AS playerName, best_wave AS bestWave, total_runs AS totalRuns
     FROM leaderboard WHERE season_id = ?
     ORDER BY best_wave DESC, updated_at ASC LIMIT 100`
  )
    .bind(CURRENT_SEASON)
    .all<{ playerName: string; bestWave: number; totalRuns: number }>();
  return json({ season: CURRENT_SEASON, entries: rows.results }, 200, corsHeaders(request, env));
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (url.pathname === '/health' && request.method === 'GET') {
      return json({ ok: true, environment: env.ENVIRONMENT }, 200, cors);
    }
    if (url.pathname === '/v1/leaderboard' && request.method === 'GET') return leaderboard(request, env);

    let player: AuthenticatedPlayer;
    try {
      player = await authenticate(request, env);
    } catch {
      return json({ error: 'Unauthorized' }, 401, cors);
    }

    try {
      if (url.pathname === '/v1/save' && request.method === 'GET') return getSave(request, env, player);
      if (url.pathname === '/v1/save' && request.method === 'PUT') return putSave(request, env, player);
      if (url.pathname === '/v1/run/start' && request.method === 'POST') return startRun(request, env, player);
      if (url.pathname === '/v1/run-result' && request.method === 'POST') return submitRun(request, env, player);
      return json({ error: 'Not found' }, 404, cors);
    } catch (error) {
      if (error instanceof RangeError) return json({ error: error.message }, 413, cors);
      if (error instanceof SyntaxError) return json({ error: 'Malformed JSON' }, 400, cors);
      console.error(JSON.stringify({ event: 'request_failed', path: url.pathname, error: String(error) }));
      return json({ error: 'Internal server error' }, 500, cors);
    }
  },
} satisfies ExportedHandler<Env>;

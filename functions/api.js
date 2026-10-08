const PUBLIC_CONFIG_CACHE_FRESH_MS = 5 * 60 * 1000;
const PUBLIC_CONFIG_CACHE_KEEP_SECONDS = 24 * 60 * 60;
const PUBLIC_CONFIG_CACHE_VERSION = 'v4';

export async function onRequestPost(context) {
  const proxyStarted = Date.now();
  const proxyRequestId = crypto.randomUUID().slice(0, 8);

  try {
    const appsScriptUrl = String(context.env.APPS_SCRIPT_URL || '').trim();
    const apiSecret = String(context.env.API_SHARED_SECRET || '').trim();

    if (!appsScriptUrl || !apiSecret) {
      return json({ ok: false, error: 'El backend de producción todavía no está configurado.' }, 500);
    }

    const requestBody = await context.request.json();
    const action = String(requestBody.action || '').trim();
    const payload = requestBody.payload || {};

    const allowedActions = new Set([
      'getPublicConfig',
      'getDateAvailabilityInfo',
      'warmAvailabilityCache',
      'getEditableAvailability',
      'createAppointment',
      'updatePublicAppointment'
    ]);

    if (!allowedActions.has(action)) {
      return json({ ok: false, error: 'Acción no permitida.' }, 400);
    }

    // V4: la configuración pública cambia poco. La conservamos en el edge y,
    // cuando envejece, la seguimos sirviendo inmediatamente mientras Cloudflare
    // la refresca contra Apps Script en segundo plano.
    if (action === 'getPublicConfig') {
      const cached = await readPublicConfigCache(context);
      if (cached && cached.data) {
        const ageMs = Math.max(0, Date.now() - Number(cached.storedAt || 0));
        const isFresh = ageMs <= PUBLIC_CONFIG_CACHE_FRESH_MS;

        if (!isFresh) {
          context.waitUntil(
            refreshPublicConfigCache(context, appsScriptUrl, apiSecret)
              .catch(err => console.warn('[Barber V4] No se pudo refrescar public config:', err))
          );
        }

        return json({
          ok: true,
          data: cached.data,
          timing: {
            proxyRequestId,
            action,
            publicConfigSource: isFresh ? 'EDGE_HIT' : 'EDGE_STALE',
            publicConfigAgeMs: ageMs,
            cloudflareToAppsScriptMs: 0,
            cloudflareTotalMs: Date.now() - proxyStarted,
            appsScript: null
          }
        });
      }
    }

    const upstreamResult = await callAppsScript(appsScriptUrl, apiSecret, action, payload);

    if (!upstreamResult.validJson) {
      return json({
        ok: false,
        error: 'Apps Script devolvió una respuesta no válida.',
        detail: upstreamResult.text.slice(0, 200),
        timing: {
          proxyRequestId,
          action,
          publicConfigSource: action === 'getPublicConfig' ? 'APPS_SCRIPT_ERROR' : undefined,
          cloudflareToAppsScriptMs: upstreamResult.upstreamMs,
          cloudflareTotalMs: Date.now() - proxyStarted
        }
      }, 502);
    }

    const data = upstreamResult.data;

    if (action === 'getPublicConfig' && upstreamResult.ok && data && data.ok === true && data.data) {
      context.waitUntil(writePublicConfigCache(context, data.data));
    }

    const response = {
      ...data,
      timing: {
        proxyRequestId,
        action,
        publicConfigSource: action === 'getPublicConfig' ? 'APPS_SCRIPT' : undefined,
        publicConfigAgeMs: action === 'getPublicConfig' ? 0 : undefined,
        cloudflareToAppsScriptMs: upstreamResult.upstreamMs,
        cloudflareTotalMs: Date.now() - proxyStarted,
        appsScript: data && data.testTiming ? data.testTiming : null
      }
    };
    delete response.testTiming;

    return json(response, upstreamResult.ok ? 200 : 502);
  } catch (err) {
    return json({
      ok: false,
      error: err && err.message ? err.message : 'Error interno del proxy.',
      timing: {
        proxyRequestId,
        cloudflareTotalMs: Date.now() - proxyStarted
      }
    }, 500);
  }
}

export function onRequestGet() {
  return json({
    ok: true,
    service: 'Barber App Cloudflare API PROD',
    diagnostics: 'prod-v1-v4-public-config-edge'
  });
}

async function callAppsScript(appsScriptUrl, apiSecret, action, payload) {
  const upstreamStarted = Date.now();
  const upstream = await fetch(appsScriptUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiSecret, action, payload }),
    redirect: 'follow'
  });
  const upstreamMs = Date.now() - upstreamStarted;
  const text = await upstream.text();

  try {
    return { ok: upstream.ok, upstreamMs, text, validJson: true, data: JSON.parse(text) };
  } catch (e) {
    return { ok: upstream.ok, upstreamMs, text, validJson: false, data: null };
  }
}

async function refreshPublicConfigCache(context, appsScriptUrl, apiSecret) {
  const result = await callAppsScript(appsScriptUrl, apiSecret, 'getPublicConfig', {});
  if (!result.ok || !result.validJson || !result.data || result.data.ok !== true || !result.data.data) {
    throw new Error('La actualización de configuración pública no devolvió datos válidos.');
  }
  await writePublicConfigCache(context, result.data.data);
}

function publicConfigCacheRequest(context) {
  const url = new URL(context.request.url);
  url.pathname = `/__barber_cache/public-config-${PUBLIC_CONFIG_CACHE_VERSION}`;
  url.search = '';
  url.hash = '';
  return new Request(url.toString(), { method: 'GET' });
}

async function readPublicConfigCache(context) {
  try {
    if (typeof caches === 'undefined' || !caches.default) return null;
    const cachedResponse = await caches.default.match(publicConfigCacheRequest(context));
    if (!cachedResponse) return null;
    const value = await cachedResponse.json();
    if (!value || !value.data || !Array.isArray(value.data.services) || !value.data.services.length) return null;
    return value;
  } catch (err) {
    console.warn('[Barber V4] Error leyendo cache edge:', err);
    return null;
  }
}

async function writePublicConfigCache(context, data) {
  try {
    if (typeof caches === 'undefined' || !caches.default) return false;
    const body = JSON.stringify({ storedAt: Date.now(), data });
    const cacheResponse = new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=UTF-8',
        'Cache-Control': `public, max-age=${PUBLIC_CONFIG_CACHE_KEEP_SECONDS}`
      }
    });
    await caches.default.put(publicConfigCacheRequest(context), cacheResponse);
    return true;
  } catch (err) {
    console.warn('[Barber V4] Error escribiendo cache edge:', err);
    return false;
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store'
    }
  });
}

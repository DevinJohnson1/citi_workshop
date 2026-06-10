#!/usr/bin/env node

/**
 * Development CORS Proxy Server
 *
 * This proxy server forwards requests from the React frontend (localhost:3000)
 * to Lambda Function URLs in LocalStack, working around CORS issues.
 *
 * Only needed for LocalStack development. AWS production handles CORS correctly.
 */

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = 3001;

// Read endpoint mappings from .env.local
const envFile = path.join(__dirname, '../frontend/.env.local');
let endpoints = {};

try {
  const envContent = fs.readFileSync(envFile, 'utf8');
  const match = envContent.match(/VITE_API_ENDPOINTS='(.+)'/) || envContent.match(/REACT_APP_API_ENDPOINTS='(.+)'/);
  if (match) {
    endpoints = JSON.parse(match[1]);
    console.log('Loaded endpoints:', Object.keys(endpoints));
  }
} catch (err) {
  console.error('Could not load endpoints from .env.local:', err.message);
  console.error('Make sure to run: ./bin/generate-env.sh first');
  process.exit(1);
}

const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Max-Age', '86400');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Parse request path: /api/{endpoint_name}  OR  /cognito
  const parsedUrl = url.parse(req.url);
  const pathParts = parsedUrl.pathname.split('/').filter(Boolean);

  // ----- Cognito proxy --------------------------------------------------
  // LocalStack only routes cognito-idp requests when the Host header is the
  // regional subdomain (cognito-idp.us-east-1.localhost.localstack.cloud) AND
  // returns no CORS headers on the OPTIONS preflight — so we cannot call it
  // straight from the browser. The frontend POSTs InitiateAuth bodies here
  // and we forward them server-side with the right Host + X-Amz-Target.
  if (pathParts[0] === 'cognito') {
    const cognitoHost = process.env.COGNITO_HOST
      || 'cognito-idp.us-east-1.localhost.localstack.cloud';
    const cognitoPort = process.env.COGNITO_PORT || '4566';
    const target = {
      hostname: cognitoHost,
      port: cognitoPort,
      path: '/',
      method: req.method,
      headers: {
        'content-type': req.headers['content-type'] || 'application/x-amz-json-1.1',
        'x-amz-target': req.headers['x-amz-target'] || '',
        'host': `${cognitoHost}:${cognitoPort}`,
      },
    };
    console.log(`${req.method} /cognito (${req.headers['x-amz-target']}) -> http://${cognitoHost}:${cognitoPort}/`);
    const proxyReq = http.request(target, (proxyRes) => {
      const headers = { ...proxyRes.headers };
      delete headers['access-control-allow-origin'];
      delete headers['access-control-allow-methods'];
      delete headers['access-control-allow-headers'];
      delete headers['access-control-max-age'];
      res.writeHead(proxyRes.statusCode, headers);
      proxyRes.pipe(res);
    });
    proxyReq.on('error', (err) => {
      console.error('Cognito proxy error:', err.message);
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Bad Gateway', message: err.message }));
    });
    req.pipe(proxyReq);
    return;
  }
  // ---------------------------------------------------------------------

  if (pathParts[0] !== 'api' || pathParts.length < 2) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      message: 'Development CORS Proxy Server',
      usage: 'GET /api/{endpoint_name}',
      endpoints: Object.keys(endpoints).map(name => `http://localhost:${PORT}/api/${name}`)
    }, null, 2));
    return;
  }

  const endpointName = pathParts[1];
  const remainingPath = pathParts.length > 2 ? '/' + pathParts.slice(2).join('/') : '';

  // Explicit existence check. `endpoints[endpointName]` can be undefined when
  // `.env.local` is stale (e.g. LocalStack was restarted and the per-service
  // Function URLs were reissued, but `bin/generate-env.sh` was not re-run).
  // Without this check we'd silently build `"undefined" + remainingPath`,
  // pass the `if (!targetUrl)` guard below (truthy string), and then crash
  // inside `http.request()` with a cryptic "Invalid URL" — which surfaces in
  // the browser as the dreaded `TypeError: Failed to fetch` because the
  // proxy closes the socket before writing a response.
  if (!Object.prototype.hasOwnProperty.call(endpoints, endpointName)) {
    console.error(
      `[proxy] Unknown endpoint "${endpointName}". `
      + `Known: ${Object.keys(endpoints).join(', ') || '(none)'}. `
      + `Re-run ./bin/generate-env.sh after every LocalStack restart.`,
    );
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Bad Gateway',
      message: `Endpoint "${endpointName}" is not in .env.local. `
        + 'Re-run ./bin/generate-env.sh and restart the proxy.',
      available: Object.keys(endpoints),
    }));
    return;
  }

  const targetUrl = endpoints[endpointName] + remainingPath + (parsedUrl.search || '');

  if (!targetUrl) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: `Unknown endpoint: ${endpointName}`,
      available: Object.keys(endpoints)
    }));
    return;
  }

  console.log(`${req.method} /api/${endpointName} -> ${targetUrl}`);

  // Parse target URL. `url.parse` is lenient and returns an object even for
  // garbage input — guard explicitly so we don't ship requests with a null
  // hostname into `http.request`, which throws synchronously and would
  // otherwise drop the client socket without a response.
  const target = url.parse(targetUrl);
  if (!target.hostname) {
    console.error(`[proxy] Refusing to proxy: target URL has no hostname (${targetUrl})`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Bad Gateway',
      message: `Endpoint "${endpointName}" resolved to an invalid URL: ${targetUrl}`,
    }));
    return;
  }
  const protocol = target.protocol === 'https:' ? https : http;

  // Forward request - strip all CORS-related and browser headers
  const headers = { ...req.headers };

  // Remove headers that cause LocalStack CORS issues
  delete headers.origin;
  delete headers.referer;
  delete headers['sec-fetch-site'];
  delete headers['sec-fetch-mode'];
  delete headers['sec-fetch-dest'];

  // Keep only essential headers. Authorization MUST be forwarded so the
  // Lambda's JWT verifier (backend/_lib/auth.py) can validate the Cognito
  // access token issued by the workshop login form.
  const options = {
    hostname: target.hostname,
    port: target.port,
    path: target.path,
    method: req.method,
    headers: {
      'accept': headers.accept || 'application/json',
      'content-type': headers['content-type'] || 'application/json',
      'user-agent': headers['user-agent'] || 'proxy-server',
      'host': target.host,
    },
  };
  if (headers.authorization) {
    options.headers.authorization = headers.authorization;
  }

  const proxyReq = protocol.request(options, (proxyRes) => {
    // Filter out CORS headers from Lambda response since we set our own
    const headers = { ...proxyRes.headers };
    delete headers['access-control-allow-origin'];
    delete headers['access-control-allow-methods'];
    delete headers['access-control-allow-headers'];
    delete headers['access-control-max-age'];

    // Forward status and filtered headers
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error(`[proxy] Upstream error for ${endpointName}: ${err.message} (url=${targetUrl})`);
    // Headers may already be sent if the upstream half-responded then dropped;
    // writeHead would throw in that case, so guard.
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: 'Bad Gateway',
        message: `${err.message} (upstream=${targetUrl})`,
      }));
    } else {
      res.end();
    }
  });
  // Cap upstream wait so a hung Lambda surfaces as a 504 with CORS instead
  // of a half-open socket that the browser eventually reports as "Failed to
  // fetch". 30s is well above any realistic cold start.
  proxyReq.setTimeout(30_000, () => {
    console.error(`[proxy] Upstream timeout for ${endpointName} (url=${targetUrl})`);
    proxyReq.destroy(new Error('Upstream timed out after 30s'));
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log('');
  console.log('==================================================');
  console.log(`Listening on: http://localhost:${PORT}`);
  console.log('==================================================');
  console.log('');
  console.log('Available endpoints:');
  for (const [name, targetUrl] of Object.entries(endpoints)) {
    console.log(`  /api/${name} -> ${targetUrl}`);
  }
  console.log('');
  console.log('==================================================');
  console.log(`Update frontend to use: http://localhost:${PORT}`);
  console.log('==================================================');
  console.log('');
});

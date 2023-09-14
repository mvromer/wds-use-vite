import koaConnect from 'koa-connect';
import { URL } from 'url';
import { createServer } from 'vite';

import type { Middleware } from 'koa';
import type { ViteDevServer } from 'vite';

const WDS_VIRTUAL_MODULE_PATH_PREFIX = '/__web-dev-server__';
const WTR_VIRTUAL_MODULE_PATH_PREFIX = '/__web-test-runner__';
const WTR_SESSION_PARAMETER = 'wtr-session-id';

// Vite server instance we will connect to the WDS/WTR middleware pipeline.
let viteServer: ViteDevServer | null = null;

function isModernWebVirtualModulePath(requestPath: string) {
  return (
    requestPath.startsWith(WTR_VIRTUAL_MODULE_PATH_PREFIX) ||
    requestPath.startsWith(WDS_VIRTUAL_MODULE_PATH_PREFIX)
  );
}

function isModernWebRequest(requestUrl: URL) {
  // We special case when the URL path is strictly the root path (/) and the query string has a WTR
  // session id. WTR has a plugin that will handle those requests by serving up the test runner HTML
  // and making sure it's associated with the specified WTR session. In a previous version of this
  // plugin, we weren't special casing this path, and it was causing WTR to produce inconsistent
  // test and coverage results across consecutive runs.
  //
  // However, if someone were simply using this plugin as part of WDS and outside the context of
  // WTR (albeit, seems like it would be a rare case), then it's likely they want to resolve and
  // serve up the index document using Vite.
  return (
    (requestUrl.pathname === '/' &&
      requestUrl.searchParams.has(WTR_SESSION_PARAMETER)) ||
    isModernWebVirtualModulePath(requestUrl.pathname)
  );
}

/**
 * Add a plugin that will initialize the Vite server in middleware mode when WDS/WTR starts.
 */
export function addVite() {
  return {
    name: 'wds-use-vite:add-vite',

    async serverStart() {
      if (!viteServer) {
        viteServer = await createServer({
          clearScreen: false,
          appType: 'custom',
          optimizeDeps: {
            // It doesn't seem like this is strictly necessary, but it will help avoid Vite trying
            // to optimize dependencies and creating bundled modules on the fly while tests are
            // running under WTR.
            disabled: true,
          },
          server: {
            middlewareMode: true,
          },
          plugins: [
            {
              name: 'wds-use-vite:resolve',
              resolveId(moduleId) {
                // Some modules, like @web/test-runner-commands/browser/commands.mjs, contain
                // dynamic imports to so-called "Modern Web" modules. These are virtual modules that
                // are meant to be handled by WDS. However, unless we mark them as external, Vite's
                // analysis plugin will try to analyze them, which will obviously fail because they
                // don't physically exist and can't be located by Vite.
                if (isModernWebVirtualModulePath(moduleId)) {
                  return { id: moduleId, external: true };
                }
              },
            },
          ],
        });
      }
    },
  };
}

/**
 * Create a WDS/WTR middleware that will forward any request that doesn't correspond to a Modern Web
 * virtual module to the Vite server created via the wds-use-vite:add-vite plugin for WDS/WTR.
 */
export function useVite(): Middleware {
  let wrappedViteMiddleware: Middleware;

  return async function useViteMiddleware(context, next) {
    if (viteServer && !wrappedViteMiddleware) {
      wrappedViteMiddleware = koaConnect(viteServer.middlewares);
    }

    const originalRequestUrl = context.req.url;
    const requestUrl = context.req.url
      ? new URL(context.req.url, `${context.protocol}://${context.host}`)
      : null;

    // If this is something we know Vite shouldn't handle, don't both sending it to Vite.
    if (!requestUrl || isModernWebRequest(requestUrl)) {
      await next();
      return;
    }

    // Strip off the WTR session ID query parameters before passing them through to Vite's
    // middleware. Otherwise, some of Vite's module resolution plugins can fail. For example, when
    // an importing module imports a TypeScript file using the .js extension. the test Vite uses for
    // detecting this (and ultimately serving the corresponding .ts file) is based on matching the
    // expected file extension strictly at the end of the requested module path, which fails if any
    // unexpected query parameters are present.
    requestUrl.searchParams.delete(WTR_SESSION_PARAMETER);

    // Call Vite middleware with the path + query segment of the modified request URL. Before
    // returning, restore the request URL on the context object so downstream middleware can
    // process its original value.
    context.req.url = `${requestUrl.pathname}${requestUrl.search}`;
    await wrappedViteMiddleware(context, next);
    context.req.url = originalRequestUrl;
  };
}

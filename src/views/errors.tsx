import type { Context } from 'hono';
import type { AppEnv } from '../types.js';
import { DEFAULT_LOCALE, translate } from '../lib/i18n.js';
import type { Vars } from '../lib/i18n.js';
import { renderPage } from './layout.js';
import { Icon } from './icons.js';

type ErrorStatus = 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500;

export function renderError(
  c: Context<AppEnv>,
  status: ErrorStatus,
  titleKey: string,
  textKey: string,
  vars?: Vars,
): Response {
  const locale = c.get('locale') ?? DEFAULT_LOCALE;
  const title = translate(locale, titleKey);
  const text = translate(locale, textKey, vars);
  return renderPage(c, { title, status }, (
    <section class="error-state card">
      <div class="error-illustration" aria-hidden="true">
        <Icon name="sparkles" size={40} />
      </div>
      <h1>{title}</h1>
      <p>{text}</p>
      <div class="empty-actions">
        <a class="button" href={c.get('user') ? '/lists' : '/'}>
          {translate(locale, c.get('user') ? 'common.backToLists' : 'nav.login')}
        </a>
      </div>
    </section>
  ));
}

export function notFound(c: Context<AppEnv>): Response {
  return renderError(c, 404, 'errors.notFoundTitle', 'errors.notFoundText');
}

export function forbidden(c: Context<AppEnv>): Response {
  return renderError(c, 403, 'errors.forbiddenTitle', 'errors.forbiddenText');
}

export function csrfFailed(c: Context<AppEnv>): Response {
  return renderError(c, 403, 'errors.csrfTitle', 'errors.csrfText');
}

export function rateLimited(c: Context<AppEnv>, retryAfterSec: number): Response {
  c.header('Retry-After', String(retryAfterSec));
  return renderError(c, 429, 'errors.rateTitle', 'errors.rateText', { seconds: retryAfterSec });
}

export function badRequest(c: Context<AppEnv>): Response {
  return renderError(c, 400, 'errors.badRequestTitle', 'errors.badRequestText');
}

export function payloadTooLarge(c: Context<AppEnv>): Response {
  return renderError(c, 413, 'errors.payloadTitle', 'errors.payloadText');
}

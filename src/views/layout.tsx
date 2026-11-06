import type { Context } from 'hono';
import type { Child, FC, PropsWithChildren } from 'hono/jsx';
import type { AppEnv } from '../types.js';
import { DEFAULT_LOCALE, translate } from '../lib/i18n.js';
import type { Locale } from '../lib/i18n.js';
import type { SessionUser } from '../lib/session.js';
import { localized } from '../lib/site.js';
import { themeColor } from '../lib/palette.js';
import { getCampaign } from '../lib/campaign.js';
import type { SiteConfig } from '../lib/site.js';
import type { Campaign } from '../lib/campaign.js';
import { Icon } from './icons.js';
import { Avatar } from './components.js';

export type ActiveNav = 'lists' | 'groups' | 'settings' | 'admin' | null;

export interface Notice {
  type: 'success' | 'error';
  message: string;
}

const NOTICE_KEYS = new Set([
  'listCreated',
  'listUpdated',
  'listDeleted',
  'itemCreated',
  'itemUpdated',
  'itemDeleted',
  'itemArchived',
  'itemUnarchived',
  'itemDuplicated',
  'itemMoved',
  'passwordChanged',
  'languageSaved',
  'recoveryGenerated',
  'accountDeleted',
  'loggedOut',
  'setupDone',
  'recoveryUsed',
  'passwordResetByAdmin',
  'mustChangePassword',
  'groupCreated',
  'groupDeleted',
  'groupJoined',
  'groupLeft',
  'inviteRotated',
  'inviteEnabled',
  'inviteDisabled',
  'memberRemoved',
  'listShared',
  'listUnshared',
  'publicLinkCreated',
  'publicLinkDisabled',
  'publicLinkRegenerated',
  'signupUpdated',
  'tempPasswordReady',
  'claimSaved',
  'claimRemoved',
  'claimTaken',
  'campaignSaved',
]);

export function noticeFromQuery(raw: string | undefined, locale: Locale): Notice | null {
  if (!raw || !NOTICE_KEYS.has(raw)) return null;
  const isError = raw === 'mustChangePassword' || raw === 'claimTaken';
  return { type: isError ? 'error' : 'success', message: translate(locale, `notice.${raw}`) };
}

export interface LayoutProps {
  title: string;
  user: SessionUser | null;
  locale: Locale;
  csrfToken: string;
  active?: ActiveNav;
  notice?: Notice | null;
  noindex?: boolean;
  site: SiteConfig;
  campaign?: Campaign | null;
}

export const Layout: FC<PropsWithChildren<LayoutProps>> = ({
  title,
  user,
  locale,
  csrfToken,
  active = null,
  notice = null,
  noindex = false,
  site,
  campaign = null,
  children,
}) => {
  const t = (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
  const home = user ? '/lists' : '/';

  return (
    <html lang={locale}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="color-scheme" content="light dark" />
        <meta name="csrf-token" content={csrfToken} />
        <meta name="theme-color" content={themeColor(site.colors ?? {}, 'light')} media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content={themeColor(site.colors ?? {}, 'dark')} media="(prefers-color-scheme: dark)" />
        <meta name="description" content={localized(site.tagline, locale)} />
        {noindex ? <meta name="robots" content="noindex, nofollow" /> : null}
        <title>{title === site.appName ? title : `${title} · ${site.appName}`}</title>
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="stylesheet" href="/app.css" />
        <link rel="stylesheet" href="/theme-tokens.css" />
        <script src="/theme.js"></script>
        <script type="module" src="/app.js"></script>
      </head>
      <body>
        <a class="skip-link" href="#main">
          {t('a11y.skip')}
        </a>

        <header class="site-header">
          <div class="container header-inner">
            <a class="brand" href={home} aria-label={site.appName}>
              <span class="brand-mark" aria-hidden="true">
                <Icon name="heart" size={18} />
              </span>
              <span class="brand-name">{site.appName}</span>
            </a>

            <nav class="top-nav" aria-label={t('nav.main')}>
              {user ? (
                <>
                  <a class={active === 'lists' ? 'nav-link is-active' : 'nav-link'} href="/lists">
                    <Icon name="list" size={18} />
                    <span>{t('nav.lists')}</span>
                  </a>
                  <a class={active === 'groups' ? 'nav-link is-active' : 'nav-link'} href="/groups">
                    <Icon name="users" size={18} />
                    <span>{t('nav.groups')}</span>
                  </a>
                </>
              ) : (
                <>
                  <a class="nav-link" href="/login">
                    {t('nav.login')}
                  </a>
                  <a class="button button-small" href="/signup">
                    {t('nav.signup')}
                  </a>
                </>
              )}
            </nav>

            <details class="menu header-menu">
              <summary class="header-menu-trigger" aria-label={t('menu.open')}>
                {user ? (
                  <Avatar seed={user.username} size={40} decorative class="avatar-small" />
                ) : (
                  <Icon name="settings" size={19} />
                )}
              </summary>
              <div class="menu-panel header-menu-panel">
                {user ? (
                  <>
                    <p class="menu-label">{user.username}</p>
                    <a class={active === 'settings' ? 'menu-item is-active' : 'menu-item'} href="/settings">
                      <Icon name="settings" size={16} /> {t('nav.settings')}
                    </a>
                    {user.isAdmin ? (
                      <a class={active === 'admin' ? 'menu-item is-active' : 'menu-item'} href="/admin">
                        <Icon name="shield" size={16} /> {t('nav.admin')}
                      </a>
                    ) : null}
                    <div class="menu-divider" />
                  </>
                ) : null}
                <button type="button" class="menu-item" data-theme-toggle aria-pressed="false">
                  <span class="theme-icon theme-icon-sun" aria-hidden="true">
                    <Icon name="sun" size={16} />
                  </span>
                  <span class="theme-icon theme-icon-moon" aria-hidden="true">
                    <Icon name="moon" size={16} />
                  </span>
                  {t('theme.toggle')}
                </button>
                <form method="post" action="/settings/language" class="menu-language" data-autosubmit>
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <label class="menu-label" for="header-locale">
                    {t('settings.language')}
                  </label>
                  <select id="header-locale" name="locale" class="select">
                    <option value="en" selected={locale === 'en'}>
                      {t('language.en')}
                    </option>
                    <option value="de" selected={locale === 'de'}>
                      {t('language.de')}
                    </option>
                    <option value="tr" selected={locale === 'tr'}>
                      {t('language.tr')}
                    </option>
                  </select>
                </form>
                {user ? (
                  <>
                    <div class="menu-divider" />
                    <form method="post" action="/logout">
                      <input type="hidden" name="_csrf" value={csrfToken} />
                      <button type="submit" class="menu-item menu-danger">
                        <Icon name="logout" size={16} /> {t('nav.logout')}
                      </button>
                    </form>
                  </>
                ) : null}
              </div>
            </details>
          </div>
        </header>

        <main id="main" class="site-main">
          <div class="container">
            {campaign ? (
              <div class="campaign-bar" role="status">
                <Icon name="sparkles" size={18} />
                <span>{campaign.text}</span>
              </div>
            ) : null}
            {user?.mustChangePassword ? (
              <div class="notice notice-error" role="alert">
                <Icon name="lock" size={18} />
                <span>
                  {t('settings.mustChangeText')}{' '}
                  <a href="/settings#security">{t('settings.mustChangeTitle')}</a>
                </span>
              </div>
            ) : null}
            {notice ? (
              <div class={notice.type === 'success' ? 'notice notice-success' : 'notice notice-error'} role={notice.type === 'success' ? 'status' : 'alert'}>
                <Icon name={notice.type === 'success' ? 'sparkles' : 'lock'} size={18} />
                <span>{notice.message}</span>
              </div>
            ) : null}
            {children}
          </div>
        </main>


        <nav class="bottom-nav" aria-label={t('nav.bottom')}>
          {user ? (
            <>
              <a class={active === 'lists' ? 'bottom-link is-active' : 'bottom-link'} href="/lists">
                <Icon name="list" size={22} />
                <span>{t('nav.lists')}</span>
              </a>
              <a class={active === 'groups' ? 'bottom-link is-active' : 'bottom-link'} href="/groups">
                <Icon name="users" size={22} />
                <span>{t('nav.groups')}</span>
              </a>
              <a class="bottom-link" href="/lists/new">
                <Icon name="plus" size={22} />
                <span>{t('lists.new')}</span>
              </a>
              <a class={active === 'settings' ? 'bottom-link is-active' : 'bottom-link'} href="/settings">
                <Icon name="settings" size={22} />
                <span>{t('nav.settings')}</span>
              </a>
            </>
          ) : (
            <>
              <a class="bottom-link" href="/">
                <Icon name="heart" size={22} />
                <span>{t('app.name')}</span>
              </a>
              <a class="bottom-link" href="/login">
                <Icon name="lock" size={22} />
                <span>{t('nav.login')}</span>
              </a>
              <a class="bottom-link" href="/signup">
                <Icon name="sparkles" size={22} />
                <span>{t('nav.signup')}</span>
              </a>
            </>
          )}
        </nav>
      </body>
    </html>
  );
};

export interface PageOptions {
  title: string;
  active?: ActiveNav;
  status?: 200 | 201 | 400 | 401 | 403 | 404 | 409 | 413 | 429 | 500;
  notice?: Notice | null;
  noindex?: boolean;
  /** Show the admin's campaign bar on this page (home pages only). */
  campaign?: boolean;
}

export function renderPage(c: Context<AppEnv>, options: PageOptions, children: Child): Response {
  const locale = c.get('locale') ?? DEFAULT_LOCALE;
  const user = c.get('user') ?? null;
  const csrfToken = c.get('csrfToken') ?? '';
  const notice = options.notice === undefined ? noticeFromQuery(c.req.query('notice'), locale) : options.notice;

  const campaign = getCampaign(c.get('db'));
  c.header('Cache-Control', 'no-store');
  if (options.noindex) c.header('X-Robots-Tag', 'noindex, nofollow');
  return c.html(
    <Layout
      title={options.title}
      user={user}
      locale={locale}
      csrfToken={csrfToken}
      active={options.active ?? null}
      notice={notice}
      noindex={options.noindex}
      site={c.get('site')}
      campaign={options.campaign && campaign.enabled && campaign.text ? campaign : null}
    >
      {children}
    </Layout>,
    (options.status ?? 200) as 200,
  ) as Response;
}

export function redirectWithNotice(c: Context, path: string, notice: string): Response {
  // Keep the query string before any fragment; "...#item-x?notice=y" would never reach the server.
  const hashIndex = path.indexOf('#');
  const base = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : '';
  const separator = base.includes('?') ? '&' : '?';
  return c.redirect(`${base}${separator}notice=${encodeURIComponent(notice)}${hash}`, 303);
}

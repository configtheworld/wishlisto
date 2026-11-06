import { localized } from '../lib/site.js';
import type { SiteConfig } from '../lib/site.js';
import type { FC } from 'hono/jsx';
import type { Locale } from '../lib/i18n.js';
import { translate } from '../lib/i18n.js';
import { FormErrors, TextField } from './components.js';
import { Icon } from './icons.js';

function useT(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export const Landing: FC<{ locale: Locale; csrfToken: string; openSignup: boolean; site: SiteConfig }> = ({
  locale,
  openSignup,
  site,
}) => {
  const t = useT(locale);
  return (
    <>
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">
            <Icon name="sparkles" size={16} /> {localized(site.tagline, locale)}
          </p>
          <h1>{localized(site.landing.title, locale)}</h1>
          <p class="hero-text">{localized(site.landing.intro, locale)}</p>
          <div class="hero-actions">
            <a class="button button-large" href="/login">
              {t('landing.login')}
            </a>
            {openSignup ? (
              <a class="button button-secondary button-large" href="/signup">
                {t('landing.signup')}
              </a>
            ) : (
              <span class="muted">{t('landing.closed')}</span>
            )}
          </div>
        </div>
        <div class="hero-art" aria-hidden="true">
          <div class="hero-card hero-card-a">
            <span class="hero-emoji">🎁</span>
            <span class="hero-line hero-line-long" />
            <span class="hero-line" />
          </div>
          <div class="hero-card hero-card-b">
            <span class="hero-emoji">🧸</span>
            <span class="hero-line hero-line-long" />
            <span class="hero-line" />
          </div>
          <div class="hero-sparkle">✦</div>
          <div class="hero-heart">♥</div>
        </div>
      </section>

      <section class="feature-grid" aria-label={site.appName}>
        {site.landing.features.map((feature) => (
          <article class="card feature">
            <span class="feature-icon" aria-hidden="true">
              <Icon name={feature.icon} />
            </span>
            <h2>{localized(feature.title, locale)}</h2>
            <p>{localized(feature.text, locale)}</p>
          </article>
        ))}
      </section>
    </>
  );
};

export const LoginForm: FC<{
  locale: Locale;
  csrfToken: string;
  next: string | null;
  errors: string[];
  username: string;
  password: string;
}> = ({ locale, csrfToken, next, errors, username, password }) => {
  const t = useT(locale);
  return (
    <section class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-mark" aria-hidden="true">
          <Icon name="heart" size={26} />
        </div>
        <h1>{t('auth.login.title')}</h1>
        <p class="subtitle">{t('auth.login.subtitle')}</p>
        <FormErrors errors={errors} locale={locale} />
        <form method="post" action="/login" class="form-stack">
          <input type="hidden" name="_csrf" value={csrfToken} />
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <TextField name="username" label={t('auth.username')} value={username} autocomplete="username" required />
          <TextField
            name="password"
            label={t('auth.password')}
            value={password}
            type="password"
            autocomplete="current-password"
            required
          />
          <button type="submit" class="button button-block">
            {t('auth.login.submit')}
          </button>
        </form>
        <div class="auth-links">
          <p>
            {t('auth.recover.back')} — <a href="/recover">{t('auth.login.forgot')}</a>
          </p>
          <p>
            {t('auth.login.noAccount')} <a href="/signup">{t('auth.login.createAccount')}</a>
          </p>
        </div>
      </div>
    </section>
  );
};

export const SignupForm: FC<{
  locale: Locale;
  csrfToken: string;
  errors: string[];
  username: string;
}> = ({ locale, csrfToken, errors, username }) => {
  const t = useT(locale);
  return (
    <section class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-mark" aria-hidden="true">
          <Icon name="gift" size={26} />
        </div>
        <h1>{t('auth.signup.title')}</h1>
        <p class="subtitle">{t('auth.signup.subtitle')}</p>
        <FormErrors errors={errors} locale={locale} />
        <form method="post" action="/signup" class="form-stack">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <TextField
            name="username"
            label={t('auth.username')}
            value={username}
            autocomplete="username"
            hint={t('auth.usernameHint')}
            required
          />
          <TextField
            name="password"
            label={t('auth.password')}
            type="password"
            autocomplete="new-password"
            hint={t('auth.passwordHint')}
            required
          />
          <TextField name="confirm" label={t('auth.recover.confirm')} type="password" autocomplete="new-password" required />
          <button type="submit" class="button button-block">
            {t('auth.signup.submit')}
          </button>
        </form>
        <p class="recovery-note">
          <Icon name="lock" size={16} /> {t('auth.signup.recoveryNote')}
        </p>
        <div class="auth-links">
          <p>
            {t('auth.signup.haveAccount')} <a href="/login">{t('auth.signup.login')}</a>
          </p>
        </div>
      </div>
    </section>
  );
};

export const SignupClosed: FC<{ locale: Locale }> = ({ locale }) => {
  const t = useT(locale);
  return (
    <section class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-mark" aria-hidden="true">
          <Icon name="lock" size={26} />
        </div>
        <h1>{t('auth.signup.closedTitle')}</h1>
        <p class="subtitle">{t('auth.signup.closedText')}</p>
        <div class="empty-actions">
          <a class="button" href="/login">
            {t('auth.login.submit')}
          </a>
          <a class="button button-ghost" href="/">
            {t('actions.back')}
          </a>
        </div>
      </div>
    </section>
  );
};

export const RecoverForm: FC<{
  locale: Locale;
  csrfToken: string;
  errors: string[];
  username: string;
  code: string;
}> = ({ locale, csrfToken, errors, username, code }) => {
  const t = useT(locale);
  return (
    <section class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-mark" aria-hidden="true">
          <Icon name="lock" size={26} />
        </div>
        <h1>{t('auth.recover.title')}</h1>
        <p class="subtitle">{t('auth.recover.subtitle')}</p>
        <FormErrors errors={errors} locale={locale} />
        <form method="post" action="/recover" class="form-stack">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <TextField name="username" label={t('auth.username')} value={username} autocomplete="username" required />
          <TextField
            name="code"
            label={t('auth.recover.code')}
            value={code}
            autocomplete="one-time-code"
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            spellcheck={false}
            required
          />
          <TextField name="password" label={t('auth.recover.newPassword')} type="password" autocomplete="new-password" required />
          <TextField name="confirm" label={t('auth.recover.confirm')} type="password" autocomplete="new-password" required />
          <button type="submit" class="button button-block">
            {t('auth.recover.submit')}
          </button>
        </form>
        <p class="hint">{t('auth.recover.noCode')}</p>
        <div class="auth-links">
          <p>
            <a href="/login">{t('auth.recover.back')}</a>
          </p>
        </div>
      </div>
    </section>
  );
};

export const SetupForm: FC<{ locale: Locale; csrfToken: string; errors: string[]; username: string }> = ({
  locale,
  csrfToken,
  errors,
  username,
}) => {
  const t = useT(locale);
  return (
    <section class="auth-wrap">
      <div class="auth-card card">
        <div class="auth-mark" aria-hidden="true">
          <Icon name="sparkles" size={26} />
        </div>
        <h1>{t('auth.setup.title')}</h1>
        <p class="subtitle">{t('auth.setup.subtitle')}</p>
        <p class="muted">{t('auth.setup.text')}</p>
        <FormErrors errors={errors} locale={locale} />
        <form method="post" action="/setup" class="form-stack">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <TextField
            name="username"
            label={t('auth.username')}
            value={username}
            autocomplete="username"
            hint={t('auth.usernameHint')}
            required
          />
          <TextField
            name="password"
            label={t('auth.password')}
            type="password"
            autocomplete="new-password"
            hint={t('auth.passwordHint')}
            required
          />
          <TextField name="confirm" label={t('auth.recover.confirm')} type="password" autocomplete="new-password" required />
          <button type="submit" class="button button-block">
            {t('auth.setup.submit')}
          </button>
        </form>
      </div>
    </section>
  );
};

export const RecoveryCodePage: FC<{
  locale: Locale;
  csrfToken: string;
  formattedCode: string;
  from: 'setup' | 'settings' | 'signup';
}> = ({ locale, csrfToken, formattedCode, from }) => {
  const t = useT(locale);
  const isSettings = from === 'settings';
  return (
    <section class="auth-wrap">
      <div class="auth-card card recovery-card">
        <div class="auth-mark" aria-hidden="true">
          <Icon name="lock" size={26} />
        </div>
        <h1>{isSettings ? t('auth.welcome.settingsTitle') : t('auth.welcome.title')}</h1>
        <p class="subtitle">{isSettings ? t('auth.welcome.settingsText') : t('auth.welcome.text')}</p>

        <p class="recovery-label">{t('auth.welcome.codeLabel')}</p>
        <div class="recovery-code-wrap">
          <code id="recovery-code" class="recovery-code">
            {formattedCode}
          </code>
        </div>

        <div class="recovery-actions">
          <button type="button" class="button button-secondary" data-copy-target="recovery-code" data-copied-label={t('actions.copied')}>
            <Icon name="copy" size={18} /> <span data-copy-label>{t('actions.copy')}</span>
          </button>
          <button type="button" class="button button-ghost" data-print aria-label={t('a11y.printCode')}>
            <Icon name="printer" size={18} /> {t('actions.print')}
          </button>
        </div>

        {isSettings ? null : (
          <p class="recovery-warning">
            <Icon name="sparkles" size={16} /> {t('auth.welcome.warning')}
          </p>
        )}

        <form method="post" action="/welcome/recovery/ack" class="form-stack">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <input type="hidden" name="from" value={from} />
          <button type="submit" class="button button-block">
            {t('auth.welcome.saved')}
          </button>
        </form>
        <p class="hint">{t('auth.welcome.printHint')}</p>
      </div>
    </section>
  );
};

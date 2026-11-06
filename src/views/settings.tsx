import type { FC } from 'hono/jsx';
import type { Locale } from '../lib/i18n.js';
import { translate } from '../lib/i18n.js';
import { Avatar, Alert, FormErrors, PageHeader, TextField } from './components.js';
import { Icon } from './icons.js';

function useT(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

function memberSince(timestamp: number, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(timestamp));
  } catch {
    return String(new Date(timestamp).getUTCFullYear());
  }
}

export interface SettingsUser {
  id: string;
  username: string;
  isAdmin: boolean;
  mustChangePassword: boolean;
  createdAt: number;
  locale: Locale;
}

export const SettingsPage: FC<{
  locale: Locale;
  csrfToken: string;
  user: SettingsUser;
  lastAdmin: boolean;
  errors: string[];
}> = ({ locale, csrfToken, user, lastAdmin, errors }) => {
  const t = useT(locale);
  return (
    <>
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <FormErrors errors={errors} locale={locale} />

      {user.mustChangePassword ? (
        <Alert tone="info" title={t('settings.mustChangeTitle')} text={t('settings.mustChangeText')} />
      ) : null}

      <section class="card settings-card" id="account">
        <div class="settings-profile">
          <Avatar seed={user.username} size={96} alt={t('settings.avatarAlt')} class="avatar-large" />
          <div>
            <h2>{user.username}</h2>
            <p class="muted">
              {user.isAdmin ? (
                <span class="chip chip-accent">
                  <Icon name="sparkles" size={13} /> {t('common.admin')}
                </span>
              ) : null}{' '}
              {t('settings.memberSince', { date: memberSince(user.createdAt, locale) })}
            </p>
          </div>
        </div>
        <p class="hint">{t('settings.accountText')}</p>
      </section>

      {user.isAdmin ? (
        <section class="card settings-card" id="admin">
          <div class="section-title-row">
            <h2>
              <Icon name="shield" size={18} /> {t('settings.adminTitle')}
            </h2>
          </div>
          <p class="hint">{t('settings.adminText')}</p>
          <div class="form-actions">
            <a class="button button-secondary" href="/admin">
              <Icon name="shield" size={17} /> {t('settings.adminOpen')}
            </a>
          </div>
        </section>
      ) : null}

      <section class="card settings-card" id="security">
        <h2>{t('settings.security')}</h2>
        <p class="hint">{t('settings.passwordHint')}</p>
        <form method="post" action="/settings/password" class="form-stack">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <TextField
            name="current"
            label={t('settings.passwordCurrent')}
            type="password"
            autocomplete="current-password"
            required
          />
          <div class="field-row">
            <TextField
              name="password"
              label={t('settings.passwordNew')}
              type="password"
              autocomplete="new-password"
              hint={t('auth.passwordHint')}
              required
            />
            <TextField
              name="confirm"
              label={t('settings.passwordConfirm')}
              type="password"
              autocomplete="new-password"
              required
            />
          </div>
          <div class="form-actions">
            <button type="submit" class="button">
              {t('settings.passwordSubmit')}
            </button>
          </div>
        </form>
      </section>

      <section class="card settings-card" id="recovery">
        <h2>{t('settings.recoveryTitle')}</h2>
        <p class="hint">{t('settings.recoveryText')}</p>
        <form method="post" action="/settings/recovery" class="form-stack form-narrow">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <TextField
            name="password"
            label={t('settings.recoveryPassword')}
            type="password"
            autocomplete="current-password"
            required
          />
          <div class="form-actions">
            <button type="submit" class="button button-secondary">
              <Icon name="sparkles" size={17} /> {t('settings.recoveryGenerate')}
            </button>
          </div>
        </form>
      </section>


      <section class="danger-zone card" id="danger">
        <h2>{t('settings.danger')}</h2>
        <p class="hint">{t('settings.dangerText')}</p>
        {lastAdmin ? (
          <Alert tone="info" title={t('settings.lastAdminTitle')} text={t('settings.lastAdmin')} />
        ) : (
          <form method="post" action="/settings/delete" class="form-stack form-narrow" data-confirm={t('settings.dangerConfirm')}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <TextField
              name="confirmUsername"
              label={t('settings.dangerUsername')}
              autocomplete="username"
              spellcheck={false}
              required
            />
            <TextField
              name="password"
              label={t('settings.dangerPassword')}
              type="password"
              autocomplete="current-password"
              required
            />
            <div class="form-actions">
              <button type="submit" class="button button-danger">
                <Icon name="trash" size={17} /> {t('settings.dangerSubmit')}
              </button>
            </div>
          </form>
        )}
      </section>
    </>
  );
};

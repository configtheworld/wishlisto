import type { FC } from 'hono/jsx';
import type { Locale } from '../lib/i18n.js';
import { translate } from '../lib/i18n.js';
import { Alert, PageHeader } from './components.js';
import type { Campaign } from '../lib/campaign.js';
import { Icon } from './icons.js';

function useT(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

function memberSince(timestamp: number, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(timestamp));
  } catch {
    return String(new Date(timestamp).getUTCFullYear());
  }
}

export interface AdminUser {
  id: string;
  username: string;
  is_admin: number;
  is_disabled: number;
  must_change_password: number;
  created_at: number;
}

export const AdminPage: FC<{
  locale: Locale;
  csrfToken: string;
  openSignup: boolean;
  users: AdminUser[];
  currentUserId: string;
  tempPassword: { username: string; password: string } | null;
  campaign: Campaign;
}> = ({ locale, csrfToken, openSignup, users, currentUserId, tempPassword, campaign }) => {
  const t = useT(locale);
  return (
    <>
      <PageHeader title={t('admin.title')} subtitle={t('admin.subtitle')} />

      {tempPassword ? (
        <section class="card settings-card" id="temp-password">
          <h2>{t('admin.tempPasswordTitle', { username: tempPassword.username })}</h2>
          <p class="hint">{t('admin.tempPasswordText')}</p>
          <div class="copy-row">
            <code class="copy-value" id="admin-temp-password">{tempPassword.password}</code>
            <button
              type="button"
              class="button button-ghost button-small"
              data-copy-target="admin-temp-password"
              data-copied-label={t('actions.copied')}
            >
              <Icon name="copy" size={15} /> <span data-copy-label>{t('actions.copy')}</span>
            </button>
          </div>
        </section>
      ) : null}

      <section class="card settings-card" id="campaign">
        <div class="section-title-row">
          <h2>
            <Icon name="sparkles" size={18} /> {t('admin.campaignTitle')}
          </h2>
          <span class={campaign.enabled ? 'chip chip-accent' : 'chip'}>
            {campaign.enabled ? t('admin.campaignOn') : t('admin.campaignOff')}
          </span>
        </div>
        <p class="hint">{t('admin.campaignText')}</p>
        <form method="post" action="/admin/campaign" class="form-stack form-narrow">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <div class="checkbox-field">
            <input type="checkbox" id="campaign-enabled" name="enabled" value="1" checked={campaign.enabled} />
            <label for="campaign-enabled">{t('admin.campaignEnabled')}</label>
          </div>
          <div class="field">
            <label for="campaign-text">{t('admin.campaignMessage')}</label>
            <textarea id="campaign-text" name="text" rows={2} maxlength={200} placeholder={t('admin.campaignPlaceholder')}>
              {campaign.text}
            </textarea>
            <p class="hint">{t('admin.campaignHint')}</p>
          </div>
          <div class="form-actions">
            <button type="submit" class="button">
              {t('admin.campaignSave')}
            </button>
          </div>
        </form>
      </section>

      <section class="card settings-card" id="signup">
        <div class="section-title-row">
          <h2>
            <Icon name="sparkles" size={18} /> {t('admin.signupTitle')}
          </h2>
          <span class={openSignup ? 'chip chip-accent' : 'chip'}>
            {openSignup ? t('admin.signupOn') : t('admin.signupOff')}
          </span>
        </div>
        <p class="hint">{t('admin.signupText')}</p>
        <form method="post" action="/admin/signup">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <input type="hidden" name="open" value={openSignup ? '0' : '1'} />
          <div class="form-actions">
            <button type="submit" class={openSignup ? 'button button-ghost' : 'button'}>
              {openSignup ? t('admin.signupClose') : t('admin.signupOpen')}
            </button>
          </div>
        </form>
      </section>

      <section class="settings-card" id="users">
        <div class="section-title-row">
          <h2>
            {t('admin.usersTitle')} <span class="count-badge">{users.length}</span>
          </h2>
        </div>
        <p class="hint">{t('admin.usersText')}</p>
        <ul class="admin-user-list card">
          {users.map((user) => {
            const isSelf = user.id === currentUserId;
            return (
              <li class="admin-user-row">
                <div class="admin-user-main">
                  <span class="admin-user-name">
                    {user.username}
                    {user.is_admin === 1 ? (
                      <span class="chip chip-accent">
                        <Icon name="shield" size={12} /> {t('common.admin')}
                      </span>
                    ) : null}
                    {isSelf ? <span class="muted">({t('admin.you')})</span> : null}
                    {user.is_disabled === 1 ? <span class="chip">{t('admin.disabled')}</span> : null}
                  </span>
                  <span class="muted admin-user-meta">
                    {t('admin.memberSince', { date: memberSince(user.created_at, locale) })}
                  </span>
                </div>
                {!isSelf && user.is_admin !== 1 ? (
                  <form
                    method="post"
                    action={`/admin/users/${user.id}/reset`}
                    data-confirm={t('admin.resetConfirm', { username: user.username })}
                  >
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <button type="submit" class="button button-ghost button-small">
                      <Icon name="lock" size={15} /> {t('admin.reset')}
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
        <Alert tone="info" title={t('common.admin')} text={t('admin.noClaims')} />
      </section>
    </>
  );
};

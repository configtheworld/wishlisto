import type { FC } from 'hono/jsx';
import type { Locale } from '../lib/i18n.js';
import { translate, plural } from '../lib/i18n.js';
import type { GroupMemberRow, GroupWithCounts, PreviewItemRow, SharedListRow } from '../lib/access.js';
import { Icon } from './icons.js';
import { EmptyState, FormErrors, PageHeader, TextField, TextareaField } from './components.js';

function useT(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

export const GroupCard: FC<{ locale: Locale; group: GroupWithCounts }> = ({ locale, group }) => {
  return (
    <a class="group-card card" href={`/groups/${group.id}`}>
      <span class="group-mark" aria-hidden="true">
        <Icon name="users" size={26} />
      </span>
      <span class="group-card-body">
        <span class="group-name">{group.name}</span>
        <span class="list-meta">
          {plural(locale, 'count.member', group.member_count)}
          <span class="dot" aria-hidden="true">
            ·
          </span>
          {plural(locale, 'count.list', group.list_count)}
        </span>
        {group.note ? <span class="list-note">{group.note}</span> : null}
      </span>
      <span class="list-arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
};

export const GroupsIndex: FC<{ locale: Locale; groups: GroupWithCounts[] }> = ({ locale, groups }) => {
  const t = useT(locale);
  return (
    <>
      <PageHeader title={t('groups.title')} subtitle={t('groups.subtitle')}>
        <a class="button" href="/groups/new">
          <Icon name="plus" size={18} /> {t('groups.new')}
        </a>
      </PageHeader>
      {groups.length === 0 ? (
        <EmptyState title={t('groups.emptyTitle')} text={t('groups.emptyText')}>
          <a class="button" href="/groups/new">
            {t('groups.emptyCta')}
          </a>
        </EmptyState>
      ) : (
        <div class="group-grid">
          {groups.map((group) => (
            <GroupCard locale={locale} group={group} />
          ))}
          <a class="group-card card group-card-new" href="/groups/new">
            <Icon name="plus" size={26} />
            <span>{t('groups.new')}</span>
          </a>
        </div>
      )}
    </>
  );
};

export interface GroupFormValues {
  name: string;
  note: string;
}

export const GroupFormPage: FC<{
  locale: Locale;
  csrfToken: string;
  values: GroupFormValues;
  errors: string[];
}> = ({ locale, csrfToken, values, errors }) => {
  const t = useT(locale);
  return (
    <>
      <PageHeader title={t('groups.createTitle')} backHref="/groups" backLabel={t('actions.back')} />
      <form method="post" action="/groups" class="card form-stack form-narrow">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <FormErrors errors={errors} locale={locale} />
        <TextField
          name="name"
          label={t('groups.name')}
          value={values.name}
          placeholder={t('groups.namePlaceholder')}
          maxlength={60}
          required
        />
        <TextareaField
          name="note"
          label={t('groups.note')}
          value={values.note}
          placeholder={t('groups.notePlaceholder')}
          rows={3}
          maxlength={500}
        />
        <div class="form-actions">
          <button type="submit" class="button">
            {t('groups.submitCreate')}
          </button>
          <a class="button button-ghost" href="/groups">
            {t('actions.cancel')}
          </a>
        </div>
      </form>
    </>
  );
};

const GroupListCard: FC<{
  locale: Locale;
  csrfToken: string;
  groupId: string;
  list: SharedListRow;
  previews: PreviewItemRow[];
  currentUserId: string;
}> = ({ locale, csrfToken, groupId, list, previews, currentUserId }) => {
  const t = useT(locale);
  const isMine = list.owner_id === currentUserId;
  return (
    <article class={`group-list-card card tone-${list.color}`}>
      <a class="group-list-head" href={`/lists/${list.id}`}>
        <span class="list-emoji" aria-hidden="true">
          {list.emoji || <Icon name="gift" size={24} />}
        </span>
        <span class="group-list-title">
          <span class="list-name">{list.name}</span>
          <span class="list-meta">
            {t('groups.sharedBy', { username: list.owner_username })}
            <span class="dot" aria-hidden="true">·</span>
            {plural(locale, 'count.wish', previews.length)}
          </span>
        </span>
      </a>
      {previews.length > 0 ? (
        <ul class="preview-strip" aria-label={t('groups.previewLabel', { list: list.name })}>
          {previews.map((item) => (
            <li>
              <a class="preview-tile" href={`/lists/${list.id}#item-${item.id}`}>
                <span class="preview-media">
                  {item.image_upload_id ? (
                    <img src={`/media/${item.image_upload_id}.webp`} alt="" loading="lazy" decoding="async" width="160" height="120" />
                  ) : (
                    <Icon name="gift" size={20} />
                  )}
                </span>
                <span class="preview-title">{item.title}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p class="hint">{t('groups.noWishesYet')}</p>
      )}
      <div class="group-list-foot">
        <a class="button button-secondary button-small" href={`/lists/${list.id}`}>
          {t('groups.openList')}
        </a>
        {isMine ? (
          <form method="post" action={`/groups/${groupId}/unshare`} data-confirm={t('groups.removeListConfirm')}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="list_id" value={list.id} />
            <button type="submit" class="button button-ghost button-small">
              {t('groups.removeList')}
            </button>
          </form>
        ) : null}
      </div>
    </article>
  );
};

export interface GroupDetailProps {
  locale: Locale;
  csrfToken: string;
  group: GroupWithCounts;
  members: GroupMemberRow[];
  lists: SharedListRow[];
  previews: Map<string, PreviewItemRow[]>;
  ownerUsername: string;
  currentUserId: string;
  inviteUrl: string | null;
  ownerLists: Array<{ id: string; name: string }>;
}

export const GroupDetail: FC<GroupDetailProps> = ({
  locale,
  csrfToken,
  group,
  members,
  lists,
  previews,
  ownerUsername,
  currentUserId,
  inviteUrl,
  ownerLists,
}) => {
  const t = useT(locale);
  const isOwner = group.owner_id === currentUserId;
  return (
    <>
      <PageHeader title={group.name} subtitle={group.note || undefined} backHref="/groups" backLabel={t('groups.title')} />

      <div class="list-toolbar">
        <span class="chip">
          <Icon name="users" size={13} /> {plural(locale, 'count.member', group.member_count)}
        </span>
        <span class="chip">
          <Icon name="gift" size={13} /> {plural(locale, 'count.list', group.list_count)}
        </span>
        <span class="chip">
          <Icon name="shield" size={13} /> {t('groups.ownedBy', { username: ownerUsername })}
        </span>
        <details class="group-settings">
          <summary class="button button-secondary button-small">
            <Icon name="settings" size={16} /> {t('groups.manage')}
          </summary>
          <div class="group-settings-body">
            <section class="settings-block" id="invite">
              <h3>
                <Icon name="link" size={16} /> {t('groups.inviteTitle')}
              </h3>
              <p class="hint">{t('groups.inviteText')}</p>
              {inviteUrl ? (
                <>
                  <div class="copy-row">
                    <code class="copy-value" id="group-invite">
                      {inviteUrl}
                    </code>
                    <button type="button" class="button button-ghost button-small" data-copy-target="group-invite" data-copied-label={t('actions.copied')}>
                      <Icon name="copy" size={15} /> <span data-copy-label>{t('groups.inviteCopy')}</span>
                    </button>
                  </div>
                  {isOwner ? (
                    <div class="form-actions">
                      <form method="post" action={`/groups/${group.id}/invite/rotate`} data-confirm={t('groups.inviteRotateConfirm')}>
                        <input type="hidden" name="_csrf" value={csrfToken} />
                        <button type="submit" class="button button-ghost button-small">
                          <Icon name="sparkles" size={16} /> {t('groups.inviteRotate')}
                        </button>
                      </form>
                      <form method="post" action={`/groups/${group.id}/invite/disable`} data-confirm={t('groups.inviteDisableConfirm')}>
                        <input type="hidden" name="_csrf" value={csrfToken} />
                        <button type="submit" class="button button-ghost button-small">
                          <Icon name="lock" size={16} /> {t('groups.inviteDisable')}
                        </button>
                      </form>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <p class="hint">{t('groups.noInvite')}</p>
                  {isOwner ? (
                    <form method="post" action={`/groups/${group.id}/invite/enable`}>
                      <input type="hidden" name="_csrf" value={csrfToken} />
                      <button type="submit" class="button button-secondary button-small">
                        <Icon name="link" size={16} /> {t('groups.inviteEnable')}
                      </button>
                    </form>
                  ) : null}
                </>
              )}
            </section>

            <section class="settings-block" id="share">
              <h3>
                <Icon name="gift" size={16} /> {t('groups.shareListTitle')}
              </h3>
              <p class="hint">{t('groups.shareListText')}</p>
              {ownerLists.length > 0 ? (
                <form method="post" action={`/groups/${group.id}/share`} class="form-stack share-form">
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <div class="field">
                    <label for="group-share-list" class="visually-hidden">
                      {t('listForm.name')}
                    </label>
                    <select id="group-share-list" name="list_id" class="select" required>
                      {ownerLists.map((list) => (
                        <option value={list.id}>{list.name}</option>
                      ))}
                    </select>
                  </div>
                  <div class="form-actions">
                    <button type="submit" class="button button-small">
                      <Icon name="link" size={16} /> {t('groups.shareListSubmit')}
                    </button>
                  </div>
                </form>
              ) : (
                <p class="hint">
                  {t('groups.shareListEmpty')} <a href="/lists/new">{t('lists.new')}</a>
                </p>
              )}
            </section>

            <section class="settings-block" id="members">
              <h3>
                <Icon name="users" size={16} /> {t('groups.members')} <span class="count-badge">{group.member_count}</span>
              </h3>
              <ul class="member-list">
                {members.map((member) => (
                  <li class="member-row">
                    <span class="member-name">
                      {member.username}
                      {member.user_id === group.owner_id ? (
                        <span class="chip chip-accent">
                          <Icon name="shield" size={12} /> {t('groups.owner')}
                        </span>
                      ) : null}
                      {member.user_id === currentUserId ? <span class="muted">({t('common.you')})</span> : null}
                    </span>
                    {isOwner && member.user_id !== group.owner_id ? (
                      <form method="post" action={`/groups/${group.id}/members/${member.user_id}/remove`} data-confirm={t('groups.removeMemberConfirm', { username: member.username })}>
                        <input type="hidden" name="_csrf" value={csrfToken} />
                        <button type="submit" class="button button-ghost button-small menu-danger">
                          {t('groups.removeMember')}
                        </button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            <section class="settings-block settings-danger">
              {isOwner ? (
                <form method="post" action={`/groups/${group.id}/delete`} data-confirm={t('groups.deleteConfirm')}>
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <button type="submit" class="button button-danger button-small">
                    <Icon name="trash" size={16} /> {t('groups.delete')}
                  </button>
                </form>
              ) : (
                <form method="post" action={`/groups/${group.id}/leave`} data-confirm={t('groups.leaveConfirm')}>
                  <input type="hidden" name="_csrf" value={csrfToken} />
                  <button type="submit" class="button button-ghost button-small">
                    <Icon name="logout" size={16} /> {t('groups.leave')}
                  </button>
                </form>
              )}
            </section>
          </div>
        </details>
      </div>

      <section class="group-lists" id="group-lists" aria-labelledby="group-lists-title">
        <div class="section-title-row">
          <h2 id="group-lists-title">
            {t('groups.lists')} <span class="count-badge">{lists.length}</span>
          </h2>
        </div>
        {lists.length === 0 ? (
          <p class="hint">{isOwner || ownerLists.length > 0 ? t('groups.noListsOwner') : t('groups.noLists')}</p>
        ) : (
          <div class="group-list-grid">
            {lists.map((list) => (
              <GroupListCard
                locale={locale}
                csrfToken={csrfToken}
                groupId={group.id}
                list={list}
                previews={previews.get(list.id) ?? []}
                currentUserId={currentUserId}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
};

export const JoinGroupPage: FC<{
  locale: Locale;
  csrfToken: string;
  group: GroupWithCounts;
  alreadyMember: boolean;
}> = ({ locale, csrfToken, group, alreadyMember }) => {
  const t = useT(locale);
  return (
    <>
      <PageHeader
        title={t('groups.joinTitle', { group: group.name })}
        subtitle={group.note || undefined}
        backHref="/groups"
        backLabel={t('groups.title')}
      />
      <section class="card settings-card">
        <p>{t('groups.joinText')}</p>
        <p class="hint">{plural(locale, 'count.member', group.member_count)}</p>
        {alreadyMember ? (
          <>
            <p class="hint">{t('groups.alreadyMember')}</p>
            <div class="form-actions">
              <a class="button" href={`/groups/${group.id}`}>
                {t('actions.open')}
              </a>
            </div>
          </>
        ) : (
          <form method="post" action={`/join/${group.invite_token}`} class="form-actions">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <button type="submit" class="button">
              <Icon name="users" size={17} /> {t('groups.joinSubmit')}
            </button>
          </form>
        )}
      </section>
    </>
  );
};

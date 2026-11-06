import type { FC } from 'hono/jsx';
import type { Locale } from '../lib/i18n.js';
import { translate, plural } from '../lib/i18n.js';
import type { ItemRow, ItemWithLinks, ListRow, ListWithCount } from '../lib/models.js';
import { VISIBILITY } from '../lib/claims.js';
import type { ClaimView, Visibility } from '../lib/claims.js';
import { formatPrice } from '../lib/validation.js';
import { Icon } from './icons.js';
import { EmptyState, FormErrors, Hearts, PageHeader, TextField, TextareaField, SelectField } from './components.js';

function useT(locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) => translate(locale, key, vars);
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const ListCard: FC<{ locale: Locale; list: ListWithCount }> = ({ locale, list }) => {
  const t = useT(locale);
  const sharedCount = list.share_count ?? 0;
  return (
    <a class={`list-card card tone-${list.color}`} href={`/lists/${list.id}`}>
      <span class="list-emoji" aria-hidden="true">
        {list.emoji || <Icon name="gift" size={30} />}
      </span>
      <span class="list-card-body">
        <span class="list-name">{list.name}</span>
        <span class="list-meta">
          {list.public_token ? (
            <>
              <Icon name="link" size={13} /> {t('common.public')}
            </>
          ) : sharedCount > 0 ? (
            <>
              <Icon name="users" size={13} /> {t('common.shared')}
            </>
          ) : (
            <>
              <Icon name="lock" size={13} /> {t('common.private')}
            </>
          )}
          <span class="dot" aria-hidden="true">
            ·
          </span>
          {plural(locale, 'count.wish', list.item_count)}
        </span>
        {list.note ? <span class="list-note">{list.note}</span> : null}
      </span>
      <span class="list-arrow" aria-hidden="true">
        →
      </span>
    </a>
  );
};

export interface FeedCard {
  id: string;
  list_id: string;
  title: string;
  image_upload_id: string | null;
  price_minor: number | null;
  currency: string;
  list_name: string;
  owner_username: string;
  claim?: ClaimView;
}

export const ListsIndex: FC<{ locale: Locale; lists: ListWithCount[]; feed: FeedCard[] }> = ({ locale, lists, feed }) => {
  const t = useT(locale);
  return (
    <>
      <PageHeader title={t('lists.title')} subtitle={t('lists.subtitle')}>
        <a class="button" href="/lists/new">
          <Icon name="plus" size={18} /> {t('lists.new')}
        </a>
      </PageHeader>

      {lists.length === 0 ? (
        <EmptyState title={t('lists.emptyTitle')} text={t('lists.emptyText')}>
          <a class="button" href="/lists/new">
            {t('lists.emptyCta')}
          </a>
        </EmptyState>
      ) : (
        <>
          <div class="section-title-row">
            <h2>{t('lists.myLists')}</h2>
          </div>
          <div class="list-grid">
            {lists.map((list) => (
              <ListCard locale={locale} list={list} />
            ))}
            <a class="list-card card list-card-new" href="/lists/new">
              <Icon name="plus" size={28} />
              <span>{t('lists.new')}</span>
            </a>
          </div>
        </>
      )}

      {feed.length > 0 ? (
        <section class="feed-section" aria-labelledby="feed-title">
          <div class="section-title-row">
            <h2 id="feed-title">
              <Icon name="users" size={18} /> {t('lists.feedTitle')}
            </h2>
            <span class="hint">{t('lists.feedText')}</span>
          </div>
          <div class="feed-track" role="list">
            {feed.map((item) => {
              const price = formatPrice(item.price_minor, item.currency, locale);
              return (
                <a class="feed-card card" role="listitem" href={`/lists/${item.list_id}#item-${item.id}`}>
                  <span class="feed-media">
                    {item.image_upload_id ? (
                      <img src={`/media/${item.image_upload_id}.webp`} alt="" loading="lazy" decoding="async" width="320" height="240" />
                    ) : (
                      <span class="item-placeholder" aria-hidden="true">
                        <Icon name="gift" size={26} />
                      </span>
                    )}
                  </span>
                  <span class="feed-body">
                    <span class="feed-title">{item.title}</span>
                    {price ? <span class="item-price">{price}</span> : null}
                    <span class="hint">{t('lists.feedFrom', { username: item.owner_username, list: item.list_name })}</span>
                    {item.claim?.state === 'mine' ? (
                      <span class="chip chip-accent">{t('claim.yours')}</span>
                    ) : item.claim?.state === 'taken' ? (
                      <span class="chip">{t('claim.taken')}</span>
                    ) : null}
                  </span>
                </a>
              );
            })}
          </div>
        </section>
      ) : null}
    </>
  );
};

export interface ListFormValues {
  name: string;
  emoji: string;
  color: number;
  note: string;
}

export const ListFormPage: FC<{
  locale: Locale;
  csrfToken: string;
  action: string;
  mode: 'create' | 'edit';
  values: ListFormValues;
  errors: string[];
}> = ({ locale, csrfToken, action, mode, values, errors }) => {
  const t = useT(locale);
  return (
    <>
      <PageHeader
        title={mode === 'create' ? t('listForm.createTitle') : t('listForm.editTitle')}
        backHref={mode === 'create' ? '/lists' : `/lists/${action.split('/').pop()}`}
        backLabel={t('actions.back')}
      />
      <form method="post" action={action} class="card form-stack form-narrow">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <FormErrors errors={errors} locale={locale} />
        <TextField name="name" label={t('listForm.name')} value={values.name} placeholder={t('listForm.namePlaceholder')} maxlength={60} required />
        <TextField
          name="emoji"
          label={t('listForm.emoji')}
          value={values.emoji}
          placeholder={t('listForm.emojiPlaceholder')}
          maxlength={16}
          hint={t('common.optional')}
        />
        <fieldset class="field color-field">
          <legend>{t('listForm.color')}</legend>
          <div class="swatches">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((color) => (
              <label class={`swatch tone-${color}`}>
                <input type="radio" name="color" value={String(color)} checked={values.color === color} required />
                <span class="visually-hidden">{t('listForm.colorOption', { n: color + 1 })}</span>
                <span class="swatch-dot" aria-hidden="true" />
              </label>
            ))}
          </div>
        </fieldset>
        <TextareaField
          name="note"
          label={t('listForm.note')}
          value={values.note}
          placeholder={t('listForm.notePlaceholder')}
          rows={3}
          maxlength={500}
        />
        <div class="form-actions">
          <button type="submit" class="button">
            {mode === 'create' ? t('listForm.submitCreate') : t('listForm.submitSave')}
          </button>
          <a class="button button-ghost" href={mode === 'create' ? '/lists' : action.replace(/\/[^/]+$/, '')}>
            {t('actions.cancel')}
          </a>
        </div>
      </form>
    </>
  );
};

const ItemActions: FC<{
  locale: Locale;
  csrfToken: string;
  item: ItemRow;
  otherLists: Array<{ id: string; name: string }>;
  isFirst: boolean;
  isLast: boolean;
}> = ({ locale, csrfToken, item, otherLists, isFirst, isLast }) => {
  const t = useT(locale);
  return (
    <details class="menu">
      <summary class="button button-ghost button-small menu-summary">
        <Icon name="settings" size={16} />
        <span>{t('itemActions.menu')}</span>
      </summary>
      <div class="menu-panel">
        <a class="menu-item" href={`/items/${item.id}/edit`}>
          <Icon name="pencil" size={16} /> {t('actions.edit')}
        </a>
        <div class="menu-order">
          <form method="post" action={`/items/${item.id}/move`}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="dir" value="up" />
            <button type="submit" class="button button-ghost button-small" disabled={isFirst}>
              <Icon name="arrow-up" size={16} /> {t('itemActions.moveUp')}
            </button>
          </form>
          <form method="post" action={`/items/${item.id}/move`}>
            <input type="hidden" name="_csrf" value={csrfToken} />
            <input type="hidden" name="dir" value="down" />
            <button type="submit" class="button button-ghost button-small" disabled={isLast}>
              <Icon name="arrow-down" size={16} /> {t('itemActions.moveDown')}
            </button>
          </form>
        </div>
        <form method="post" action={`/items/${item.id}/duplicate`}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button type="submit" class="menu-item">
            <Icon name="copy" size={16} /> {t('itemActions.duplicate')}
          </button>
        </form>
        <form method="post" action={`/items/${item.id}/${item.is_archived === 1 ? 'unarchive' : 'archive'}`}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button type="submit" class="menu-item">
            <Icon name="image" size={16} /> {item.is_archived === 1 ? t('itemActions.unarchive') : t('itemActions.archive')}
          </button>
        </form>
        {otherLists.length > 0 ? (
          <form method="post" action={`/items/${item.id}/move-to`} class="menu-move">
            <label for={`move-${item.id}`} class="menu-label">
              {t('itemActions.moveTo')}
            </label>
            <select id={`move-${item.id}`} name="list_id" class="select select-compact" required>
              {otherLists.map((list) => (
                <option value={list.id}>{list.name}</option>
              ))}
            </select>
            <button type="submit" class="button button-small">
              {t('itemActions.moveSubmit')}
            </button>
          </form>
        ) : (
          <p class="hint menu-hint">{t('itemActions.noOtherList')}</p>
        )}
        <form method="post" action={`/items/${item.id}/delete`} data-confirm={t('itemActions.deleteConfirm')}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button type="submit" class="menu-item menu-danger">
            <Icon name="trash" size={16} /> {t('itemActions.delete')}
          </button>
        </form>
      </div>
    </details>
  );
};

const ClaimPanel: FC<{
  locale: Locale;
  csrfToken: string;
  claimPath: string;
  claim: ClaimView | undefined;
  loginHref: string | null;
}> = ({ locale, csrfToken, claimPath, claim, loginHref }) => {
  const t = useT(locale);
  const state = claim?.state ?? 'open';

  if (state === 'taken') {
    return (
      <p class="claim-status">
        <span class="chip">
          <Icon name="check" size={13} /> {t('claim.taken')}
        </span>
      </p>
    );
  }

  if (state === 'mine' && claim?.state === 'mine') {
    return (
      <div class="claim-panel">
        <p class="claim-status">
          <span class="chip chip-accent">
            <Icon name="gift" size={13} /> {t('claim.yours')}
          </span>
          <span class="hint">{t(VISIBILITY_HINT_KEY[claim.visibility])}</span>
        </p>
        <form method="post" action={`${claimPath}/claim`} class="claim-form">
          <input type="hidden" name="_csrf" value={csrfToken} />
          <ClaimChoice locale={locale} selected={claim.visibility} />
          <div class="form-actions">
            <button type="submit" class="button button-secondary button-small">
              {t('claim.update')}
            </button>
          </div>
        </form>
        <form method="post" action={`${claimPath}/unclaim`} data-confirm={t('claim.unclaimConfirm')}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button type="submit" class="button button-ghost button-small">
            <Icon name="trash" size={15} /> {t('claim.unclaim')}
          </button>
        </form>
      </div>
    );
  }

  if (loginHref) {
    return (
      <div class="claim-panel">
        <a class="button button-secondary button-small" href={loginHref}>
          <Icon name="gift" size={15} /> {t('claim.loginToClaim')}
        </a>
      </div>
    );
  }

  return (
    <div class="claim-panel">
      <form method="post" action={`${claimPath}/claim`} class="claim-form">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <ClaimChoice locale={locale} selected={VISIBILITY.HIDDEN} />
        <div class="form-actions">
          <button type="submit" class="button button-small">
            <Icon name="gift" size={15} /> {t('claim.submit')}
          </button>
        </div>
      </form>
    </div>
  );
};

const VISIBILITY_HINT_KEY: Record<Visibility, string> = {
  0: 'claim.surpriseHint',
  1: 'claim.statusHint',
  2: 'claim.visibleHint',
};

const ClaimChoice: FC<{ locale: Locale; selected: Visibility }> = ({ locale, selected }) => {
  const t = useT(locale);
  const options: Array<{ value: Visibility; label: string; hint: string }> = [
    { value: VISIBILITY.HIDDEN, label: t('claim.surprise'), hint: t('claim.surpriseHint') },
    { value: VISIBILITY.STATUS, label: t('claim.status'), hint: t('claim.statusHint') },
    { value: VISIBILITY.NAMED, label: t('claim.visible'), hint: t('claim.visibleHint') },
  ];
  return (
    <fieldset class="claim-choice">
      <legend>{t('claim.choiceLabel')}</legend>
      {options.map((option) => (
        <label class="claim-option">
          <input type="radio" name="visibility" value={String(option.value)} checked={option.value === selected} />
          <span>
            <strong>{option.label}</strong>
            <span class="hint">{option.hint}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
};

export interface ItemCardProps {
  locale: Locale;
  csrfToken: string;
  item: ItemWithLinks;
  otherLists: Array<{ id: string; name: string }>;
  isFirst: boolean;
  isLast: boolean;
  readOnly?: boolean;
  mediaBase?: string;
  claim?: ClaimView;
  claimPath?: string | null;
  loginHref?: string | null;
}

export const ItemCard: FC<ItemCardProps> = ({
  locale,
  csrfToken,
  item,
  otherLists,
  isFirst,
  isLast,
  readOnly = false,
  mediaBase = '/media',
  claim,
  claimPath = null,
  loginHref = null,
}) => {
  const t = useT(locale);
  const price = formatPrice(item.price_minor, item.currency, locale);
  return (
    <article class="item-card card" id={`item-${item.id}`}>
      <div class="item-media">
        {item.image_upload_id ? (
          <img
            src={`${mediaBase}/${item.image_upload_id}.webp`}
            alt={t('item.imageAlt', { title: item.title })}
            loading="lazy"
            decoding="async"
            width="640"
            height="480"
          />
        ) : (
          <div class="item-placeholder" aria-hidden="true">
            <Icon name="image" size={30} />
            <span>{t('item.noImage')}</span>
          </div>
        )}
      </div>
      <div class="item-content">
        <div class="item-head">
          <h3 class="item-title">{item.title}</h3>
          <Hearts value={item.priority} label={t('priority.label', { label: t(`priority.${item.priority}`) })} />
        </div>
        <div class="item-meta">
          {price ? <span class="item-price">{price}</span> : null}
          {item.quantity > 1 ? <span class="chip">{t('item.quantity', { count: item.quantity })}</span> : null}
          {item.size ? <span class="chip">{t('item.size')}: {item.size}</span> : null}
          {item.color ? <span class="chip">{t('item.color')}: {item.color}</span> : null}
        </div>
        {item.notes ? <p class="item-notes">{item.notes}</p> : null}
        {item.url || item.links.length > 0 ? (
          <ul class="item-links">
            {item.url ? (
              <li>
                <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">
                  {hostnameOf(item.url)} <Icon name="external" size={13} />
                  <span class="visually-hidden"> ({t('a11y.external')})</span>
                </a>
              </li>
            ) : null}
            {item.links.map((link) => (
              <li>
                <a href={link.url} target="_blank" rel="noopener noreferrer nofollow">
                  {link.label || hostnameOf(link.url)} <Icon name="external" size={13} />
                  <span class="visually-hidden"> ({t('a11y.external')})</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}
        {readOnly && claimPath ? (
          <ClaimPanel locale={locale} csrfToken={csrfToken} claimPath={claimPath} claim={claim} loginHref={loginHref} />
        ) : null}
        {!readOnly && claim?.state === 'revealed' ? (
          <p class="claim-status">
            <span class="chip chip-accent">
              <Icon name="gift" size={13} /> {t('claim.claimedBy', { username: claim.username })}
            </span>
          </p>
        ) : null}
        {!readOnly && claim?.state === 'claimed' ? (
          <p class="claim-status">
            <span class="chip">
              <Icon name="gift" size={13} /> {t('claim.claimedAnonymous')}
            </span>
          </p>
        ) : null}
        {readOnly ? null : (
          <div class="item-foot">
            <ItemActions locale={locale} csrfToken={csrfToken} item={item} otherLists={otherLists} isFirst={isFirst} isLast={isLast} />
          </div>
        )}
      </div>
    </article>
  );
};

export const ArchivedItemCard: FC<{ locale: Locale; csrfToken: string; item: ItemRow }> = ({ locale, csrfToken, item }) => {
  const t = useT(locale);
  return (
    <div class="archived-item card" id={`item-${item.id}`}>
      <div class="archived-main">
        <strong>{item.title}</strong>
        <span class="chip">{t('item.archived')}</span>
      </div>
      <div class="archived-actions">
        <form method="post" action={`/items/${item.id}/unarchive`}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button type="submit" class="button button-ghost button-small">
            <Icon name="arrow-up" size={16} /> {t('itemActions.unarchive')}
          </button>
        </form>
        <form method="post" action={`/items/${item.id}/delete`} data-confirm={t('itemActions.deleteConfirm')}>
          <input type="hidden" name="_csrf" value={csrfToken} />
          <button type="submit" class="button button-ghost button-small menu-danger">
            <Icon name="trash" size={16} /> {t('actions.delete')}
          </button>
        </form>
      </div>
    </div>
  );
};

export type ListViewMode = 'owner' | 'group' | 'public';

export interface ListDetailProps {
  locale: Locale;
  csrfToken: string;
  list: ListRow;
  items: ItemWithLinks[];
  archivedItems: ItemRow[];
  archivedCount: number;
  showArchived: boolean;
  otherLists: Array<{ id: string; name: string }>;
  mode?: ListViewMode;
  ownerName?: string;
  sharedGroups?: Array<{ id: string; name: string }>;
  publicUrl?: string | null;
  token?: string | null;
  claims?: Map<string, ClaimView>;
  viewerId?: string | null;
}

export const ListDetail: FC<ListDetailProps> = ({
  locale,
  csrfToken,
  list,
  items,
  archivedItems,
  archivedCount,
  showArchived,
  otherLists,
  mode = 'owner',
  ownerName,
  sharedGroups = [],
  publicUrl = null,
  token = null,
  claims = new Map<string, ClaimView>(),
  viewerId = null,
}) => {
  const t = useT(locale);
  const isOwner = mode === 'owner';
  const isGroup = mode === 'group';
  const isPublic = mode === 'public';
  const readOnly = !isOwner;
  const mediaBase = isPublic && token ? `/s/${token}/media` : '/media';
  const loginHref = isPublic && token && !viewerId ? `/login?next=${encodeURIComponent(`/s/${token}`)}` : null;
  const claimPathFor = (itemId: string): string | null => {
    if (isGroup) return `/items/${itemId}`;
    if (isPublic && token) return `/s/${token}/items/${itemId}`;
    return null;
  };
  const backHref = isGroup ? '/groups' : isPublic ? undefined : '/lists';
  const title = `${list.emoji ? `${list.emoji} ` : ''}${list.name}`;
  const sharedCount = sharedGroups.length;
  const statusIcon = publicUrl ? 'link' : sharedCount > 0 ? 'users' : 'lock';
  const statusLabel = publicUrl ? t('common.public') : sharedCount > 0 ? t('common.shared') : t('common.private');
  const statusDetail = publicUrl
    ? t('listPage.publicOn')
    : sharedCount > 0
      ? plural(locale, 'count.group', sharedCount)
      : t('lists.privateHint');

  return (
    <>
      <PageHeader title={title} subtitle={list.note || undefined} backHref={backHref} backLabel={isGroup ? t('groups.title') : t('common.backToLists')} />

      {isOwner ? (
        <div class="list-toolbar">
          <a class="button button-large" href={`/lists/${list.id}/items/new`}>
            <Icon name="plus" size={18} /> {t('listPage.addItem')}
          </a>
          <a class="chip list-status" href={`/lists/${list.id}/share`}>
            <Icon name={statusIcon} size={13} /> {statusLabel}
            <span class="dot" aria-hidden="true">·</span>
            {statusDetail}
          </a>
          <span class="chip">{plural(locale, 'count.wish', items.length)}</span>
          <details class="menu list-menu">
            <summary class="button button-ghost button-small">
              {t('listPage.more')} <Icon name="chevron-down" size={14} />
            </summary>
            <div class="menu-panel">
              <a class="menu-item" href={`/lists/${list.id}/edit`}>
                <Icon name="pencil" size={16} /> {t('listPage.editList')}
              </a>
              <a class="menu-item" href={`/lists/${list.id}/share`}>
                <Icon name="link" size={16} /> {t('listPage.sharingLink')}
              </a>
              <form method="post" action={`/lists/${list.id}/delete`} data-confirm={t('listPage.deleteConfirm')}>
                <input type="hidden" name="_csrf" value={csrfToken} />
                <button type="submit" class="menu-item menu-danger">
                  <Icon name="trash" size={16} /> {t('listPage.deleteList')}
                </button>
              </form>
            </div>
          </details>
        </div>
      ) : isGroup ? (
        <div class="list-toolbar">
          <span class="chip">
            <Icon name="users" size={13} /> {t('listPage.groupViewOwner', { username: ownerName ?? '' })}
          </span>
          <span class="chip">{plural(locale, 'count.wish', items.length)}</span>
        </div>
      ) : (
        <div class="list-toolbar">
          <span class="chip">
            <Icon name="link" size={13} /> {t('common.public')}
          </span>
          <span class="chip">{plural(locale, 'count.wish', items.length)}</span>
        </div>
      )}

      {isGroup ? <p class="hint shared-hint">{t('listPage.groupViewHint')}</p> : null}
      {isPublic ? (
        <div class="notice notice-info shared-public-note" role="status">
          <Icon name="sparkles" size={18} />
          <span>{t('listPage.publicViewHint')}</span>
        </div>
      ) : null}

      {isOwner && items.length === 0 ? <p class="hint empty-hint">{t('listPage.emptyText')}</p> : null}
      {!isOwner && items.length === 0 ? (
        <EmptyState title={t('listPage.emptySharedTitle')} text={t('listPage.emptySharedText')} />
      ) : null}
      {isOwner || items.length > 0 ? (
        <div class="item-grid">
          {items.map((item, index) => (
            <ItemCard
              locale={locale}
              csrfToken={csrfToken}
              item={item}
              otherLists={otherLists}
              isFirst={index === 0}
              isLast={index === items.length - 1}
              readOnly={readOnly}
              mediaBase={mediaBase}
              claim={claims.get(item.id)}
              claimPath={claimPathFor(item.id)}
              loginHref={loginHref}
            />
          ))}
        </div>
      ) : null}

      {isPublic ? (
        <p class="shared-public-footer">
          <Icon name="heart" size={14} /> {t('listPage.publicViewFooter')}
        </p>
      ) : null}

      {isOwner && archivedCount > 0 ? (
        <section class="archived-section">
          <div class="section-title-row">
            <h2>
              {t('listPage.archived')} <span class="count-badge">{archivedCount}</span>
            </h2>
            <a class="button button-ghost button-small" href={showArchived ? `/lists/${list.id}` : `/lists/${list.id}?archived=1`}>
              {showArchived ? t('listPage.hideArchived') : t('listPage.showArchived')}
            </a>
          </div>
          {showArchived ? (
            <div class="archived-list">
              {archivedItems.map((item) => (
                <ArchivedItemCard locale={locale} csrfToken={csrfToken} item={item} />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
};

export const ListSharePage: FC<{
  locale: Locale;
  csrfToken: string;
  list: ListRow;
  sharedGroups: Array<{ id: string; name: string }>;
  availableGroups: Array<{ id: string; name: string }>;
  publicUrl: string | null;
}> = ({ locale, csrfToken, list, sharedGroups, availableGroups, publicUrl }) => {
  const t = useT(locale);
  return (
    <>
      <PageHeader
        title={t('listPage.shareTitle')}
        subtitle={`${list.emoji ? `${list.emoji} ` : ''}${list.name}`}
        backHref={`/lists/${list.id}`}
        backLabel={list.name}
      />

      <section class="card settings-card" id="groups">
        <h2>
          <Icon name="users" size={18} /> {t('listPage.shareGroupsTitle')}
        </h2>
        <p class="hint">{t('listPage.shareGroupsText')}</p>

        {sharedGroups.length > 0 ? (
          <>
            <p class="share-label">{t('listPage.sharedWith')}</p>
            <ul class="share-group-list">
              {sharedGroups.map((group) => (
                <li class="share-group-row">
                  <a href={`/groups/${group.id}`}>
                    <Icon name="users" size={15} /> {group.name}
                  </a>
                  <form method="post" action={`/lists/${list.id}/unshare`} data-confirm={t('listPage.unshareConfirm', { group: group.name })}>
                    <input type="hidden" name="_csrf" value={csrfToken} />
                    <input type="hidden" name="group_id" value={group.id} />
                    <button type="submit" class="button button-ghost button-small">
                      {t('listPage.unshare')}
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {availableGroups.length > 0 ? (
          <form method="post" action={`/lists/${list.id}/share`} class="form-stack form-narrow share-form">
            <input type="hidden" name="_csrf" value={csrfToken} />
            <div class="field">
              <label for="share-group">{t('listPage.shareGroupsTitle')}</label>
              <select id="share-group" name="group_id" class="select" required>
                {availableGroups.map((group) => (
                  <option value={group.id}>{group.name}</option>
                ))}
              </select>
            </div>
            <div class="form-actions">
              <button type="submit" class="button button-small">
                <Icon name="users" size={16} /> {t('listPage.shareGroupSubmit')}
              </button>
            </div>
          </form>
        ) : sharedGroups.length === 0 ? (
          <p class="hint">
            {t('listPage.noGroups')} <a href="/groups/new">{t('listPage.createGroup')}</a>
          </p>
        ) : null}
      </section>

      <section class="card settings-card" id="public">
        <h2>
          <Icon name="link" size={18} /> {t('listPage.publicTitle')}
        </h2>
        <p class="hint">{t('listPage.publicText')}</p>
        {publicUrl ? (
          <>
            <span class="chip chip-accent">
              <Icon name="link" size={13} /> {t('listPage.publicOn')}
            </span>
            <div class="copy-row">
              <code class="copy-value" id="public-link">
                {publicUrl}
              </code>
              <button type="button" class="button button-ghost button-small" data-copy-target="public-link" data-copied-label={t('actions.copied')}>
                <Icon name="copy" size={15} /> <span data-copy-label>{t('listPage.publicCopy')}</span>
              </button>
            </div>
            <div class="form-actions">
              <form method="post" action={`/lists/${list.id}/public/regenerate`} data-confirm={t('listPage.publicRegenerateConfirm')}>
                <input type="hidden" name="_csrf" value={csrfToken} />
                <button type="submit" class="button button-ghost button-small">
                  <Icon name="sparkles" size={16} /> {t('listPage.publicRegenerate')}
                </button>
              </form>
              <form method="post" action={`/lists/${list.id}/public/disable`} data-confirm={t('listPage.publicDisableConfirm')}>
                <input type="hidden" name="_csrf" value={csrfToken} />
                <button type="submit" class="button button-ghost button-small">
                  <Icon name="lock" size={16} /> {t('listPage.publicDisable')}
                </button>
              </form>
            </div>
          </>
        ) : (
          <>
            <p class="hint">{t('listPage.publicOff')}</p>
            <form method="post" action={`/lists/${list.id}/public/enable`}>
              <input type="hidden" name="_csrf" value={csrfToken} />
              <div class="form-actions">
                <button type="submit" class="button button-secondary button-small">
                  <Icon name="link" size={16} /> {t('listPage.publicEnable')}
                </button>
              </div>
            </form>
          </>
        )}
      </section>
    </>
  );
};

export interface ItemFormValues {
  title: string;
  url: string;
  price: string;
  currency: string;
  quantity: number;
  priority: number;
  notes: string;
  size: string;
  color: string;
  links: Array<{ label: string; url: string }>;
}

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'CAD', 'AUD', 'NZD', 'JPY'];

export const ItemFormPage: FC<{
  locale: Locale;
  csrfToken: string;
  action: string;
  mode: 'create' | 'edit';
  values: ItemFormValues;
  errors: string[];
  cancelHref: string;
  imageId: string | null;
  maxUploadMb: number;
  previewAction?: string;
}> = ({ locale, csrfToken, action, mode, values, errors, cancelHref, imageId, maxUploadMb, previewAction }) => {
  const t = useT(locale);
  const rows = [...values.links];
  while (rows.length < 5) rows.push({ label: '', url: '' });
  const linksOpen = values.links.some((link) => link.label !== '' || link.url !== '');

  return (
    <>
      <PageHeader title={mode === 'create' ? t('itemForm.addTitle') : t('itemForm.editTitle')} backHref={cancelHref} backLabel={t('actions.back')} />
      <form method="post" action={action} enctype="multipart/form-data" class="card form-stack form-wide">
        <input type="hidden" name="_csrf" value={csrfToken} />
        <FormErrors errors={errors} locale={locale} />

        <TextField name="title" label={t('itemForm.title')} value={values.title} placeholder={t('itemForm.titlePlaceholder')} maxlength={120} required />
        <TextField name="url" label={t('itemForm.url')} value={values.url} placeholder={t('itemForm.urlPlaceholder')} inputmode="url" hint={t('itemForm.urlHint')} />
        {previewAction ? (
          <div class="form-actions">
            <button type="submit" formaction={previewAction} formmethod="get" formnovalidate class="button button-ghost button-small">
              <Icon name="external" size={15} /> {t('itemForm.fillFromLink')}
            </button>
          </div>
        ) : null}

        <div class="field">
          <label for="field-image">{t('itemForm.image')}</label>
          {imageId ? (
            <div class="current-image">
              <img src={`/media/${imageId}.webp`} alt={t('itemForm.imageCurrent')} width="200" height="150" />
              <div class="checkbox-field">
                <input type="checkbox" id="field-remove-image" name="remove_image" value="1" />
                <label for="field-remove-image">{t('itemForm.removeImage')}</label>
              </div>
            </div>
          ) : null}
          <input id="field-image" name="image" type="file" accept="image/jpeg,image/png,image/webp,image/gif" class="file-input" />
          <p class="hint">{t('itemForm.imageHint', { mb: maxUploadMb })}</p>
        </div>

        <div class="field-row">
          <TextField name="price" label={t('itemForm.price')} value={values.price} placeholder={t('itemForm.pricePlaceholder')} inputmode="decimal" />
          <div class="field">
            <label for="field-currency">{t('currency.label')}</label>
            <input id="field-currency" name="currency" value={values.currency} maxlength={3} required list="currency-list" class="uppercase" />
            <datalist id="currency-list">
              {CURRENCIES.map((code) => (
                <option value={code} />
              ))}
            </datalist>
            <p class="hint">{t('currency.hint')}</p>
          </div>
        </div>

        <div class="field-row">
          <TextField name="quantity" label={t('itemForm.quantity')} value={String(values.quantity)} type="number" min={1} max={999} inputmode="numeric" />
          <SelectField
            name="priority"
            label={t('itemForm.priority')}
            value={String(values.priority)}
            options={[0, 1, 2, 3].map((n) => ({ value: String(n), label: `${'♥'.repeat(n)}${'♡'.repeat(3 - n)} ${t(`priority.${n}`)}`.trim() }))}
          />
        </div>

        <div class="field-row">
          <TextField name="size" label={t('itemForm.size')} value={values.size} placeholder={t('itemForm.sizePlaceholder')} maxlength={40} />
          <TextField name="color" label={t('itemForm.color')} value={values.color} placeholder={t('itemForm.colorPlaceholder')} maxlength={40} />
        </div>

        <TextareaField name="notes" label={t('itemForm.notes')} value={values.notes} placeholder={t('itemForm.notesPlaceholder')} rows={4} maxlength={2000} />

        <details class="links-block" open={linksOpen}>
          <summary>
            <Icon name="external" size={16} /> {t('itemForm.links')}
          </summary>
          <p class="hint">{t('itemForm.linksHint')}</p>
          {rows.map((row, index) => (
            <div class="link-row">
              <input
                name="linkLabels"
                value={row.label}
                placeholder={t('itemForm.linkLabelPlaceholder')}
                maxlength={40}
                aria-label={`${t('itemForm.linkLabel')} ${index + 1}`}
              />
              <input
                name="linkUrls"
                value={row.url}
                placeholder="https://"
                inputmode="url"
                aria-label={`${t('itemForm.linkUrl')} ${index + 1}`}
              />
            </div>
          ))}
        </details>

        <div class="form-actions">
          <button type="submit" class="button">
            {mode === 'create' ? t('itemForm.submitAdd') : t('itemForm.submitSave')}
          </button>
          <a class="button button-ghost" href={cancelHref}>
            {t('actions.cancel')}
          </a>
        </div>
      </form>
    </>
  );
};

import type { Context, Hono } from 'hono';
import type { AppEnv } from '../types.js';
import { requireUser } from '../middleware/auth.js';
import { formString } from '../lib/forms.js';
import { listAccess } from '../lib/access.js';
import { claimTarget, parseVisibility, removeClaim, setClaim } from '../lib/claims.js';
import type { ClaimTarget } from '../lib/claims.js';
import { redirectWithNotice } from '../views/layout.js';
import { badRequest, forbidden, notFound } from '../views/errors.js';

const PUBLIC_TOKEN_RE = /^[A-Za-z0-9_-]{24,64}$/;

function handleClaim(c: Context<AppEnv>, target: ClaimTarget, userId: string, back: string): Response {
  if (target.ownerId === userId) return forbidden(c);
  if (target.archived) return badRequest(c);
  const visibility = parseVisibility(formString(c.get('form'), 'visibility'));
  if (visibility === null) return badRequest(c);
  const anchor = `${back}#item-${target.itemId}`;
  const result = setClaim(c.get('db'), target.itemId, userId, visibility);
  if (result === 'taken') return redirectWithNotice(c, anchor, 'claimTaken');
  c.get('logger').info('item.claimed', { userId, itemId: target.itemId, visibility });
  return redirectWithNotice(c, anchor, 'claimSaved');
}

function handleUnclaim(c: Context<AppEnv>, target: ClaimTarget, userId: string, back: string): Response {
  if (target.ownerId === userId) return forbidden(c);
  removeClaim(c.get('db'), target.itemId, userId);
  c.get('logger').info('item.unclaimed', { userId, itemId: target.itemId });
  return redirectWithNotice(c, `${back}#item-${target.itemId}`, 'claimRemoved');
}

export function registerClaimRoutes(app: Hono<AppEnv>): void {
  app.post('/items/:id/claim', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const target = claimTarget(db, c.req.param('id'));
    if (!target) return notFound(c);
    if (!listAccess(db, target.listId, user.id)) return notFound(c);
    return handleClaim(c, target, user.id, `/lists/${target.listId}`);
  });

  app.post('/items/:id/unclaim', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const db = c.get('db');
    const target = claimTarget(db, c.req.param('id'));
    if (!target) return notFound(c);
    if (!listAccess(db, target.listId, user.id)) return notFound(c);
    return handleUnclaim(c, target, user.id, `/lists/${target.listId}`);
  });

  app.post('/s/:token/items/:id/claim', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const token = c.req.param('token');
    const target = claimTarget(c.get('db'), c.req.param('id'));
    if (!target || !PUBLIC_TOKEN_RE.test(token) || target.publicToken !== token) return notFound(c);
    return handleClaim(c, target, user.id, `/s/${token}`);
  });

  app.post('/s/:token/items/:id/unclaim', requireUser, (c) => {
    const user = c.get('user');
    if (!user) return c.redirect('/login', 303);
    const token = c.req.param('token');
    const target = claimTarget(c.get('db'), c.req.param('id'));
    if (!target || !PUBLIC_TOKEN_RE.test(token) || target.publicToken !== token) return notFound(c);
    return handleUnclaim(c, target, user.id, `/s/${token}`);
  });
}

import { getSetting, setSetting } from '../db/index.js';
import type { DB } from '../db/index.js';

export const CAMPAIGN_MAX_LENGTH = 200;

/** A short message the admin can show at the top of the home pages. */
export interface Campaign {
  enabled: boolean;
  text: string;
}

const OFF: Campaign = { enabled: false, text: '' };

export function getCampaign(db: DB): Campaign {
  const raw = getSetting(db, 'campaign');
  if (!raw) return OFF;
  try {
    const value = JSON.parse(raw) as Partial<Campaign>;
    return {
      enabled: value.enabled === true,
      text: typeof value.text === 'string' ? value.text.slice(0, CAMPAIGN_MAX_LENGTH) : '',
    };
  } catch {
    return OFF;
  }
}

export function saveCampaign(db: DB, campaign: Campaign): void {
  setSetting(db, 'campaign', JSON.stringify({ enabled: campaign.enabled, text: campaign.text.slice(0, CAMPAIGN_MAX_LENGTH) }));
}

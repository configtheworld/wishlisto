export interface ListRow {
  id: string;
  user_id: string;
  name: string;
  emoji: string;
  color: number;
  note: string;
  public_token?: string | null;
  created_at: number;
  updated_at: number;
}

export interface ItemRow {
  id: string;
  list_id: string;
  user_id: string;
  title: string;
  url: string;
  image_upload_id: string | null;
  price_minor: number | null;
  currency: string;
  quantity: number;
  priority: number;
  notes: string;
  size: string;
  color: string;
  is_archived: number;
  position: number;
  created_at: number;
  updated_at: number;
}

export interface ItemLinkRow {
  id: string;
  item_id: string;
  label: string;
  url: string;
  position: number;
}

export interface ItemWithLinks extends ItemRow {
  links: ItemLinkRow[];
}

export interface ListWithCount extends ListRow {
  item_count: number;
  share_count?: number;
  public_token?: string | null;
}

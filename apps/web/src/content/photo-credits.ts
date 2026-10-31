// Photographs that someone else took, with the creator and licence, shown on /credits.
// The catalogue photographs are supplied by PAISLEY art, so there is nothing to credit yet;
// add an entry here (and the /credits link appears in the footer) for any third-party photo.
export type PhotoCredit = {
  slug: string;
  product: string;
  title: string;
  creator: string;
  license: string;
  licenseVersion?: string | null;
  source: string;
  via: string;
};

export const PHOTO_CREDITS: readonly PhotoCredit[] = [];

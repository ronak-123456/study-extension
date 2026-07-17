// Shared utility functions for the background service worker

/**
 * Local calendar date as YYYY-MM-DD. Used for all daily stat keys so they line
 * up with the local clock (getHours) instead of drifting a day at UTC midnight.
 */
export function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getDomain(url) {
  if (!url || isSkippableUrl(url)) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

export function isSkippableUrl(url) {
  return (
    !url ||
    url.startsWith('chrome://') ||
    url.startsWith('about:') ||
    url.startsWith('edge://') ||
    url.startsWith('brave://') ||
    url.startsWith('chrome-extension://')
  );
}

// Sign-in / OAuth / system domains. These are never treated as distractions:
// no nudges, no allowance countdowns, and no stat tracking.
const NEUTRAL_DOMAINS = [
  'accounts.google.com',
  'accounts.youtube.com',
  'oauth2.googleapis.com',
  'content.googleapis.com',
  'login.microsoftonline.com',
  'login.live.com',
  'appleid.apple.com',
  'auth.openai.com'
];

export function isNeutralDomain(domain) {
  if (!domain) return false;
  return NEUTRAL_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
}

// Search engines are NOT neutral by default — searching random things is a
// distraction. But searching *for one of your allowed sites* (to open it) is
// just a transit step, so we suppress the nudge only in that case.
const SEARCH_ENGINE_HOSTS = [
  'google.com', 'bing.com', 'duckduckgo.com', 'search.brave.com',
  'ecosia.org', 'startpage.com', 'search.yahoo.com', 'yandex.com'
];

/**
 * The query string typed into a search engine, or null if the URL isn't a
 * search-results page.
 */
function getSearchQuery(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const isSearch = SEARCH_ENGINE_HOSTS.some(d => host === d || host.endsWith('.' + d));
    if (!isSearch) return null;
    const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('p');
    return q ? q.toLowerCase().trim() : null;
  } catch (e) {
    return null;
  }
}

/** The distinctive label of a domain, e.g. "wikipedia" from "en.wikipedia.org". */
function domainKeyword(domain) {
  const parts = domain.replace(/^www\./, '').split('.');
  return parts.length >= 2 ? parts[parts.length - 2] : parts[0];
}

/**
 * True when the URL is a search for one of the user's allowed study sites —
 * i.e. the user is searching to *reach* an allowed site, not to get distracted.
 */
export function isAllowedSiteSearch(url, studyDomains) {
  const q = getSearchQuery(url);
  if (!q || !studyDomains || studyDomains.length === 0) return false;
  return studyDomains.some(d => {
    const keyword = domainKeyword(d);
    return q.includes(d) || (keyword.length >= 3 && q.includes(keyword));
  });
}

export function formatTimeShort(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

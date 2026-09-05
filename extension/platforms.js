// Exact HTTPS hosts only. Registry tests keep the manifest in sync.
export const PLATFORMS = Object.freeze([
  { id: 'youtube', name: 'YouTube / Shorts', hosts: ['www.youtube.com', 'youtube.com', 'm.youtube.com', 'music.youtube.com'] },
  { id: 'instagram', name: 'Instagram', hosts: ['www.instagram.com', 'instagram.com'] },
  { id: 'facebook', name: 'Facebook', hosts: ['www.facebook.com', 'facebook.com', 'm.facebook.com', 'web.facebook.com'] },
  { id: 'tiktok', name: 'TikTok', hosts: ['www.tiktok.com', 'tiktok.com'] },
  { id: 'x', name: 'X / Twitter', hosts: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'] },
  { id: 'reddit', name: 'Reddit', hosts: ['www.reddit.com', 'reddit.com', 'old.reddit.com', 'new.reddit.com'] },
  { id: 'twitch', name: 'Twitch', hosts: ['www.twitch.tv', 'twitch.tv', 'player.twitch.tv'] },
  { id: 'vimeo', name: 'Vimeo', hosts: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'] },
  { id: 'netflix', name: 'Netflix', hosts: ['www.netflix.com', 'netflix.com'] },
  { id: 'prime-video', name: 'Prime Video', hosts: ['www.primevideo.com', 'primevideo.com'] },
  { id: 'disney-plus', name: 'Disney+', hosts: ['www.disneyplus.com', 'disneyplus.com'] },
  { id: 'hulu', name: 'Hulu', hosts: ['www.hulu.com', 'hulu.com'] },
  { id: 'max', name: 'HBO Max / Max', hosts: ['www.hbomax.com', 'hbomax.com', 'play.hbomax.com', 'www.max.com', 'max.com', 'play.max.com'] },
  { id: 'apple-tv', name: 'Apple TV', hosts: ['tv.apple.com'] },
  { id: 'peacock', name: 'Peacock', hosts: ['www.peacocktv.com', 'peacocktv.com'] },
  { id: 'paramount-plus', name: 'Paramount+', hosts: ['www.paramountplus.com', 'paramountplus.com'] },
  { id: 'spotify', name: 'Spotify Web', hosts: ['open.spotify.com'] },
  { id: 'apple-music', name: 'Apple Music', hosts: ['music.apple.com'] },
  { id: 'soundcloud', name: 'SoundCloud', hosts: ['soundcloud.com', 'www.soundcloud.com'] },
].map(platform => Object.freeze({ ...platform, hosts: Object.freeze(platform.hosts), matches: Object.freeze(platform.hosts.map(host => `https://${host}/*`)), supportTier: 'standard-media-adapter', liveVerified: false })));

export const SITE_MATCHES = Object.freeze(PLATFORMS.flatMap(platform => platform.matches));
export const DEFAULT_MATCHES = Object.freeze(['https://www.youtube.com/*']);
export const OPTIONAL_MATCHES = Object.freeze(SITE_MATCHES.filter(match => !DEFAULT_MATCHES.includes(match)));
export function platformFor(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password) return null;
    return PLATFORMS.find(platform => platform.hosts.includes(parsed.hostname)) ?? null;
  } catch { return null; }
}
export function permissionFor(url) {
  return platformFor(url) ? `https://${new URL(url).hostname}/*` : null;
}

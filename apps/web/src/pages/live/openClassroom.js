/**
 * Opens a classroom that runs outside this app: a meeting link, or the plugNmeet client (which
 * returns to the academy's Live classes page when the person leaves). New tab when allowed,
 * otherwise this tab, so a popup blocker never leaves the person stuck.
 */
export function openClassroom(r) {
  const w = window.open(r.joinUrl, '_blank');
  if (w) w.opener = null;
  else window.location.assign(r.joinUrl);
}

/** True when the join response is opened by URL instead of the built-in LiveKit room. */
export const opensByUrl = (r) => ['EXTERNAL', 'PLUGNMEET', 'ZOOM', 'GOOGLE_MEET'].includes(r?.provider);

export const providerLabel = (p) => ({ PLUGNMEET: 'plugNmeet classroom', LIVEKIT: 'Built-in classroom', EXTERNAL: 'Meeting link', ZOOM: 'Zoom', GOOGLE_MEET: 'Google Meet' })[p] ?? p;

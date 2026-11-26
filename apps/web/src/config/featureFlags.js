/**
 * Temporary product UI flags. Flip a value to re-enable a surface without
 * restoring deleted code. API routes stay available regardless.
 */
export const FEATURE_FLAGS = Object.freeze({
  /** Creator AI studio page, Learning sidebar link, and in-editor Draft/Generate with AI. */
  AI_STUDIO: false,
  /** Creator sidebar "Website" section (Website builder). Route `/creator/website` stays reachable via deep link. */
  WEBSITE_SIDEBAR: false,
});

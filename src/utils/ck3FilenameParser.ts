const UTILITY_PREFIX_REGEX = /^(?:img|image|screenshot|untitled|photo|dsc)/i;
const NON_PORTRAIT_WORD_REGEX =
  /\b(?:background|collage|prototype|diagram|mates|staging|throne|screenshot|untitled|banner|frame|test|preview|output)\b/i;
const VALID_NAME_REGEX = /^[A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ\s'-]*$/;

/**
 * Parses a portrait filename into a readable character nameplate, or returns ""
 * if no clean character name can be detected.
 * Examples:
 * - "1-1-Arthur.png" -> "Arthur"
 * - "0-Eleanor-70.png" -> "Eleanor"
 * - "background.png" -> ""
 * - "IMG_4821.png" -> ""
 */
export function parseCharacterNameFromFilename(fileName: string): string {
  // Strip extension
  let base = fileName.replace(/\.[^/.]+$/, '').trim();

  if (!base || UTILITY_PREFIX_REGEX.test(base) || NON_PORTRAIT_WORD_REGEX.test(base)) {
    return '';
  }

  // Strip leading CK3 generation/branch/ancestor prefixes ("0-", "1-1-", "0s-1-", "Gen1-", "Ancestor-")
  base = base.replace(/^(?:\d+s?[-_])+/, '');
  base = base.replace(/^(?:gen[-_]?\d+[-_]|ancestor[-_])/i, '');

  // Strip trailing age suffixes like "-70", "-16", "_50"
  base = base.replace(/[-_]\d{1,3}$/, '');

  // Convert underscores to spaces and collapse whitespace
  base = base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

  if (!VALID_NAME_REGEX.test(base)) {
    return '';
  }

  return base;
}

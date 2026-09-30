/**
 * GharSaathi+ colour palette - the single source of truth.
 * Never hard-code a hex anywhere else in the app.
 *
 * Token                Hex        Usage
 * -------------------------------------------------------------------------
 * Primary (Brand Teal) #1F4E79    App bar, primary buttons, active tab, links
 * Primary Dark         #163A5C    Pressed / active button state
 * Primary Tint         #E6EEF6    Selected-day highlight, chips, active nav bg
 * Secondary (Amber)    #D9772E    Secondary buttons, "pending" badges
 * Success              #16A34A    Present / on-time status / successful entry
 * Error                #DC2626    Error messages, invalid-input textbox outline
 * Warning              #D97706    Half-day / late / pending
 * Info                 #2563EB    Work-from-home / info tags
 * Background           #F7F9FC    Screen background
 * Surface / Card       #FFFFFF    Cards, list rows
 * Border               #DCE3EC    Card borders, dividers
 * Text Primary         #14283D    Headings, primary text
 * Text Secondary       #5B6B7D    Captions, secondary text
 * Text Disabled        #A3AFBD    Disabled labels
 */
export const colors = {
  /** App bar, primary buttons, active tab, links. */
  primary: '#1F4E79',
  /** Pressed / active button state. */
  primaryDark: '#163A5C',
  /** Selected-day highlight, chips, active nav background. */
  primaryTint: '#E6EEF6',

  /** Secondary buttons, "pending" badges. */
  secondary: '#D9772E',

  /** Present / on-time status / successful entry. */
  success: '#16A34A',
  /** Error messages, invalid-input textbox outline. */
  error: '#DC2626',
  /** Half-day / late / pending. */
  warning: '#D97706',
  /** Work-from-home / info tags. */
  info: '#2563EB',

  /** Screen background. */
  background: '#F7F9FC',
  /** Cards, list rows. */
  surface: '#FFFFFF',
  /** Card borders, dividers. */
  border: '#DCE3EC',

  /** Headings, primary text. */
  textPrimary: '#14283D',
  /** Captions, secondary text. */
  textSecondary: '#5B6B7D',
  /** Disabled labels. */
  textDisabled: '#A3AFBD',

  // --- Derived, not part of the published palette ---------------------------
  /** Text/icons placed on top of Primary, Success, Error, Warning or Info. */
  onColor: '#FFFFFF',
  /**
   * Secondary lightened for use *on* Primary. The published Secondary only
   * reaches 2.7:1 against Primary; this clears 4:1, so the accent letters in
   * the splash wordmark stay readable.
   */
  secondaryOnColor: '#F0A05A',
  /** Scrim behind the login popup and the burger-menu drawer. */
  overlay: 'rgba(20, 40, 61, 0.45)',
} as const;

/**
 * Soft fills for status badges and chips. These are the palette's semantic
 * hues lightened onto Surface, so a badge never competes with body text.
 */
export const tints = {
  primary: colors.primaryTint,
  secondary: '#FBEEE3',
  success: '#E8F7EE',
  error: '#FDECEC',
  warning: '#FDF3E5',
  info: '#E8F0FE',
  neutral: '#EFF3F8',
} as const;

export type ColorToken = keyof typeof colors;
export type TintToken = keyof typeof tints;

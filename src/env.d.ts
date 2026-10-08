/** Content hash of the data folder this bundle was built against (see vite.config.ts). */
declare const __DATA_VERSION__: string;

interface ImportMetaEnv {
  /** The Supabase project for global stats and groups; both unset turns those features off. */
  readonly VITE_SUPABASE_URL?: string;
  /** Its publishable (or legacy anon) key. Public by design: it ships in the bundle. */
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

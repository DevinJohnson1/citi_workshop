/// <reference types="vite/client" />

/** Vite env variables used by the SPA. See `bin/generate-env.sh`. */
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_COGNITO_AUTHORITY: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_COGNITO_REDIRECT_URI: string;
  readonly VITE_COGNITO_DOMAIN: string;
  /**
   * When "true" the login page shows the four workshop persona quick-sign-in
   * buttons and pre-fills the form with the shared password. Defaults to
   * "false" so a misconfigured AWS deployment never accidentally exposes the
   * shortcut. `bin/generate-env.sh` writes "true" only for the LocalStack
   * target.
   */
  readonly VITE_SEED_LOGIN_ENABLED: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}


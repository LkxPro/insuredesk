interface ImportMetaEnv {
  /** Release tag baked at build time (Docker build-arg); absent in dev/test builds. */
  readonly VITE_APP_VERSION?: string;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_VEYRA_TREASURY_TESTNET_ADDRESS?: string;
  readonly VITE_VEYRA_TREASURY_MAINNET_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

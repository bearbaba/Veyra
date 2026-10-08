declare module '@circlefin/compass-chains' {
  export interface CompassChainDefinition {
    name: string;
    explorerUrl?: string;
    nativeCurrency: { symbol: string };
  }

  export function getChain(chainId: string): CompassChainDefinition;
}

/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { base, mainnet } from 'wagmi/chains'
import { arc } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arc.id, arc.rpcUrls.default.http[0])
registerChain(base.id, 'https://mainnet.base.org')

export const config = createConfig({
  // arc: Arc Mainnet (chainId 5042) — USDC as native gas + ERC-20
  // mainnet: ENS resolution
  // Wallets may connect only to the verified Mainnet networks in the public app.
  // Historical Testnet tools are not reachable from this connector.
  chains: [arc, base, mainnet],
  connectors: [injected()],
  transports: {
    [arc.id]: http('https://rpc.mainnet.arc.io', { timeout: 12000, retryCount: 1 }),
    [base.id]: http('https://mainnet.base.org', { timeout: 12000, retryCount: 1 }),
    [mainnet.id]: http(),
  },
})

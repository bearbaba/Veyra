/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
import { fallback } from 'viem'
import { mainnet, sepolia } from 'wagmi/chains'
import { arcTestnet } from 'viem/chains'
import { injected } from 'wagmi/connectors'
import { registerChain } from './tracing'

// Pre-register chain RPC URLs so trace events show correct chain names immediately
registerChain(arcTestnet.id, arcTestnet.rpcUrls.default.http[0])
registerChain(sepolia.id, sepolia.rpcUrls.default.http[0])

export const config = createConfig({
  // mainnet: ENS resolution
  // sepolia: CCTP V2 destination chain (receiveMessage)
  chains: [arcTestnet, sepolia, mainnet],
  connectors: [injected()],
  transports: {
    // Use independently verified Arc Testnet endpoints. A temporary outage/CORS
    // failure on the official RPC should not strand Review Transfer.
    // Contract reverts still fail closed; no simulation is ever skipped.
    [arcTestnet.id]: fallback([
      http('https://rpc.testnet.arc.io', { timeout: 12000, retryCount: 1 }),
      http('https://arc-testnet.drpc.org', { timeout: 12000, retryCount: 1 }),
    ], { rank: false }),
    [sepolia.id]: http(),
    [mainnet.id]: http(),
  },
})

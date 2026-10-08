/**
 * wagmi configuration
 * Built with Arc Studio — https://studio.arc.io
 */

import { http, createConfig } from 'wagmi'
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
    [arcTestnet.id]: http(),
    [sepolia.id]: http(),
    [mainnet.id]: http(),
  },
})

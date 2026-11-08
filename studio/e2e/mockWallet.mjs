// Throwaway browser wallet for Studio tests. It holds freshly generated keys that
// never see funds or a real network, signs identity typed data like a real wallet,
// and REFUSES every transaction method, recording the attempt so a test can assert
// that nothing tried to move money.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { generatePrivateKey, privateKeyToAccount } = require('viem/accounts');

const TX_METHODS = new Set([
  'eth_sendTransaction', 'eth_sendRawTransaction', 'eth_signTransaction', 'personal_sign', 'eth_sign',
  'wallet_sendCalls', 'wallet_sendTransaction',
]);

export function createWalletKit(count = 2) {
  const accounts = Array.from({ length: count }, () => privateKeyToAccount(generatePrivateKey()));
  const state = { active: 0, connected: false, chainId: 5042 };
  const prompts = [];       // identity signatures the wallet was asked for
  const forbidden = [];     // transaction-type requests (must stay empty)
  const log = [];

  const address = () => accounts[state.active].address;

  async function sign(addr, json) {
    const account = accounts.find((a) => a.address.toLowerCase() === String(addr).toLowerCase());
    if (!account) throw new Error('mock wallet: unknown signer');
    const data = JSON.parse(json);
    const { EIP712Domain: _domain, ...types } = data.types;
    prompts.push({ address: account.address, primaryType: data.primaryType, at: Date.now() });
    return account.signTypedData({
      domain: data.domain, types, primaryType: data.primaryType, message: data.message,
    });
  }

  async function install(context, page) {
    await context.exposeFunction('__mockState', () => ({
      address: address(), connected: state.connected, chainId: state.chainId,
    }));
    await context.exposeFunction('__mockConnect', () => { state.connected = true; log.push('connect'); });
    await context.exposeFunction('__mockDisconnect', () => { state.connected = false; log.push('disconnect'); });
    await context.exposeFunction('__mockSign', (addr, json) => sign(addr, json));
    await context.exposeFunction('__mockForbidden', (method) => { forbidden.push(method); });
    await context.addInitScript(() => {
      const listeners = new Map();
      const hex = (n) => `0x${Number(n).toString(16)}`;
      const provider = {
        isMetaMask: false,
        async request({ method, params }) {
          const s = await window.__mockState();
          switch (method) {
            case 'eth_chainId': return hex(s.chainId);
            case 'net_version': return String(s.chainId);
            case 'eth_accounts': return s.connected ? [s.address] : [];
            case 'eth_requestAccounts': await window.__mockConnect(); return [s.address];
            case 'wallet_requestPermissions': await window.__mockConnect(); return [{ parentCapability: 'eth_accounts' }];
            case 'wallet_getPermissions': return s.connected ? [{ parentCapability: 'eth_accounts' }] : [];
            case 'wallet_switchEthereumChain': return null;
            case 'eth_signTypedData_v4': return window.__mockSign(params[0], params[1]);
            default:
              if (['eth_sendTransaction', 'eth_sendRawTransaction', 'eth_signTransaction', 'personal_sign',
                'eth_sign', 'wallet_sendCalls', 'wallet_sendTransaction'].includes(method)) {
                await window.__mockForbidden(method);
                throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
              }
              throw Object.assign(new Error(`mock wallet: ${method} unsupported`), { code: 4200 });
          }
        },
        on(event, fn) { (listeners.get(event) ?? listeners.set(event, new Set()).get(event)).add(fn); return provider; },
        removeListener(event, fn) { listeners.get(event)?.delete(fn); return provider; },
        off(event, fn) { listeners.get(event)?.delete(fn); return provider; },
      };
      window.__mockEmit = (event, payload) => listeners.get(event)?.forEach((fn) => fn(payload));
      window.ethereum = provider;
    });
    this.page = page;
  }

  return {
    accounts, prompts, forbidden, log, state, install,
    get address() { return address(); },
    addressOf: (i) => accounts[i].address,
    async switchAccount(page, index) {
      state.active = index;
      await page.evaluate((a) => window.__mockEmit('accountsChanged', [a]), address());
    },
    async disconnectFromWallet(page) {
      state.connected = false;
      await page.evaluate(() => window.__mockEmit('accountsChanged', []));
    },
  };
}

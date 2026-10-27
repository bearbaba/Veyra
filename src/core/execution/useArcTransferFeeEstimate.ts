/**
 * Read-only Arc Testnet transfer fee estimate. The native gas unit on Arc is
 * USDC with 18 decimals; ERC-20 transfer amounts use 6 decimals. They are
 * two precision interfaces to the SAME balance, never two separate assets.
 *
 * RPC estimation is indicative, not a final fee or a wallet authorization.
 */
import { useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { formatUnits, getAddress } from 'viem';
import type { TransferAction } from '../actions/actionSchema';
import { MANIFEST_CONSTANTS } from '../../providers/registry/providerManifest';
import { REVIEWED_TRANSFER_ABI } from '../execution/transferSafetyGate';

type Estimate =
  | { status:'loading' }
  | { status:'error'; message:string }
  | { status:'ready'; feeUSDC:string; totalUSDC:string; checkedAt:number };

function withDeadline<T>(promise:Promise<T>,ms:number):Promise<T>{
  return Promise.race([promise,new Promise<never>((_,reject)=>{
    const timer=setTimeout(()=>reject(new Error('RPC_TIMEOUT')),ms);
    void promise.finally(()=>clearTimeout(timer)).catch(()=>undefined);
  })]);
}

export function useArcTransferFeeEstimate(action:TransferAction){
  const client=usePublicClient({chainId:MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID});
  const [retryEpoch,setRetryEpoch]=useState(0);
  const [state,setState]=useState<Estimate>({status:'loading'});
  // Refresh the quote rather than allowing an indefinitely old amount/fee.
  useEffect(()=>{
    const id=setInterval(()=>setRetryEpoch(x=>x+1),25_000);
    return()=>clearInterval(id);
  },[]);
  useEffect(()=>{
    let cancelled=false;
    setState({status:'loading'});
    void (async()=>{
      try {
        if(!client||action.chainId!==MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID ||
            action.tokenAddress.toLowerCase()!==MANIFEST_CONSTANTS.ARC_TESTNET_USDC.toLowerCase())
          throw new Error('Only Arc Testnet USDC transfers can be estimated.');
        const result=await withDeadline((async()=>{
          if(await client.getChainId()!==MANIFEST_CONSTANTS.ARC_TESTNET_CHAIN_ID)
            throw new Error('Connected read-only RPC is not Arc Testnet.');
          const sender=getAddress(action.from);
          const [gas,gasPrice,nativeBalance]=await Promise.all([
            client.estimateContractGas({
              account:sender,address:getAddress(action.tokenAddress),
              abi:REVIEWED_TRANSFER_ABI,functionName:'transfer',
              args:[getAddress(action.to),action.amount],
            }),
            client.getGasPrice(),
            client.getBalance({address:sender}),
          ]);
          const fee=gas*gasPrice;
          const total=action.amount*1_000_000_000_000n+fee;
          if(nativeBalance<total)
            throw new Error('Not enough Arc Testnet USDC to cover the amount and estimated fee.');
          return {feeUSDC:formatUnits(fee,18),totalUSDC:formatUnits(total,18)};
        })(),12_000);
        if(!cancelled)setState({status:'ready',...result,checkedAt:Date.now()});
      }catch(err){
        if(!cancelled){
          const message=err instanceof Error?err.message:'Fee estimate unavailable';
          setState({status:'error',message:message==='RPC_TIMEOUT'||/fetch|network|HTTP|request failed/i.test(message)
            ? 'Arc Testnet fee estimate is unavailable. No transaction was sent. Retry.'
            : message.split('\n')[0].slice(0,150)});
        }
      }
    })();
    return()=>{cancelled=true};
  },[action,client,retryEpoch]);
  return {...state,retry:()=>setRetryEpoch(x=>x+1)};
}

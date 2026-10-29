import { describe, it, expect } from 'vitest';
import {
  restoreWalletScopedActiveTask,
  selectActiveTaskAfterReply,
  type ActiveTaskMessageSnapshot,
} from '../core/agent/activeTaskSelection';

const intentMessage: ActiveTaskMessageSnapshot={
  id:'pay-draft-1',role:'agent',intent:{status:'RESOLVED',candidates:[{actionType:'TRANSFER'}]},
};

describe('wallet-scoped Agent task selection — behavioral contract',()=>{
  it('does not lose the selected Pay task when the user sends another question',()=>{
    const existing=selectActiveTaskAfterReply('pay-draft-1','reply-help',false);
    expect(existing).toBe('pay-draft-1');
    expect(selectActiveTaskAfterReply(existing,'reply-new-bridge',true)).toBe('pay-draft-1');
  });
  it('selects a new task only if no task is active',()=>{
    expect(selectActiveTaskAfterReply(null,'new-pay',true)).toBe('new-pay');
    expect(selectActiveTaskAfterReply(null,'just-chat',false)).toBeNull();
    expect(selectActiveTaskAfterReply(null,'',true)).toBeNull();
  });
  it('restores only a task that belongs to the wallet-scoped chat',()=>{
    expect(restoreWalletScopedActiveTask('pay-draft-1',[intentMessage])).toBe('pay-draft-1');
    expect(restoreWalletScopedActiveTask('a-different-wallet-task',[intentMessage])).toBeNull();
    expect(restoreWalletScopedActiveTask(null,[intentMessage])).toBeNull();
  });
  it('cannot restore user messages, unsupported intents or forged draft ID',()=>{
    const forged:ActiveTaskMessageSnapshot={...intentMessage,role:'user'};
    const unsupported:ActiveTaskMessageSnapshot={...intentMessage,intent:{status:'UNSUPPORTED',candidates:[{}]}};
    expect(restoreWalletScopedActiveTask('pay-draft-1',[forged])).toBeNull();
    expect(restoreWalletScopedActiveTask('pay-draft-1',[unsupported])).toBeNull();
    expect(restoreWalletScopedActiveTask('x'.repeat(101),[intentMessage])).toBeNull();
  });
});

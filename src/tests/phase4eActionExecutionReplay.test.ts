import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  forceActionExecutionReplayHydratedForTesting,
  forceActionExecutionReplayUnhydratedForTesting,
  getActionExecutionReplayEntry,
  hydrateActionExecutionReplayStore,
  lockActionExecution,
  markActionExecutionSubmissionStarted,
  releaseActionExecutionReservation,
  reserveActionExecution,
  resetActionExecutionReplayStore,
} from '../core/execution/actionExecutionReplayStore';

beforeEach(async () => {
  forceActionExecutionReplayUnhydratedForTesting();
  await resetActionExecutionReplayStore();
  forceActionExecutionReplayHydratedForTesting();
});

describe('Phase 4E action execution replay lock', () => {
  it('allows only one concurrent reservation for an action', async () => {
    const input = {
      actionId: 'action-concurrent',
      providerId: 'circle-appkit-swap',
      operation: 'SWAP',
    };

    const [a, b] = await Promise.all([
      reserveActionExecution(input),
      reserveActionExecution(input),
    ]);

    expect([a, b].filter((result) => result.success)).toHaveLength(1);
    const failed = [a, b].find((result) => !result.success);
    expect(failed).toBeDefined();
    if (failed && !failed.success) {
      expect(failed.reason).toBe('ALREADY_RESERVED');
    }
  });

  it('releases only a pre-submission reservation', async () => {
    await reserveActionExecution({
      actionId: 'action-release',
      providerId: 'circle-appkit-swap',
      operation: 'SWAP',
    });

    await releaseActionExecutionReservation('action-release');
    expect(await getActionExecutionReplayEntry('action-release')).toBeNull();

    const again = await reserveActionExecution({
      actionId: 'action-release',
      providerId: 'circle-appkit-swap',
      operation: 'SWAP',
    });
    expect(again.success).toBe(true);
  });

  it('never releases an action after provider submission has started', async () => {
    await reserveActionExecution({
      actionId: 'action-started',
      providerId: 'circle-appkit-bridge',
      operation: 'BRIDGE',
    });
    await markActionExecutionSubmissionStarted('action-started');
    await releaseActionExecutionReservation('action-started');

    const entry = await getActionExecutionReplayEntry('action-started');
    expect(entry?.state).toBe('SUBMISSION_STARTED');

    const replay = await reserveActionExecution({
      actionId: 'action-started',
      providerId: 'circle-appkit-bridge',
      operation: 'BRIDGE',
    });
    expect(replay.success).toBe(false);
    if (!replay.success) expect(replay.reason).toBe('SUBMISSION_STARTED');
  });

  it('locks the action after the provider returns so fresh execution cannot replay', async () => {
    await reserveActionExecution({
      actionId: 'action-locked',
      providerId: 'circle-appkit-earn',
      operation: 'EARN_DEPOSIT',
    });
    await markActionExecutionSubmissionStarted('action-locked');
    await lockActionExecution('action-locked');

    const entry = await getActionExecutionReplayEntry('action-locked');
    expect(entry?.state).toBe('LOCKED');

    const replay = await reserveActionExecution({
      actionId: 'action-locked',
      providerId: 'circle-appkit-earn',
      operation: 'EARN_DEPOSIT',
    });
    expect(replay.success).toBe(false);
    if (!replay.success) expect(replay.reason).toBe('LOCKED');
  });

  it('must hydrate before execution reservations are allowed', async () => {
    forceActionExecutionReplayUnhydratedForTesting();

    await expect(
      reserveActionExecution({
        actionId: 'action-unhydrated',
        providerId: 'circle-appkit-swap',
        operation: 'SWAP',
      }),
    ).rejects.toThrow(/not hydrated/i);

    await hydrateActionExecutionReplayStore();

    await expect(
      reserveActionExecution({
        actionId: 'action-hydrated',
        providerId: 'circle-appkit-swap',
        operation: 'SWAP',
      }),
    ).resolves.toEqual({ success: true });
  });
});

/**
 * Access the mobile Novel Master runtime when bootstrap is ready.
 */
import {useNovelMaster} from '../runtime/novel-master-context';
import type {MobileNovelMasterRuntime} from '../runtime/types';

/** Returns runtime or throws if not ready (call only under ready provider tree). */
export function useRuntime(): MobileNovelMasterRuntime {
  const {runtime, status} = useNovelMaster();
  if (status !== 'ready' || !runtime) {
    throw new Error('Runtime is not ready');
  }
  return runtime;
}

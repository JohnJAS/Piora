/** Explicit setup for tests of already-authorized control, separate from policy tests. */
export function authorizedManagerFactory(factory) {
  return options => {
    const manager = factory(options);
    const acquire = manager.acquireLease.bind(manager);
    manager.acquireLease = async options => {
      const lease = await acquire(options);
      if (lease.owner.kind === 'agent') {
        try { await manager.requestTaskControl(lease.serial, lease.token, 'com.test.app'); }
        catch (error) {
          if (error.code !== 'APPROVAL_REQUIRED') throw error;
          manager.resolveApproval(error.details.approvalId, true);
          await manager.requestTaskControl(lease.serial, lease.token, 'com.test.app');
        }
      }
      return lease;
    };
    return manager;
  };
}
export const fixtureQuality = { treeStatus: 'valid', scopeComplete: true, scope: 'window', appId: 'com.test.app', windowId: '1' };

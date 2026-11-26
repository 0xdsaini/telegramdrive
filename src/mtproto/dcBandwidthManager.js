/**
 * Telegram Web K / telegram-tt upload bandwidth limits (dcBandwithManager.ts).
 * Limits in-flight upload bytes per DC and spreads load across connection foremen.
 */

const MAX_CONCURRENT_CONNECTIONS = 3;
const MAX_CONCURRENT_CONNECTIONS_PREMIUM = 6;

const MAX_ACTIVE_REQUEST_SIZE = 9 * 1024 * 1024;
const MAX_ACTIVE_REQUEST_SIZE_PREMIUM = 20 * 1024 * 1024;

const FOREMAN_MAX_HEAP_SIZE = MAX_ACTIVE_REQUEST_SIZE_PREMIUM / MAX_CONCURRENT_CONNECTIONS_PREMIUM;

class Deferred {
  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
}

class Foreman {
  constructor(maxRequestHeapSize) {
    this.maxRequestHeapSize = maxRequestHeapSize;
    this.queuedRequests = [];
    this.priorityQueuedRequests = [];
    this.activeRequestHeapSize = 0;
    this.queuedRequestHeapSize = 0;
  }

  requestWorker(requestSize, isPriority) {
    if (this.activeRequestHeapSize + requestSize > this.maxRequestHeapSize) {
      const deferred = new Deferred();
      const queuedRequest = { deferred, requestSize };
      if (isPriority) {
        this.priorityQueuedRequests.push(queuedRequest);
      } else {
        this.queuedRequests.push(queuedRequest);
      }
      this.queuedRequestHeapSize += requestSize;
      return deferred.promise;
    }

    this.activeRequestHeapSize += requestSize;
    return Promise.resolve();
  }

  releaseWorker(requestSize) {
    this.activeRequestHeapSize -= requestSize;

    while (this.queueLength > 0) {
      const queuedRequest = this.priorityQueuedRequests[0] || this.queuedRequests[0];
      if (!queuedRequest) break;

      if (this.activeRequestHeapSize + queuedRequest.requestSize <= this.maxRequestHeapSize) {
        const request = (this.priorityQueuedRequests.shift() || this.queuedRequests.shift());
        this.queuedRequestHeapSize -= request.requestSize;
        this.activeRequestHeapSize += request.requestSize;
        request.deferred.resolve();
      } else {
        break;
      }
    }
  }

  canAccept(requestSize) {
    return this.activeRequestHeapSize + requestSize <= this.maxRequestHeapSize;
  }

  get queueLength() {
    return this.queuedRequests.length + this.priorityQueuedRequests.length;
  }
}

class DcBandwidthManager {
  constructor() {
    const maxForemans = Math.max(MAX_CONCURRENT_CONNECTIONS, MAX_CONCURRENT_CONNECTIONS_PREMIUM);
    this.foremans = Array(maxForemans)
      .fill(undefined)
      .map(() => new Foreman(FOREMAN_MAX_HEAP_SIZE));
    this.maxConnections = MAX_CONCURRENT_CONNECTIONS;
    this.maxActiveSize = MAX_ACTIVE_REQUEST_SIZE;
    this.queuedRequests = [];
    this.priorityQueuedRequests = [];
    this.activeRequestSize = 0;
  }

  updateIsPremium(isPremium) {
    this.maxConnections = isPremium ? MAX_CONCURRENT_CONNECTIONS_PREMIUM : MAX_CONCURRENT_CONNECTIONS;
    this.maxActiveSize = isPremium ? MAX_ACTIVE_REQUEST_SIZE_PREMIUM : MAX_ACTIVE_REQUEST_SIZE;
  }

  async requestWorker(isPriority, requestSize) {
    if (this.activeRequestSize + requestSize > this.maxActiveSize) {
      const deferred = new Deferred();
      const queuedRequest = { deferred, requestSize };
      if (isPriority) {
        this.priorityQueuedRequests.push(queuedRequest);
      } else {
        this.queuedRequests.push(queuedRequest);
      }
      await deferred.promise;
      const foremanIndex = this.getFreeForemanIndex(requestSize);
      const foreman = this.foremans[foremanIndex];
      await foreman.requestWorker(requestSize, isPriority);
      return foremanIndex;
    }

    const foremanIndex = this.getFreeForemanIndex(requestSize);
    const foreman = this.foremans[foremanIndex];
    await foreman.requestWorker(requestSize, isPriority);
    this.activeRequestSize += requestSize;
    return foremanIndex;
  }

  releaseWorker(foremanIndex, requestSize) {
    this.activeRequestSize -= requestSize;
    this.foremans[foremanIndex].releaseWorker(requestSize);
    this.processQueue();
  }

  processQueue() {
    while (true) {
      const queuedRequest = this.priorityQueuedRequests[0] || this.queuedRequests[0];
      if (!queuedRequest) return;
      if (this.activeRequestSize + queuedRequest.requestSize > this.maxActiveSize) return;

      const request = (this.priorityQueuedRequests.shift() || this.queuedRequests.shift());
      this.activeRequestSize += request.requestSize;
      request.deferred.resolve();
    }
  }

  getFreeForemanIndex(requestSize) {
    let minTotalHeapSize = Infinity;
    let minHeapForemanIndex = 0;

    for (let i = 0; i < this.maxConnections; i++) {
      const foreman = this.foremans[i];
      if (foreman.canAccept(requestSize)) {
        return i;
      }

      const totalHeapSize = foreman.activeRequestHeapSize + foreman.queuedRequestHeapSize;
      if (totalHeapSize < minTotalHeapSize) {
        minTotalHeapSize = totalHeapSize;
        minHeapForemanIndex = i;
      }
    }

    return minHeapForemanIndex;
  }
}

const dcManagers = new Map();

/**
 * @param {number} dcId
 * @param {boolean} [isPremium]
 */
export function getDcBandwidthManager(dcId, isPremium = false) {
  if (!dcManagers.has(dcId)) {
    dcManagers.set(dcId, new DcBandwidthManager());
  }
  const manager = dcManagers.get(dcId);
  manager.updateIsPremium(isPremium);
  return manager;
}

/** For tests: reset global DC upload schedulers. */
export function resetDcBandwidthManagers() {
  dcManagers.clear();
}
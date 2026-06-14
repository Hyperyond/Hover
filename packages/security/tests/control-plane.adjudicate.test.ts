import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { FlowStore, type FlowRequest, type FlowResponse } from '../src/mitm/flows.js';
import { startControlPlane, type ControlPlaneHandle } from '../src/control-plane.js';

/** Add a flow that already carries a response body — the shape the oracle reads. */
function seedFlow(store: FlowStore, url: string, status: number, body: string | null): string {
  const req: FlowRequest = {
    method: 'GET',
    url,
    httpVersion: '2',
    headers: {},
    bodyText: null,
    bodyLen: 0,
    startedAt: 0,
  };
  const flow = store.add(req);
  const res: FlowResponse = {
    statusCode: status,
    statusMessage: status === 200 ? 'OK' : 'Forbidden',
    headers: {},
    bodyText: body,
    bodyLen: body ? body.length : 0,
    completedAt: 0,
  };
  store.attachResponse(flow.id, res, false);
  return flow.id;
}

const A_BODY = JSON.stringify({ id: 'order-1001', owner: 'userA@test', total: 1300 });
const B_BODY = JSON.stringify({ id: 'order-2002', owner: 'userB@test', total: 4200 });

describe('POST /adjudicate', () => {
  let store: FlowStore;
  let cp: ControlPlaneHandle;
  let base: string;
  let headers: Record<string, string>;

  beforeEach(async () => {
    store = new FlowStore();
    cp = await startControlPlane(store);
    base = `http://127.0.0.1:${cp.port}`;
    headers = { authorization: `Bearer ${cp.token}`, 'content-type': 'application/json' };
  });

  afterEach(async () => {
    await cp.stop();
  });

  test('401 without the bearer token', async () => {
    const res = await fetch(`${base}/adjudicate`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(401);
  });

  test('400 when flow ids are missing', async () => {
    const res = await fetch(`${base}/adjudicate`, { method: 'POST', headers, body: JSON.stringify({}) });
    expect(res.status).toBe(400);
  });

  test('404 when a referenced flow does not exist', async () => {
    const ok = seedFlow(store, 'http://app/api/orders/1001', 200, A_BODY);
    const res = await fetch(`${base}/adjudicate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ baselineFlowId: ok, attackFlowId: 'deadbeef', referenceFlowId: ok }),
    });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('attack deadbeef');
  });

  test('confirmed: A reads B private data distinct from A', async () => {
    const baselineFlowId = seedFlow(store, 'http://app/api/orders/1001', 200, A_BODY);
    const attackFlowId = seedFlow(store, 'http://app/api/orders/2002', 200, B_BODY);
    const referenceFlowId = seedFlow(store, 'http://app/api/orders/2002', 200, B_BODY);
    const res = await fetch(`${base}/adjudicate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ baselineFlowId, attackFlowId, referenceFlowId, bMarkers: ['order-2002', 'userB@test'] }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verdict).toBe('confirmed');
    expect(json.signals.hasBMarker).toBe(true);
  });

  test('secure: a hard-denied attack', async () => {
    const baselineFlowId = seedFlow(store, 'http://app/api/orders/1001', 200, A_BODY);
    const attackFlowId = seedFlow(store, 'http://app/api/orders/2002', 403, null);
    const referenceFlowId = seedFlow(store, 'http://app/api/orders/2002', 200, B_BODY);
    const res = await fetch(`${base}/adjudicate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ baselineFlowId, attackFlowId, referenceFlowId, bMarkers: ['order-2002'] }),
    });
    expect((await res.json()).verdict).toBe('secure');
  });

  test('attached:false when attachToCheckId names no recorded check', async () => {
    const id = seedFlow(store, 'http://app/api/orders/1001', 200, A_BODY);
    const idB = seedFlow(store, 'http://app/api/orders/2002', 200, B_BODY);
    const res = await fetch(`${base}/adjudicate`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ baselineFlowId: id, attackFlowId: idB, referenceFlowId: idB, attachToCheckId: 999 }),
    });
    expect((await res.json()).attached).toBe(false);
  });
});

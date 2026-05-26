/**
 * In-memory flow store.
 *
 * Every request that mockttp sees becomes a Flow, keyed by a short id. The
 * store keeps an LRU-trimmed list (FLOW_LIMIT = 500 newest) and emits events
 * the WebSocket layer and the MCP server subscribe to.
 *
 * Flows are intentionally protocol-agnostic and pre-serialized — they're the
 * same shape on the wire to the widget and in the MCP responses to the agent.
 * No mockttp types leak past this module.
 */
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';

export interface FlowRequest {
  method: string;
  url: string;
  httpVersion: string;
  headers: Record<string, string | string[] | undefined>;
  /** Body as UTF-8 text if it decoded; null if binary or empty. */
  bodyText: string | null;
  bodyLen: number;
  startedAt: number;
}

export interface FlowResponse {
  statusCode: number;
  statusMessage?: string;
  headers: Record<string, string | string[] | undefined>;
  bodyText: string | null;
  bodyLen: number;
  completedAt: number;
}

export interface Flow {
  id: string;
  request: FlowRequest;
  response?: FlowResponse;
  /** Set to true if mockttp modified the request or response on the wire. */
  mutated: boolean;
}

export type FlowEvent =
  | { type: 'flow:added'; flow: Flow }
  | { type: 'flow:updated'; flow: Flow };

const FLOW_LIMIT = 500;

export class FlowStore extends EventEmitter {
  private flows: Flow[] = [];
  private byId = new Map<string, Flow>();

  newId(): string {
    return randomBytes(6).toString('hex');
  }

  add(req: FlowRequest): Flow {
    const flow: Flow = { id: this.newId(), request: req, mutated: false };
    this.flows.push(flow);
    this.byId.set(flow.id, flow);
    if (this.flows.length > FLOW_LIMIT) {
      const dropped = this.flows.shift()!;
      this.byId.delete(dropped.id);
    }
    this.emit('event', { type: 'flow:added', flow } satisfies FlowEvent);
    return flow;
  }

  attachResponse(id: string, res: FlowResponse, mutated: boolean): Flow | null {
    const flow = this.byId.get(id);
    if (!flow) return null;
    flow.response = res;
    if (mutated) flow.mutated = true;
    this.emit('event', { type: 'flow:updated', flow } satisfies FlowEvent);
    return flow;
  }

  list(): Flow[] {
    return this.flows.slice();
  }

  get(id: string): Flow | undefined {
    return this.byId.get(id);
  }

  clear(): void {
    this.flows = [];
    this.byId.clear();
  }
}

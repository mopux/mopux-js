import type { Connector } from '../http/connector.js';

export abstract class Resource {
  constructor(protected readonly connector: Connector) {}
}

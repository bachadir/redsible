# Redis Inventory Cleanup Strategies

Redsible provides mechanisms to manage edge node lifecycles within the Redis backend, avoiding stale data and preserving accurate inventories. 

## 1. Time-To-Live (TTL) Eviction

By default, the Go API manages node records using a TTL (Time-To-Live) strategy.

- **How it works**: When a node registers (e.g. `POST /register`), its record in Redis is assigned an expiration time. If the node fails to register again before this TTL expires, Redis will automatically evict the key.
- **Benefits**: Self-healing. Dead or decommissioned nodes simply drop out of the inventory after a short grace period without any manual intervention.
- **Configuration**: Set the TTL via the Go API `--ttl` flag. For example: `--ttl 2h`.

## 2. Graceful Deregistration

In cases where you want immediate removal of a node from the dynamic inventory (e.g., during scale-down operations), Redsible provides an explicit deregistration endpoint.

- **How it works**: Nodes can send a `DELETE /deregister/<hostname>` request to the Go API.
- **Example Usage**:
  ```bash
  curl -X DELETE http://inventory-api:8080/deregister/web01.internal
  ```
- **Benefits**: Instantly removes the node from the Ansible inventory output, preventing jobs from attempting connections to a node that has just been intentionally terminated.
- **Integration**: Best used within termination hooks, teardown scripts, or scale-in lifecycle hooks in auto-scaling groups.

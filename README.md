# Redsible

A self-generating, highly scalable Ansible dynamic inventory system backed by a Redis database and a Go microservice API.

## Architecture Overview

Redsible flips the traditional Ansible inventory model from "pull" (Control Node scans cloud provider APIs) to "push" (Edge nodes register themselves).

1. **Edge Nodes Phone Home**: Edge nodes run a small `ansible-pull` playbook (or simple `curl` script) on boot or via cron. They send their hostname, groups, and system variables to the Go API.
2. **Go API & Redis**: The Go API stores node data in Redis. It uses a **Two-Tier Eviction** mechanism so nodes missing heartbeats trigger an `unresponsive` warning before automatic removal.
3. **Control Node Fetch**: When you run `ansible-playbook`, the custom Python dynamic inventory plugin queries the Go API, which instantly builds the JSON inventory from Redis and returns it to Ansible.
4. **UI Dashboard**: A responsive React dashboard visualizes infrastructure state in real-time with host inspection, empty state onboarding, and interactive unresponsive server tracking.

---

## Features

- ⚡ **Push-Based Dynamic Inventory**: Zero cloud provider API rate limits; edge nodes register themselves on boot or schedule.
- ⚙️ **YAML API Configuration & CLI Flags**: Configure listening port, host binding, Redis connection, TTL, and eviction policies via `config.yaml` or command-line flags.
- ⚠️ **Two-Tier Eviction Policy**:
  - **Stage 1 (0 to 1x TTL)**: Active & online nodes.
  - **Stage 2 (1x TTL to 2x TTL)**: Unresponsive warning stage. Hosts missing heartbeats are flagged as `unresponsive` and automatically assigned to the `unresponsive` Ansible group (enabling `--limit unresponsive` targeting).
  - **Stage 3 (> 2x TTL)**: Hard eviction. Node records are permanently purged from Redis and omitted from inventory output.
- 🖥️ **Interactive React Dashboard**:
  - **Empty Inventory Onboarding**: Renders an empty state view with copyable `curl` commands and sample demo data loader when Redis contains 0 nodes.
  - **Clickable Host Inspection**: Inspect hardware metrics (vCPU, RAM, OS), connection parameters, and raw/structured `_meta.hostvars`.
  - **Unresponsive Nodes Filter**: Top summary bar features a clickable **Unresponsive Nodes** counter card that filters the table to show unresponsive servers.
  - **Host Deregistration**: Instant host deregistration (`DELETE /api/deregister/<hostname>`) directly from the UI or HTTP API.
- 🔒 **CORS & Reliability**: Native CORS support and robust error handling to prevent microservice crashes during Redis maintenance.

---

## Quick Start (Docker)

Spin up the entire stack (Redis, Go Ingest API, and React UI) in seconds:

```bash
docker compose up -d --build
```

The components will be available at:
- **UI Dashboard**: [http://localhost](http://localhost)
- **Go Ingest API**: [http://localhost:8080](http://localhost:8080)
- **Redis Database**: `localhost:6379`

---

## API Configuration (`api/config.yaml`)

The Go API reads configuration options from `api/config.yaml`:

```yaml
# Redsible API Configuration File

# Server Settings
server:
  port: 8080
  host: "0.0.0.0"

# Redis Database Connection Settings
redis:
  address: "localhost:6379"
  password: ""
  db: 0

# Time-To-Live for edge node inventory records (e.g., '30m', '2h', '24h')
ttl: "2h"

# Eviction Policy Settings (true = 2-tier warning, false = 1x TTL hard eviction)
two_tier_eviction: true
```

### Command-Line Flags

CLI flags override values set in `config.yaml`:

```bash
./redsible --config config.yaml --port 8080 --redis redis:6379 --ttl 2h --two-tier=true --serve
```

Available flags:
- `-config string`: Path to YAML configuration file.
- `-port int`: HTTP API server port.
- `-redis string`: Redis server address (`host:port`).
- `-redis-pass string`: Redis authentication password.
- `-ttl string`: Time-To-Live duration (e.g., `30m`, `2h`).
- `-two-tier bool`: Enable 2-tier eviction mode (default `true`).
- `-serve`: Start the HTTP Ingest API server.
- `-list`: Output Ansible dynamic inventory JSON to stdout.

---

## Eviction Policy Modes

| Mode | Behavior | Redis TTL | UI & Group Impact |
| :--- | :--- | :--- | :--- |
| **2-Tier (Enabled)** | Node receives `unresponsive` warning between `1x TTL` and `2x TTL`. Hard evicted at `> 2x TTL`. | `2 * TTL` | Node displays amber warning badge; added to `unresponsive` group. |
| **Standard (Disabled)** | Node is hard evicted immediately after `1x TTL`. | `1 * TTL` | Node remains active until `1x TTL`, then purged. |

---

## Ansible Configuration & Execution

1. Copy the inventory plugin from `ansible/plugins/inventory/redis_api.py` to your Ansible inventory plugins path.
2. Enable the plugin in your `ansible.cfg`:
   ```ini
   [inventory]
   enable_plugins = redis_api, host_list, script, auto, yaml, ini, toml
   ```
3. Use `ansible/config/inventory.redis_api.yml` as your inventory source:
   ```yaml
   plugin: redis_api
   api_url: http://localhost:8080/inventory
   ```

### Running Playbooks

Target all nodes:
```shell
ansible-playbook -i ansible/config/inventory.redis_api.yml site.yml
```

Target specific dynamic groups (e.g., `webservers` or `ubuntu_servers`):
```shell
ansible-playbook -i ansible/config/inventory.redis_api.yml site.yml --limit webservers
```

Target only **unresponsive** nodes (e.g. to run health checks or alerting playbooks):
```shell
ansible-playbook -i ansible/config/inventory.redis_api.yml remediate.yml --limit unresponsive
```

Inspect group hierarchy:
```shell
ansible-inventory -i ansible/config/inventory.redis_api.yml --graph
```

---

## Edge Node Registration

### 1. Ansible Playbook (Edge Node)

Run the provided registration playbook locally on an edge node:
```bash
ansible-playbook -i localhost, -c local ansible/playbooks/register_node.yml
```

Or schedule via cron to maintain heartbeat:
```cron
*/15 * * * * root ansible-playbook -i localhost, -c local /path/to/register_node.yml >/dev/null 2>&1
```

### 2. Curl / Shell Approach

Edge nodes can register via a single `curl` POST request:
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{
    "hostname": "web01.internal",
    "groups": ["webservers", "prod"],
    "vars": {
      "ansible_host": "10.0.1.20",
      "os": "Ubuntu",
      "os_version": "22.04 LTS",
      "arch": "x86_64",
      "cpus": "4",
      "ram_mb": "8192"
    }
  }' \
  http://localhost:8080/register
```

To gracefully deregister a host during decommission:
```bash
curl -X DELETE http://localhost:8080/deregister/web01.internal
```

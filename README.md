# Redsible

A self-generating, highly scalable Ansible dynamic inventory system backed by a Redis database and a Go microservice API. 

## Architecture Overview

Redsible flips the traditional Ansible inventory model from "pull" (Control Node scans cloud provider APIs) to "push" (Edge nodes register themselves).

1. **Edge Nodes Phone Home**: Edge nodes run a small `ansible-pull` playbook (or simple `curl` script) on boot or via cron. They send their hostname, groups, and variables to the Go API.
2. **Go API & Redis**: The Go API stores the node data in Redis. It uses a Time-To-Live (TTL) mechanism so nodes that die and stop phoning home are automatically removed.
3. **Control Node Fetch**: When you run `ansible-playbook`, the custom Python dynamic inventory plugin queries the Go API, which instantly builds the JSON inventory from Redis and returns it to Ansible.
4. **UI Dashboard**: A responsive React dashboard visualizes the current state of the infrastructure in real-time.

## Quick Start (Docker)

You can spin up the entire backend and UI in seconds using Docker Compose.

1. Start the stack:
   ```bash
   docker compose up -d --build
   ```
2. The components are now available:
   - **UI Dashboard**: http://localhost
   - **Go API**: http://localhost:8080
   - **Redis**: localhost:6379

## Ansible Configuration

To use Redsible with your Ansible Control Node:

1. Copy the inventory plugin from `ansible/plugins/inventory/redis_api.py` into your project's inventory plugins directory, or a globally configured plugins path.
2. Ensure the plugin is enabled in your `ansible.cfg`:
   ```ini
   [inventory]
   enable_plugins = redis_api, host_list, script, auto, yaml, ini, toml
   ```
3. Use the configuration file `ansible/config/inventory.redis_api.yml` as your inventory source.

## Running Playbooks

Once your plugin is configured and edge nodes are registered, you can use the dynamic inventory to run your standard Ansible playbooks. Simply pass the YAML configuration file using the -i flag:

   ```shell
   ansible-playbook -i ansible/config/inventory.redis_api.yml your_playbook.yml
   ```

You can seamlessly target specific dynamic groups that your edge nodes assign themselves during registration. For example, to run a playbook only against the webservers group:

   ```shell
   ansible-playbook -i ansible/config/inventory.redis_api.yml your_playbook.yml --limit webservers
   ```

To verify your inventory is pulling correctly from the API before executing any changes, you can visualize the group structure with the ansible-inventory command:

   ```shell
   ansible-inventory -i ansible/config/inventory.redis_api.yml --graph
   ```

## Edge Node Usage

To register an edge node, you can run the provided Ansible playbook locally on the node:

```bash
ansible-playbook -i localhost, -c local ansible/playbooks/register_node.yml
```

Or run it regularly via cron to maintain the TTL:
```cron
*/15 * * * * root ansible-playbook -i localhost, -c local /path/to/register_node.yml >/dev/null 2>&1
```

For a simple shell-only approach, see the documentation inside the Go API source code for a curl equivalent.

from __future__ import (absolute_import, division, print_function)
__metaclass__ = type

DOCUMENTATION = '''
    name: redis_api
    plugin_type: inventory
    short_description: Fetch dynamic inventory from the Go/Redis Ingest API
    description:
        - Connects to the custom Go microservice API over HTTP.
        - Parses the JSON output and builds the Ansible in-memory inventory.
    options:
        plugin:
            description: Token that ensures this is a source file for the 'redis_api' plugin.
            required: True
            choices: ['redis_api']
        api_url:
            description: The full HTTP URL of the Go API inventory endpoint.
            required: True
            type: str
'''

import json
import ssl
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError

# pyrefly: ignore [missing-import]
from ansible.plugins.inventory import BaseInventoryPlugin
# pyrefly: ignore [missing-import]
from ansible.errors import AnsibleError

class InventoryModule(BaseInventoryPlugin):
    NAME = 'redis_api'

    def verify_file(self, path):
        """Ensure the configuration file matches our plugin."""
        valid = super(InventoryModule, self).verify_file(path)
        if valid:
            # We only accept files that end with our custom extension or standard yaml
            if not path.endswith(('redis_api.yml', 'redis_api.yaml')):
                valid = False
        return valid

    def parse(self, inventory, loader, path, cache=True):
        """Parse the API output and populate the Ansible inventory."""
        super(InventoryModule, self).parse(inventory, loader, path, cache)
        
        # Read the YAML configuration (api_url, etc.)
        self._read_config_data(path)
        api_url = self.get_option('api_url')

        # Fetch data from the API
        try:
            req = Request(api_url, headers={'Accept': 'application/json'})
            # Bypass SSL verification if you are using self-signed internal certs
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE

            with urlopen(req, context=ctx, timeout=10) as response:
                if response.status != 200:
                    raise AnsibleError("API returned HTTP %d" % response.status)
                data = json.loads(response.read().decode('utf-8'))
        except (URLError, HTTPError) as e:
            raise AnsibleError("Failed to fetch inventory from %s: %s" % (api_url, str(e)))
        except ValueError as e:
            raise AnsibleError("Failed to parse JSON from API: %s" % str(e))

        # 1. Extract Host Variables
        hostvars = data.get('_meta', {}).get('hostvars', {})

        # 2. Extract Groups and add Hosts to them
        for group, group_data in data.items():
            if group == '_meta':
                continue
            
            # Create the group in Ansible
            self.inventory.add_group(group)
            
            # Add hosts to the group
            for host in group_data.get('hosts', []):
                self.inventory.add_host(host, group=group)

        # 3. Ensure all hosts exist in inventory and assign host variables
        for host, variables in hostvars.items():
            self.inventory.add_host(host)
            for var_name, var_value in variables.items():
                self.inventory.set_variable(host, var_name, var_value)
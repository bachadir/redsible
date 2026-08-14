// This is a complete, self-contained Go microservice for an Ansible dynamic inventory.
//
// HOW TO USE:
// 1. Install dependencies: go mod init inventory && go get github.com/redis/go-redis/v9
// 2. Build the binary: go build -o redsible main.go
// 3. Start the API server: ./redsible --serve
// 4. Use with Ansible: ansible-playbook -i ./redsible playbook.yml
//
// EDGE NODE REGISTRATION (ansible-pull task):
// curl -X POST -H "Content-Type: application/json" -d '{
//   "hostname": "web01.internal",
//   "groups": ["webservers", "prod"],
//   "vars": {"ansible_host": "10.0.0.5", "os": "ubuntu"}
// }' http://<api-server-ip>:8080/register

package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
	"gopkg.in/yaml.v3"
)

// Global Redis Context
var ctx = context.Background()

// ---------------------------------------------------------------------
// Configuration Structures
// ---------------------------------------------------------------------

type AppConfig struct {
	Server ServerConfig `yaml:"server"`
	Redis  RedisConfig  `yaml:"redis"`
	TTL    string       `yaml:"ttl"`
}

type ServerConfig struct {
	Port int    `yaml:"port"`
	Host string `yaml:"host"`
}

type RedisConfig struct {
	Address  string `yaml:"address"`
	Password string `yaml:"password"`
	DB       int    `yaml:"db"`
}

// loadConfig loads configuration from a YAML file if specified or available
func loadConfig(configPath string) (*AppConfig, error) {
	cfg := &AppConfig{
		Server: ServerConfig{
			Port: 8080,
			Host: "0.0.0.0",
		},
		Redis: RedisConfig{
			Address:  "localhost:6379",
			Password: "",
			DB:       0,
		},
		TTL: "2h",
	}

	if configPath == "" {
		if _, err := os.Stat("config.yaml"); err == nil {
			configPath = "config.yaml"
		}
	}

	if configPath != "" {
		data, err := os.ReadFile(configPath)
		if err != nil {
			return nil, fmt.Errorf("failed to read config file %s: %w", configPath, err)
		}
		if err := yaml.Unmarshal(data, cfg); err != nil {
			return nil, fmt.Errorf("failed to parse YAML config %s: %w", configPath, err)
		}
		log.Printf("Loaded configuration from %s", configPath)
	}

	return cfg, nil
}

// Helper to set CORS headers and handle preflight requests
func enableCORS(w http.ResponseWriter, r *http.Request) bool {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusOK)
		return true
	}
	return false
}

// ---------------------------------------------------------------------
// Data Structures
// ---------------------------------------------------------------------

// NodePayload represents the JSON sent by an edge node during ansible-pull
type NodePayload struct {
	Hostname string                 `json:"hostname"`
	Groups   []string               `json:"groups"`
	Vars     map[string]interface{} `json:"vars"`
}

// AnsibleInventory represents the strict JSON structure Ansible expects
// from a dynamic inventory script.
type AnsibleInventory struct {
	Meta   Meta                `json:"_meta"`
	Groups map[string]GroupDef `json:"-"` // Handled by custom marshalling
}

type Meta struct {
	Hostvars map[string]map[string]interface{} `json:"hostvars"`
}

type GroupDef struct {
	Hosts []string `json:"hosts"`
}

// Custom MarshalJSON to merge the Meta block with the dynamic Group blocks
// because Ansible expects groups at the root level of the JSON.
func (a *AnsibleInventory) MarshalJSON() ([]byte, error) {
	output := make(map[string]interface{})
	output["_meta"] = a.Meta

	for groupName, groupDef := range a.Groups {
		output[groupName] = groupDef
	}
	return json.MarshalIndent(output, "", "  ")
}

// ---------------------------------------------------------------------
// Main Entrypoint
// ---------------------------------------------------------------------
func main() {
	// Define command-line flags
	configFlag := flag.String("config", "", "Path to YAML configuration file")
	serveFlag := flag.Bool("serve", false, "Start the HTTP Ingest API server")
	listFlag := flag.Bool("list", false, "Output Ansible dynamic inventory JSON")
	hostFlag := flag.String("host", "", "Output specific host vars (Ansible spec)")
	redisAddr := flag.String("redis", "", "Redis server address (overrides config)")
	redisPass := flag.String("redis-pass", "", "Redis password (overrides config)")
	portFlag := flag.Int("port", 0, "HTTP API server port (overrides config)")
	ttlFlag := flag.String("ttl", "", "Time-To-Live for inventory records (e.g. '30m', '2h')")

	flag.Parse()

	// Load configuration (from file or defaults)
	cfg, err := loadConfig(*configFlag)
	if err != nil {
		log.Fatalf("Configuration error: %v", err)
	}

	// Apply CLI overrides if explicitly passed
	if *redisAddr != "" {
		cfg.Redis.Address = *redisAddr
	}
	if *redisPass != "" {
		cfg.Redis.Password = *redisPass
	}
	if *portFlag != 0 {
		cfg.Server.Port = *portFlag
	}
	if *ttlFlag != "" {
		cfg.TTL = *ttlFlag
	}

	// Parse the TTL into a usable Go time.Duration
	ttlDuration, err := time.ParseDuration(cfg.TTL)
	if err != nil {
		log.Fatalf("Invalid TTL format: %v. Use formats like '30m' or '2h'.", err)
	}

	// Initialize Redis Client
	rdb := redis.NewClient(&redis.Options{
		Addr:     cfg.Redis.Address,
		Password: cfg.Redis.Password,
		DB:       cfg.Redis.DB,
	})

	// Route the execution based on flags
	if *serveFlag {
		startAPIServer(rdb, cfg, ttlDuration)
	} else if *listFlag {
		generateInventory(rdb)
	} else if *hostFlag != "" {
		generateHostVars(rdb, *hostFlag)
	} else {
		// Ansible expects --list when executing a dynamic inventory script
		fmt.Println("Usage: redsible [--config config.yaml] [--serve] | [--list] | [--host <hostname>]")
		os.Exit(1)
	}
}

// ---------------------------------------------------------------------
// 1. The HTTP Ingest API (Appends & Updates)
// ---------------------------------------------------------------------

// startAPIServer runs the HTTP server that edge nodes "phone home" to
func startAPIServer(rdb *redis.Client, cfg *AppConfig, ttlDuration time.Duration) {
	// Expose the inventory over HTTP for the Ansible Plugin
	http.HandleFunc("/inventory", func(w http.ResponseWriter, r *http.Request) {
		if enableCORS(w, r) {
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "Only GET is supported", http.StatusMethodNotAllowed)
			return
		}
		output, err := getInventoryJSON(rdb)
		if err != nil {
			log.Printf("Error generating inventory: %v", err)
			http.Error(w, "Failed to generate inventory", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(output)
	})

	http.HandleFunc("/register", func(w http.ResponseWriter, r *http.Request) {
		if enableCORS(w, r) {
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "Only POST is supported", http.StatusMethodNotAllowed)
			return
		}

		// Parse the incoming JSON payload from the edge node
		var payload NodePayload
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "Invalid JSON payload", http.StatusBadRequest)
			return
		}

		if payload.Hostname == "" {
			http.Error(w, "Hostname is required", http.StatusBadRequest)
			return
		}

		redisKey := fmt.Sprintf("host:%s", payload.Hostname)

		// 1. Fetch existing data to append/merge changes
		existingData, err := rdb.Get(ctx, redisKey).Result()
		if err == nil && existingData != "" {
			var existingNode NodePayload
			if json.Unmarshal([]byte(existingData), &existingNode) == nil {

				// Merge Groups (Union of old and new groups)
				groupMap := make(map[string]bool)
				for _, g := range existingNode.Groups {
					groupMap[g] = true
				}
				for _, g := range payload.Groups {
					groupMap[g] = true
				}

				payload.Groups = make([]string, 0, len(groupMap))
				for g := range groupMap {
					payload.Groups = append(payload.Groups, g)
				}

				// Merge Vars (New vars overwrite old ones; missing vars are preserved)
				if existingNode.Vars != nil {
					if payload.Vars == nil {
						payload.Vars = make(map[string]interface{})
					}
					for k, v := range payload.Vars {
						existingNode.Vars[k] = v
					}
					payload.Vars = existingNode.Vars
				}
			}
		}

		// Ensure groups are deterministically sorted
		sort.Strings(payload.Groups)

		// Convert the merged payload back to a JSON string
		mergedData, err := json.Marshal(payload)
		if err != nil {
			http.Error(w, "Failed to encode data", http.StatusInternalServerError)
			return
		}

		// 2. Write Optimization: If data hasn't changed, ONLY refresh the TTL
		if string(mergedData) == existingData {
			rdb.Expire(ctx, redisKey, ttlDuration)
			log.Printf("Refreshed TTL for node: %s", payload.Hostname)
		} else {
			// Write the updated data to Redis and set the TTL
			err = rdb.Set(ctx, redisKey, mergedData, ttlDuration).Err()
			if err != nil {
				log.Printf("Redis error: %v", err)
				http.Error(w, "Failed to save to database", http.StatusInternalServerError)
				return
			}
			log.Printf("Updated node: %s", payload.Hostname)
		}

		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Node registered successfully\n"))
	})

	// Also implement the graceful deregistration endpoint (Strategy 2)
	http.HandleFunc("/deregister/", func(w http.ResponseWriter, r *http.Request) {
		if enableCORS(w, r) {
			return
		}
		if r.Method != http.MethodDelete && r.Method != http.MethodPost {
			http.Error(w, "Only DELETE and POST are supported", http.StatusMethodNotAllowed)
			return
		}

		// Extract hostname from URL path (e.g., /deregister/web01.internal)
		hostname := strings.TrimPrefix(r.URL.Path, "/deregister/")
		if hostname == "" {
			http.Error(w, "Hostname is required", http.StatusBadRequest)
			return
		}

		// Delete the key immediately
		redisKey := fmt.Sprintf("host:%s", hostname)
		rdb.Del(ctx, redisKey)

		w.WriteHeader(http.StatusOK)
		w.Write([]byte("Node deregistered\n"))
		log.Printf("Deregistered node: %s", hostname)
	})

	addr := fmt.Sprintf("%s:%d", cfg.Server.Host, cfg.Server.Port)
	log.Printf("Starting Inventory Ingest API on %s (TTL: %s)...", addr, cfg.TTL)
	log.Fatal(http.ListenAndServe(addr, nil))
}

// ---------------------------------------------------------------------
// 2. The Dynamic Inventory Fetcher (Queries)
// ---------------------------------------------------------------------

// getInventoryJSON queries Redis and returns the raw JSON bytes
func getInventoryJSON(rdb *redis.Client) ([]byte, error) {
	// Initialize the inventory structures
	inventory := AnsibleInventory{
		Meta: Meta{
			Hostvars: make(map[string]map[string]interface{}),
		},
		Groups: make(map[string]GroupDef),
	}

	// Step 1: SCAN for all keys starting with "host:"
	// SCAN is safe for production Redis as it doesn't block the database
	var cursor uint64
	var allKeys []string
	for {
		var keys []string
		var err error
		keys, cursor, err = rdb.Scan(ctx, cursor, "host:*", 1000).Result()
		if err != nil {
			return nil, fmt.Errorf("error scanning Redis: %w", err)
		}
		allKeys = append(allKeys, keys...)
		if cursor == 0 {
			break
		}
	}

	// Step 2: If we have keys, fetch all their JSON payloads at once using MGET
	if len(allKeys) > 0 {
		values, err := rdb.MGet(ctx, allKeys...).Result()
		if err != nil {
			return nil, fmt.Errorf("error executing MGET: %w", err)
		}

		// Step 3: Iterate through the returned JSON strings and build the inventory map
		for _, val := range values {
			if val == nil {
				continue
			}

			// Parse the node payload
			strVal := val.(string)
			var node NodePayload
			if err := json.Unmarshal([]byte(strVal), &node); err != nil {
				continue // Skip corrupted records safely
			}

			// Add the node's variables to the _meta.hostvars dictionary
			inventory.Meta.Hostvars[node.Hostname] = node.Vars

			// Assign the node to its declared groups
			for _, group := range node.Groups {
				g, exists := inventory.Groups[group]
				if !exists {
					g = GroupDef{Hosts: []string{}}
				}
				g.Hosts = append(g.Hosts, node.Hostname)
				inventory.Groups[group] = g
			}

			// Always add every host to the default "all" group
			allGroup := inventory.Groups["all"]
			allGroup.Hosts = append(allGroup.Hosts, node.Hostname)
			inventory.Groups["all"] = allGroup
		}
	}

	// Step 4: Serialize to JSON
	return json.Marshal(inventory)
}

// generateInventory queries Redis and prints the JSON Ansible expects to stdout
func generateInventory(rdb *redis.Client) {
	output, err := getInventoryJSON(rdb)
	if err != nil {
		log.Fatalf("Error generating JSON: %v", err)
	}
	fmt.Println(string(output))
}

// generateHostVars implements the --host <hostname> fallback argument
// that Ansible sometimes calls if _meta is missing (though our script provides _meta)
func generateHostVars(rdb *redis.Client, hostname string) {
	redisKey := fmt.Sprintf("host:%s", hostname)
	val, err := rdb.Get(ctx, redisKey).Result()
	if err != nil {
		fmt.Println("{}") // Return empty JSON if host not found
		return
	}

	var node NodePayload
	if err := json.Unmarshal([]byte(val), &node); err != nil {
		fmt.Println("{}")
		return
	}

	output, _ := json.Marshal(node.Vars)
	fmt.Println(string(output))
}

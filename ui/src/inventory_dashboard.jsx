import React, { useState, useEffect } from 'react';
import { Search, Server, RefreshCw, HardDrive, Cpu, Network, Layers } from 'lucide-react';

// Mock data to ensure the UI renders in the preview environment.
// In production, this is replaced by the actual fetch from your Go API.
const MOCK_API_RESPONSE = {
    "_meta": {
        "hostvars": {
            "web-prod-01.internal": { "ansible_host": "10.0.1.5", "os": "Ubuntu", "os_version": "22.04", "arch": "x86_64", "cpus": "4", "ram_mb": "8192" },
            "web-prod-02.internal": { "ansible_host": "10.0.1.6", "os": "Ubuntu", "os_version": "22.04", "arch": "x86_64", "cpus": "4", "ram_mb": "8192" },
            "db-prod-01.internal": { "ansible_host": "10.0.2.10", "os": "RHEL", "os_version": "9.2", "arch": "aarch64", "cpus": "8", "ram_mb": "32768" },
            "worker-dev-01.internal": { "ansible_host": "10.0.3.50", "os": "Debian", "os_version": "11", "arch": "x86_64", "cpus": "2", "ram_mb": "4096" }
        }
    },
    "all": { "hosts": ["web-prod-01.internal", "web-prod-02.internal", "db-prod-01.internal", "worker-dev-01.internal"] },
    "webservers": { "hosts": ["web-prod-01.internal", "web-prod-02.internal"] },
    "databases": { "hosts": ["db-prod-01.internal"] },
    "prod": { "hosts": ["web-prod-01.internal", "web-prod-02.internal", "db-prod-01.internal"] },
    "dev": { "hosts": ["worker-dev-01.internal"] }
};

export default function App() {
    const [hosts, setHosts] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [osFilter, setOsFilter] = useState('all');
    const [minCpu, setMinCpu] = useState('');
    const [minRam, setMinRam] = useState('');
    const [availableOs, setAvailableOs] = useState([]);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // URL of your Go API (Adjust this when running locally)
    const API_URL = '/api/inventory';

    const fetchInventory = async () => {
        setLoading(true);
        setError(null);
        try {
            // Attempt to fetch from the live Go API
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            parseInventoryData(data);
        } catch (e) {
            console.warn("Could not connect to live API, falling back to mock data for preview.", e);
            // Fallback to mock data if the API is offline (useful for this Canvas preview)
            parseInventoryData(MOCK_API_RESPONSE);
            setError("Using mock data (Live API unreachable)");
        } finally {
            setLoading(false);
        }
    };

    const parseInventoryData = (data) => {
        const parsedHosts = [];
        const availableGroups = new Set();
        const osSet = new Set();
        const hostvars = data._meta?.hostvars || {};
        const hostGroupsMap = {};

        // Map which hosts belong to which groups
        Object.keys(data).forEach(groupName => {
            if (groupName === '_meta' || groupName === 'all') return;
            availableGroups.add(groupName);

            data[groupName].hosts?.forEach(hostname => {
                if (!hostGroupsMap[hostname]) hostGroupsMap[hostname] = [];
                hostGroupsMap[hostname].push(groupName);
            });
        });

        // Build the final flat array of host objects for the table
        Object.keys(hostvars).forEach(hostname => {
            const vars = hostvars[hostname] || {};
            if (vars.os) osSet.add(vars.os);

            parsedHosts.push({
                hostname,
                groups: hostGroupsMap[hostname] || [],
                vars: vars
            });
        });

        setGroups(['all', ...Array.from(availableGroups).sort()]);
        setAvailableOs(['all', ...Array.from(osSet).sort()]);
        setHosts(parsedHosts);
    };

    useEffect(() => {
        fetchInventory();
        // Auto-refresh every 30 seconds
        const interval = setInterval(fetchInventory, 30000);
        return () => clearInterval(interval);
    }, []);

    // Filter logic
    const filteredHosts = hosts.filter(host => {
        const matchesSearch =
            host.hostname.toLowerCase().includes(searchTerm.toLowerCase()) ||
            host.vars.ansible_host?.includes(searchTerm);

        const matchesGroup = selectedGroup === 'all' || host.groups.includes(selectedGroup);
        const matchesOs = osFilter === 'all' || host.vars.os === osFilter;

        const hostCpu = parseInt(host.vars.cpus || '0', 10);
        const filterCpu = parseInt(minCpu || '0', 10);
        const matchesCpu = minCpu === '' || hostCpu >= filterCpu;

        const hostRam = parseInt(host.vars.ram_mb || '0', 10);
        // User inputs RAM in GB, but facts store it in MB
        const filterRamMB = parseInt(minRam || '0', 10) * 1024;
        const matchesRam = minRam === '' || hostRam >= filterRamMB;

        return matchesSearch && matchesGroup && matchesOs && matchesCpu && matchesRam;
    });

    return (
        <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-600 text-white rounded-lg shadow-sm">
                        <Server size={24} />
                    </div>
                    <div>
                        <h1 className="text-xl font-bold text-slate-800">Ansible SSOT Dashboard</h1>
                        <p className="text-xs text-slate-500 font-medium tracking-wide uppercase">Powered by Redis Ingest API</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    {error && <span className="text-amber-600 text-sm font-medium flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span> {error}</span>}
                    <button
                        onClick={fetchInventory}
                        className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-md hover:bg-slate-50 hover:text-indigo-600 transition-colors shadow-sm text-sm font-medium"
                    >
                        <RefreshCw size={16} className={loading ? "animate-spin text-indigo-600" : ""} />
                        Refresh
                    </button>
                </div>
            </header>

            <main className="max-w-7xl mx-auto p-6">

                {/* Controls Bar */}
                <div className="flex flex-col gap-4 mb-6">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="relative flex-grow max-w-md">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Search size={18} className="text-slate-400" />
                            </div>
                            <input
                                type="text"
                                placeholder="Search by hostname or IP..."
                                className="block w-full pl-10 pr-3 py-2 border border-slate-300 rounded-md leading-5 bg-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm shadow-sm transition-all"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        <div className="flex items-center gap-2">
                            <Layers size={18} className="text-slate-400" />
                            <select
                                className="block w-48 pl-3 pr-10 py-2 text-base border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md shadow-sm bg-white"
                                value={selectedGroup}
                                onChange={(e) => setSelectedGroup(e.target.value)}
                            >
                                {groups.map(g => (
                                    <option key={g} value={g}>{g === 'all' ? 'All Groups' : g}</option>
                                ))}
                            </select>
                        </div>

                        <button
                            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                            className={`px-4 py-2 text-sm font-medium border rounded-md shadow-sm transition-colors ${showAdvancedFilters ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
                        >
                            {showAdvancedFilters ? 'Hide Filters' : 'More Filters'}
                        </button>
                    </div>

                    {/* Advanced Filters */}
                    {showAdvancedFilters && (
                        <div className="p-4 bg-white border border-slate-200 rounded-lg shadow-sm flex flex-wrap gap-6 transition-all duration-300 ease-in-out">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Operating System</label>
                                <select
                                    className="block w-40 pl-3 pr-8 py-1.5 text-sm border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 rounded-md bg-white shadow-sm"
                                    value={osFilter}
                                    onChange={(e) => setOsFilter(e.target.value)}
                                >
                                    {availableOs.map(os => (
                                        <option key={os} value={os}>{os === 'all' ? 'Any OS' : os}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Min vCPU Cores</label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="e.g. 4"
                                    className="block w-40 px-3 py-1.5 text-sm border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 rounded-md bg-white shadow-sm"
                                    value={minCpu}
                                    onChange={(e) => setMinCpu(e.target.value)}
                                />
                            </div>

                            <div className="flex flex-col gap-1.5">
                                <label className="text-xs font-semibold text-slate-500 uppercase">Min RAM (GB)</label>
                                <input
                                    type="number"
                                    min="1"
                                    placeholder="e.g. 8"
                                    className="block w-40 px-3 py-1.5 text-sm border border-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 rounded-md bg-white shadow-sm"
                                    value={minRam}
                                    onChange={(e) => setMinRam(e.target.value)}
                                />
                            </div>

                            <div className="flex items-end pb-0.5 ml-auto sm:ml-0">
                                <button
                                    onClick={() => { setOsFilter('all'); setMinCpu(''); setMinRam(''); }}
                                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
                                >
                                    Clear Filters
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Data Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="min-w-full divide-y divide-slate-200">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Hostname</th>
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Network</th>
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Hardware</th>
                                    <th scope="col" className="px-6 py-4 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Groups</th>
                                </tr>
                            </thead>
                            <tbody className="bg-white divide-y divide-slate-100">
                                {filteredHosts.length === 0 ? (
                                    <tr>
                                        <td colSpan="4" className="px-6 py-12 text-center text-slate-500">
                                            No nodes found matching your filters.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredHosts.map((host) => (
                                        <tr key={host.hostname} className="hover:bg-slate-50/80 transition-colors group">
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center">
                                                    <div className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100 group-hover:bg-indigo-100 transition-colors">
                                                        <Server size={20} />
                                                    </div>
                                                    <div className="ml-4">
                                                        <div className="text-sm font-semibold text-slate-900">{host.hostname}</div>
                                                        <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                                                            Online (Cached)
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="flex items-center gap-1.5 text-sm text-slate-700">
                                                    <Network size={14} className="text-slate-400" />
                                                    <span className="font-mono text-xs bg-slate-100 px-2 py-1 rounded text-slate-600 border border-slate-200">
                                                        {host.vars.ansible_host || 'N/A'}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4 whitespace-nowrap">
                                                <div className="text-sm text-slate-900 flex items-center gap-4">
                                                    <div className="flex items-center gap-1.5" title="Operating System">
                                                        <HardDrive size={16} className="text-slate-400" />
                                                        <span>{host.vars.os || 'Unknown'} {host.vars.os_version || ''}</span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5" title="CPU & RAM">
                                                        <Cpu size={16} className="text-slate-400" />
                                                        <span className="text-xs text-slate-500 font-medium">
                                                            {host.vars.cpus ? `${host.vars.cpus} vCPU` : ''}
                                                            {host.vars.ram_mb ? ` • ${Math.round(host.vars.ram_mb / 1024)}GB RAM` : ''}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-6 py-4">
                                                <div className="flex flex-wrap gap-1.5">
                                                    {host.groups.length > 0 ? host.groups.map(group => (
                                                        <span key={group} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100">
                                                            {group}
                                                        </span>
                                                    )) : (
                                                        <span className="text-xs text-slate-400 italic">No explicit groups</span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    )))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>
        </div>
    );
}
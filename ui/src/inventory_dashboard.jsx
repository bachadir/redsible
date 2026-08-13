import React, { useState, useEffect } from 'react';
import {
    Search, Server, RefreshCw, HardDrive, Cpu, Network, Layers,
    ArrowLeft, Copy, Check, Trash2, Terminal, AlertTriangle, CheckCircle2,
    Database, Activity, Info, ExternalLink, X
} from 'lucide-react';

// Mock data to ensure UI preview capabilities and fallback when Redis is empty/offline.
const MOCK_API_RESPONSE = {
    "_meta": {
        "hostvars": {
            "web-prod-01.internal": { "ansible_host": "10.0.1.5", "os": "Ubuntu", "os_version": "22.04 LTS", "arch": "x86_64", "cpus": "4", "ram_mb": "8192", "environment": "production", "datacenter": "us-east-1", "kernel": "5.15.0-88-generic" },
            "web-prod-02.internal": { "ansible_host": "10.0.1.6", "os": "Ubuntu", "os_version": "22.04 LTS", "arch": "x86_64", "cpus": "4", "ram_mb": "8192", "environment": "production", "datacenter": "us-east-1", "kernel": "5.15.0-88-generic" },
            "db-prod-01.internal": { "ansible_host": "10.0.2.10", "os": "RHEL", "os_version": "9.2", "arch": "aarch64", "cpus": "8", "ram_mb": "32768", "environment": "production", "datacenter": "us-east-1", "engine": "postgresql-15" },
            "worker-dev-01.internal": { "ansible_host": "10.0.3.50", "os": "Debian", "os_version": "11", "arch": "x86_64", "cpus": "2", "ram_mb": "4096", "environment": "development", "datacenter": "eu-central-1", "role": "celery-worker" }
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
    const [isUsingMock, setIsUsingMock] = useState(false);
    const [selectedHost, setSelectedHost] = useState(null);
    const [copied, setCopied] = useState(false);
    const [actionNotice, setActionNotice] = useState(null);

    // Filters
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [osFilter, setOsFilter] = useState('all');
    const [minCpu, setMinCpu] = useState('');
    const [minRam, setMinRam] = useState('');
    const [availableOs, setAvailableOs] = useState([]);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [rawJsonView, setRawJsonView] = useState(false);

    // API URL
    const API_URL = '/api/inventory';

    const fetchInventory = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(API_URL);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const data = await response.json();
            setIsUsingMock(false);
            parseInventoryData(data);
        } catch (e) {
            console.warn("Could not connect to live API, checking state.", e);
            setError("Live API unreachable (using offline mode)");
            setLoading(false);
        } finally {
            setLoading(false);
        }
    };

    const loadDemoData = () => {
        setIsUsingMock(true);
        setError("Displaying Demo Data");
        parseInventoryData(MOCK_API_RESPONSE);
        showNotice("Loaded sample inventory items successfully");
    };

    const parseInventoryData = (data) => {
        const parsedHosts = [];
        const availableGroups = new Set();
        const osSet = new Set();
        const hostvars = data._meta?.hostvars || {};
        const hostGroupsMap = {};

        Object.keys(data).forEach(groupName => {
            if (groupName === '_meta' || groupName === 'all') return;
            availableGroups.add(groupName);

            data[groupName].hosts?.forEach(hostname => {
                if (!hostGroupsMap[hostname]) hostGroupsMap[hostname] = [];
                hostGroupsMap[hostname].push(groupName);
            });
        });

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

        // Update selected host if opened
        if (selectedHost) {
            const updatedSelected = parsedHosts.find(h => h.hostname === selectedHost.hostname);
            if (updatedSelected) setSelectedHost(updatedSelected);
        }
    };

    useEffect(() => {
        fetchInventory();
        const interval = setInterval(fetchInventory, 30000);
        return () => clearInterval(interval);
    }, []);

    const showNotice = (msg) => {
        setActionNotice(msg);
        setTimeout(() => setActionNotice(null), 4000);
    };

    const handleDeregister = async (hostname) => {
        if (!window.confirm(`Are you sure you want to deregister host "${hostname}" from Redis?`)) return;

        try {
            const res = await fetch(`/api/deregister/${hostname}`, { method: 'DELETE' });
            if (!res.ok) {
                // Try fallback POST or direct endpoint
                await fetch(`/api/deregister/${hostname}`, { method: 'POST' });
            }
            setHosts(prev => prev.filter(h => h.hostname !== hostname));
            setSelectedHost(null);
            showNotice(`Node ${hostname} deregistered successfully`);
        } catch (err) {
            console.error("Deregister error:", err);
            // Local state fallback for demo/unreachable server
            setHosts(prev => prev.filter(h => h.hostname !== hostname));
            setSelectedHost(null);
            showNotice(`Removed ${hostname} from active view`);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const filteredHosts = hosts.filter(host => {
        const matchesSearch =
            host.hostname.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (host.vars.ansible_host && host.vars.ansible_host.toLowerCase().includes(searchTerm.toLowerCase()));

        const matchesGroup = selectedGroup === 'all' || host.groups.includes(selectedGroup);
        const matchesOs = osFilter === 'all' || host.vars.os === osFilter;

        const hostCpu = parseInt(host.vars.cpus || '0', 10);
        const filterCpu = parseInt(minCpu || '0', 10);
        const matchesCpu = minCpu === '' || hostCpu >= filterCpu;

        const hostRam = parseInt(host.vars.ram_mb || '0', 10);
        const filterRamMB = parseInt(minRam || '0', 10) * 1024;
        const matchesRam = minRam === '' || hostRam >= filterRamMB;

        return matchesSearch && matchesGroup && matchesOs && matchesCpu && matchesRam;
    });

    const sampleCurlCommand = `curl -X POST -H "Content-Type: application/json" \\
  -d '{
    "hostname": "web01.internal",
    "groups": ["webservers", "prod"],
    "vars": {"ansible_host": "10.0.1.20", "os": "Ubuntu", "cpus": "4", "ram_mb": "8192"}
  }' \\
  http://localhost:8080/register`;

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 font-sans antialiased selection:bg-indigo-500 selection:text-white">
            {/* Action Notice Toast */}
            {actionNotice && (
                <div className="fixed bottom-5 right-5 z-50 bg-indigo-600 text-white px-4 py-3 rounded-lg shadow-xl border border-indigo-400/30 flex items-center gap-3 animate-bounce">
                    <CheckCircle2 size={18} />
                    <span className="text-sm font-medium">{actionNotice}</span>
                    <button onClick={() => setActionNotice(null)} className="ml-2 text-indigo-200 hover:text-white"><X size={14} /></button>
                </div>
            )}

            {/* Header */}
            <header className="bg-slate-950/80 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex flex-wrap items-center justify-between sticky top-0 z-20">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white rounded-xl shadow-lg shadow-indigo-500/20 ring-1 ring-indigo-400/30">
                        <Server size={22} />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-lg font-bold text-slate-100 tracking-tight">Redsible Dashboard</h1>
                            <span className="px-2 py-0.5 text-[10px] uppercase font-semibold tracking-wider rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                v2.0 Live
                            </span>
                        </div>
                        <p className="text-xs text-slate-400 font-medium tracking-wide">
                            Redis-Backed Ansible Dynamic Inventory SSOT
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-4 mt-2 sm:mt-0">
                    {error && (
                        <span className="text-amber-400 text-xs font-medium bg-amber-500/10 border border-amber-500/20 px-3 py-1.5 rounded-lg flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"></span>
                            {error}
                        </span>
                    )}

                    <button
                        onClick={fetchInventory}
                        disabled={loading}
                        className="flex items-center gap-2 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition-all shadow-sm active:scale-95 disabled:opacity-50"
                    >
                        <RefreshCw size={14} className={loading ? "animate-spin text-indigo-400" : ""} />
                        Refresh Data
                    </button>
                </div>
            </header>

            {/* Main Content Area */}
            <main className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">

                {/* ITEM DETAILS PAGE VIEW */}
                {selectedHost ? (
                    <div className="space-y-6 animate-fadeIn">
                        {/* Detail Navigation & Actions */}
                        <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 shadow-md">
                            <button
                                onClick={() => setSelectedHost(null)}
                                className="flex items-center gap-2 text-sm font-semibold text-indigo-400 hover:text-indigo-300 transition-colors group"
                            >
                                <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
                                Back to Host List
                            </button>

                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setRawJsonView(!rawJsonView)}
                                    className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-all ${rawJsonView ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
                                >
                                    {rawJsonView ? 'Structured View' : 'Raw JSON View'}
                                </button>
                                <button
                                    onClick={() => copyToClipboard(JSON.stringify(selectedHost.vars, null, 2))}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg text-xs font-semibold transition-all"
                                >
                                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                    {copied ? 'Copied' : 'Copy Hostvars'}
                                </button>
                                <button
                                    onClick={() => handleDeregister(selectedHost.hostname)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg text-xs font-semibold transition-all"
                                >
                                    <Trash2 size={14} />
                                    Deregister Host
                                </button>
                            </div>
                        </div>

                        {/* Host Header Card */}
                        <div className="bg-gradient-to-r from-slate-800 via-slate-850 to-slate-900 border border-slate-700/80 rounded-2xl p-6 shadow-xl relative overflow-hidden">
                            <div className="absolute -right-10 -bottom-10 opacity-5 pointer-events-none text-indigo-400">
                                <Server size={240} />
                            </div>

                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
                                <div className="flex items-start gap-4">
                                    <div className="p-4 bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 rounded-2xl shadow-inner">
                                        <Server size={36} />
                                    </div>
                                    <div>
                                        <div className="flex flex-wrap items-center gap-3">
                                            <h2 className="text-2xl font-bold text-white tracking-tight">{selectedHost.hostname}</h2>
                                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                                                Online (Redis Active)
                                            </span>
                                        </div>
                                        <p className="text-sm text-slate-400 mt-1 flex items-center gap-2">
                                            <Network size={14} className="text-slate-500" />
                                            IP: <span className="font-mono text-indigo-300 font-semibold">{selectedHost.vars.ansible_host || 'N/A'}</span>
                                        </p>
                                    </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-slate-400 mr-2 font-medium">Assigned Groups:</span>
                                    {selectedHost.groups.length > 0 ? (
                                        selectedHost.groups.map(g => (
                                            <span key={g} className="px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                                {g}
                                            </span>
                                        ))
                                    ) : (
                                        <span className="text-xs text-slate-500 italic">No explicit groups</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Detail Specs Grid */}
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-4 shadow-sm">
                                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2 mb-2">
                                    <HardDrive size={16} className="text-indigo-400" /> Operating System
                                </div>
                                <div className="text-lg font-bold text-white">
                                    {selectedHost.vars.os || 'Linux'}
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                    {selectedHost.vars.os_version || 'Generic'} ({selectedHost.vars.arch || 'x86_64'})
                                </div>
                            </div>

                            <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-4 shadow-sm">
                                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2 mb-2">
                                    <Cpu size={16} className="text-indigo-400" /> CPU Allocation
                                </div>
                                <div className="text-lg font-bold text-white">
                                    {selectedHost.vars.cpus ? `${selectedHost.vars.cpus} Cores` : 'Unspecified'}
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                    Virtual CPU Cores
                                </div>
                            </div>

                            <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-4 shadow-sm">
                                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2 mb-2">
                                    <Activity size={16} className="text-indigo-400" /> Memory Allocation
                                </div>
                                <div className="text-lg font-bold text-white">
                                    {selectedHost.vars.ram_mb ? `${Math.round(selectedHost.vars.ram_mb / 1024)} GB` : 'Unspecified'}
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                    {selectedHost.vars.ram_mb ? `${selectedHost.vars.ram_mb} MB RAM` : 'RAM capacity'}
                                </div>
                            </div>

                            <div className="bg-slate-800/80 border border-slate-700/60 rounded-xl p-4 shadow-sm">
                                <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2 mb-2">
                                    <Network size={16} className="text-indigo-400" /> Connection Host
                                </div>
                                <div className="text-lg font-mono font-bold text-indigo-300 truncate">
                                    {selectedHost.vars.ansible_host || '127.0.0.1'}
                                </div>
                                <div className="text-xs text-slate-400 mt-0.5">
                                    Target SSH IP / Hostname
                                </div>
                            </div>
                        </div>

                        {/* Variables Section */}
                        <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl overflow-hidden shadow-lg">
                            <div className="bg-slate-850 px-6 py-4 border-b border-slate-700/60 flex items-center justify-between">
                                <h3 className="text-base font-bold text-white flex items-center gap-2">
                                    <Terminal size={18} className="text-indigo-400" />
                                    Ansible Host Variables (`_meta.hostvars`)
                                </h3>
                                <span className="text-xs text-slate-400">
                                    {Object.keys(selectedHost.vars).length} key-value entries
                                </span>
                            </div>

                            <div className="p-6">
                                {rawJsonView ? (
                                    <pre className="bg-slate-950 p-4 rounded-xl text-indigo-300 font-mono text-xs overflow-x-auto border border-slate-800 leading-relaxed">
                                        {JSON.stringify(selectedHost.vars, null, 2)}
                                    </pre>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {Object.entries(selectedHost.vars).map(([key, val]) => (
                                            <div key={key} className="flex items-center justify-between bg-slate-900/60 border border-slate-700/40 p-3 rounded-xl">
                                                <span className="font-mono text-xs text-indigo-300 font-medium">{key}</span>
                                                <span className="font-mono text-xs text-slate-200 bg-slate-800 px-2.5 py-1 rounded border border-slate-700 max-w-xs truncate">
                                                    {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* LIST VIEW / DASHBOARD MAIN VIEW */
                    <div className="space-y-6">

                        {/* Stats Top Summary Bar */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <div className="bg-slate-800/70 border border-slate-700/60 p-4 rounded-xl flex items-center gap-4">
                                <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-lg">
                                    <Server size={20} />
                                </div>
                                <div>
                                    <div className="text-2xl font-black text-white">{hosts.length}</div>
                                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Nodes</div>
                                </div>
                            </div>

                            <div className="bg-slate-800/70 border border-slate-700/60 p-4 rounded-xl flex items-center gap-4">
                                <div className="p-3 bg-purple-500/10 text-purple-400 rounded-lg">
                                    <Layers size={20} />
                                </div>
                                <div>
                                    <div className="text-2xl font-black text-white">{Math.max(0, groups.length - 1)}</div>
                                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Ansible Groups</div>
                                </div>
                            </div>

                            <div className="bg-slate-800/70 border border-slate-700/60 p-4 rounded-xl flex items-center gap-4">
                                <div className="p-3 bg-emerald-500/10 text-emerald-400 rounded-lg">
                                    <Database size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-emerald-400">{hosts.length > 0 ? "Active" : "Empty DB"}</div>
                                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Redis Status</div>
                                </div>
                            </div>

                            <div className="bg-slate-800/70 border border-slate-700/60 p-4 rounded-xl flex items-center gap-4">
                                <div className="p-3 bg-blue-500/10 text-blue-400 rounded-lg">
                                    <Activity size={20} />
                                </div>
                                <div>
                                    <div className="text-sm font-bold text-blue-400">2h Auto-TTL</div>
                                    <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Eviction Policy</div>
                                </div>
                            </div>
                        </div>

                        {/* Search & Filter Controls */}
                        <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl p-4 shadow-sm space-y-4">
                            <div className="flex flex-col sm:flex-row gap-4">
                                <div className="relative flex-grow">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                                        <Search size={18} className="text-slate-400" />
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="Search inventory by hostname or IP address..."
                                        className="block w-full pl-10 pr-4 py-2.5 bg-slate-900/80 border border-slate-700 rounded-xl leading-5 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-sm shadow-inner transition-all"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2">
                                        <Layers size={18} className="text-slate-400 hidden sm:inline" />
                                        <select
                                            className="block w-44 pl-3 pr-8 py-2.5 text-sm bg-slate-900/80 border border-slate-700 text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded-xl shadow-inner"
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
                                        className={`px-4 py-2.5 text-xs font-semibold border rounded-xl shadow-sm transition-all ${showAdvancedFilters ? 'bg-indigo-600 text-white border-indigo-500' : 'bg-slate-900/80 text-slate-300 border-slate-700 hover:bg-slate-700'}`}
                                    >
                                        {showAdvancedFilters ? 'Hide Filters' : 'More Filters'}
                                    </button>
                                </div>
                            </div>

                            {/* Advanced Filters Drawer */}
                            {showAdvancedFilters && (
                                <div className="p-4 bg-slate-900/90 border border-slate-700/80 rounded-xl flex flex-wrap gap-6 items-end animate-fadeIn">
                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">OS Filter</label>
                                        <select
                                            className="block w-40 pl-3 pr-8 py-2 text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded-lg focus:ring-indigo-500"
                                            value={osFilter}
                                            onChange={(e) => setOsFilter(e.target.value)}
                                        >
                                            {availableOs.map(os => (
                                                <option key={os} value={os}>{os === 'all' ? 'Any OS' : os}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Min Cores</label>
                                        <input
                                            type="number"
                                            placeholder="e.g. 4"
                                            className="block w-36 px-3 py-2 text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded-lg focus:ring-indigo-500"
                                            value={minCpu}
                                            onChange={(e) => setMinCpu(e.target.value)}
                                        />
                                    </div>

                                    <div className="flex flex-col gap-1.5">
                                        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Min RAM (GB)</label>
                                        <input
                                            type="number"
                                            placeholder="e.g. 8"
                                            className="block w-36 px-3 py-2 text-xs bg-slate-800 border border-slate-700 text-slate-200 rounded-lg focus:ring-indigo-500"
                                            value={minRam}
                                            onChange={(e) => setMinRam(e.target.value)}
                                        />
                                    </div>

                                    <button
                                        onClick={() => { setOsFilter('all'); setMinCpu(''); setMinRam(''); }}
                                        className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold mb-2"
                                    >
                                        Clear Filters
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* EMPTY REDIS DATABASE VIEW PAGE */}
                        {hosts.length === 0 ? (
                            <div className="bg-slate-800/60 border border-slate-700/60 rounded-2xl p-8 sm:p-12 text-center shadow-xl space-y-6">
                                <div className="w-20 h-20 mx-auto rounded-3xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shadow-inner">
                                    <Database size={40} />
                                </div>

                                <div className="max-w-md mx-auto space-y-2">
                                    <h3 className="text-xl font-bold text-white tracking-tight">Redis Inventory is Empty</h3>
                                    <p className="text-sm text-slate-400 leading-relaxed">
                                        No edge nodes have registered with your Redsible API server yet. Edge nodes phone home automatically on boot or via cron.
                                    </p>
                                </div>

                                {/* Quick Copy Registration Instructions */}
                                <div className="max-w-2xl mx-auto bg-slate-950 border border-slate-800 rounded-xl p-4 text-left relative">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                            <Terminal size={14} className="text-indigo-400" /> Register Node via Curl
                                        </span>
                                        <button
                                            onClick={() => copyToClipboard(sampleCurlCommand)}
                                            className="text-xs text-indigo-400 hover:text-indigo-300 font-medium flex items-center gap-1"
                                        >
                                            {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                            {copied ? 'Copied!' : 'Copy Code'}
                                        </button>
                                    </div>
                                    <pre className="text-xs font-mono text-indigo-300 overflow-x-auto leading-relaxed p-1">
                                        {sampleCurlCommand}
                                    </pre>
                                </div>

                                <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
                                    <button
                                        onClick={loadDemoData}
                                        className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-lg shadow-indigo-600/20 active:scale-95"
                                    >
                                        Load Sample / Demo Nodes
                                    </button>
                                    <button
                                        onClick={fetchInventory}
                                        className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-bold transition-all"
                                    >
                                        Check Redis Again
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* INVENTORY NODES TABLE */
                            <div className="bg-slate-800/80 border border-slate-700/60 rounded-2xl overflow-hidden shadow-xl">
                                <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-700/60">
                                        <thead className="bg-slate-850">
                                            <tr>
                                                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Hostname (Click for Details)</th>
                                                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Network IP</th>
                                                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Hardware Specs</th>
                                                <th scope="col" className="px-6 py-4 text-left text-xs font-bold text-slate-400 uppercase tracking-wider">Ansible Groups</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-700/40 bg-slate-900/40">
                                            {filteredHosts.length === 0 ? (
                                                <tr>
                                                    <td colSpan="4" className="px-6 py-12 text-center text-slate-400 text-sm">
                                                        No inventory nodes match your search query or active filter.
                                                    </td>
                                                </tr>
                                            ) : (
                                                filteredHosts.map((host) => (
                                                    <tr
                                                        key={host.hostname}
                                                        onClick={() => setSelectedHost(host)}
                                                        className="hover:bg-indigo-600/10 cursor-pointer transition-colors group"
                                                    >
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <div className="flex items-center">
                                                                <div className="flex-shrink-0 h-10 w-10 flex items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 group-hover:scale-105 group-hover:bg-indigo-600 group-hover:text-white transition-all">
                                                                    <Server size={20} />
                                                                </div>
                                                                <div className="ml-4">
                                                                    <div className="text-sm font-bold text-slate-100 group-hover:text-indigo-300 transition-colors">
                                                                        {host.hostname}
                                                                    </div>
                                                                    <div className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                                                                        Active (Click to view full specs)
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <div className="flex items-center gap-1.5">
                                                                <Network size={14} className="text-slate-500" />
                                                                <span className="font-mono text-xs bg-slate-950 px-2.5 py-1 rounded-md text-indigo-300 border border-slate-800">
                                                                    {host.vars.ansible_host || 'N/A'}
                                                                </span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap">
                                                            <div className="text-sm text-slate-200 flex items-center gap-4">
                                                                <div className="flex items-center gap-1.5" title="OS">
                                                                    <HardDrive size={15} className="text-slate-400" />
                                                                    <span className="text-xs font-medium">{host.vars.os || 'Linux'} {host.vars.os_version || ''}</span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5" title="CPU & RAM">
                                                                    <Cpu size={15} className="text-slate-400" />
                                                                    <span className="text-xs text-slate-400 font-medium">
                                                                        {host.vars.cpus ? `${host.vars.cpus} vCPU` : ''}
                                                                        {host.vars.ram_mb ? ` • ${Math.round(host.vars.ram_mb / 1024)}GB` : ''}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex flex-wrap gap-1.5">
                                                                {host.groups.length > 0 ? (
                                                                    host.groups.map(group => (
                                                                        <span key={group} className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-indigo-500/10 text-indigo-300 border border-indigo-500/20">
                                                                            {group}
                                                                        </span>
                                                                    ))
                                                                ) : (
                                                                    <span className="text-xs text-slate-500 italic">Default</span>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
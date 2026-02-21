import React, { useEffect, useState } from 'react';
import { Clock, Plus, Trash2, Play, AlertCircle, Loader2 } from 'lucide-react';

interface ScheduledJob {
    id: string;
    name: string;
    schedule: string;
    instruction: string;
    tools?: string[];
    enabled: boolean;
    lastRun?: number;
    nextRun?: number;
}

export const SchedulerSettingsTab: React.FC = () => {
    const [jobs, setJobs] = useState<ScheduledJob[]>([]);
    const [loading, setLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);

    // Form state
    const [name, setName] = useState('');
    const [schedule, setSchedule] = useState('0 9 * * *');
    const [instruction, setInstruction] = useState('');

    const fetchJobs = async () => {
        setLoading(true);
        try {
            const resp = await fetch('/api/trustchain/scheduler/jobs');
            if (resp.ok) {
                const data = await resp.json();
                setJobs(data);
            }
        } catch (e) {
            console.error('Failed to fetch jobs', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchJobs();
    }, []);

    const handleCreateJob = async () => {
        if (!name || !schedule || !instruction) return;

        try {
            await fetch('/api/trustchain/scheduler/jobs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, schedule, instruction, enabled: true })
            });
            setIsCreating(false);
            setName('');
            setInstruction('');
            setSchedule('0 9 * * *');
            fetchJobs();
        } catch (e) {
            console.error(e);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this scheduled job?')) return;
        try {
            await fetch(`/api/trustchain/scheduler/jobs/${id}`, { method: 'DELETE' });
            fetchJobs();
        } catch (e) {
            console.error(e);
        }
    };

    const handleRunNow = async (id: string) => {
        try {
            await fetch(`/api/trustchain/scheduler/jobs/${id}/run`, { method: 'POST' });
            alert('Job started in the background!');
            fetchJobs();
        } catch (e) {
            console.error(e);
            alert('Failed to start job.');
        }
    };

    const formatDate = (ts?: number) => {
        if (!ts) return 'Never';
        return new Date(ts).toLocaleString();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center h-48">
                <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between mb-2">
                <div>
                    <h4 className="text-sm font-semibold tc-text-heading">Cron Scheduler</h4>
                    <p className="text-[11px] tc-text-muted">Automated background tasks run autonomously by the sub-agent swarm.</p>
                </div>
                <button
                    onClick={() => setIsCreating(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 rounded-lg transition-colors"
                >
                    <Plus size={14} /> New Job
                </button>
            </div>

            {isCreating && (
                <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 space-y-3 mb-4">
                    <h5 className="text-xs font-semibold text-slate-200">Create Scheduled Task</h5>
                    <div>
                        <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">Job Name</label>
                        <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Daily Sync" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500" />
                    </div>
                    <div>
                        <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">Cron Schedule</label>
                        <input value={schedule} onChange={e => setSchedule(e.target.value)} placeholder="0 9 * * *" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 font-mono" />
                    </div>
                    <div>
                        <label className="block text-[10px] text-slate-400 mb-1 uppercase tracking-wider">System Instruction</label>
                        <textarea value={instruction} onChange={e => setInstruction(e.target.value)} placeholder="What should the agent do?" className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 resize-y h-20" />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-2">
                        <button onClick={() => setIsCreating(false)} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
                        <button onClick={handleCreateJob} className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg">Save Job</button>
                    </div>
                </div>
            )}

            {jobs.length === 0 && !isCreating ? (
                <div className="flex flex-col items-center justify-center p-8 border border-dashed border-slate-700/50 rounded-xl">
                    <Clock size={24} className="text-slate-500 mb-2" />
                    <span className="text-sm font-semibold text-slate-300">No scheduled tasks</span>
                    <span className="text-[11px] text-slate-500 text-center mt-1">
                        Create a job to automate routine workflows.<br />
                        Jobs run securely in the background using the active LLM.
                    </span>
                </div>
            ) : (
                <div className="space-y-2">
                    {jobs.map(job => (
                        <div key={job.id} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-3 flex flex-col gap-2">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Clock size={14} className="text-emerald-400" />
                                    <span className="text-sm font-semibold text-slate-200">{job.name}</span>
                                    <span className="px-2 py-0.5 roundedbg-slate-900 border border-slate-700 text-[10px] font-mono text-slate-400 rounded-md bg-slate-900">{job.schedule}</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button onClick={() => handleRunNow(job.id)} className="p-1.5 text-blue-400 hover:bg-blue-400/10 rounded-lg" title="Run Now">
                                        <Play size={14} />
                                    </button>
                                    <button onClick={() => handleDelete(job.id)} className="p-1.5 text-red-400 hover:bg-red-400/10 rounded-lg" title="Delete">
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            <div className="text-xs text-slate-400 line-clamp-2 bg-slate-900/50 p-2 rounded-lg border border-slate-800/50">
                                {job.instruction}
                            </div>

                            <div className="flex items-center gap-4 mt-1 text-[10px] text-slate-500">
                                <span>Last Run: <span className="text-slate-300">{formatDate(job.lastRun)}</span></span>
                                <span>Next Run: <span className="text-slate-300">{formatDate(job.nextRun)}</span></span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

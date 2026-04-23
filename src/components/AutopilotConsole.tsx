import React, { useState, useEffect, useRef } from 'react';
import { Simulation } from '../lib/Simulation';
import { motion } from 'motion/react';
import { X } from 'lucide-react';

interface AutopilotConsoleProps {
  sim: Simulation;
  logs: {time: number, msg: string}[];
  onAddLog?: (msg: string) => void;
  onClose: () => void;
}

export const AutopilotConsole: React.FC<AutopilotConsoleProps> = ({ sim, logs, onAddLog, onClose }) => {
  const [script, setScript] = useState(sim.currentScript);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const [, forceUpdate] = useState({});

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Sync state with simulation
  useEffect(() => {
    const interval = setInterval(() => {
        setIsRunning(sim.isAutopilotActive);
        if (sim.currentScript !== script && !isRunning) {
            setScript(sim.currentScript);
        }
        forceUpdate({});
    }, 100);
    return () => clearInterval(interval);
  }, [sim, script, isRunning]);

  const onScriptChange = (newVal: string) => {
    setScript(newVal);
    sim.currentScript = newVal;
  };

  const toggleAutopilot = () => {
    if (isRunning) {
      sim.stopAutopilot();
      onAddLog?.("Autopilot stopped.");
    } else {
      try {
        sim.startAutopilot(script, (msg) => onAddLog?.(msg));
        setError(null);
        onAddLog?.("Autopilot engaged.");
      } catch (err: any) {
        setError(err.message);
      }
    }
  };

  const launchTarget = sim.targetLaunchTime;
  const launchEpoch  = sim.launchEpoch;
  const isCountdown  = launchTarget !== null && sim.missionTime < launchTarget;
  const displayTime  = launchTarget !== null
    ? sim.missionTime - launchTarget
    : launchEpoch !== null
      ? sim.missionTime - launchEpoch
      : sim.missionTime;
  const formattedTime = displayTime < 0 ? Math.ceil(Math.abs(displayTime)) : Math.floor(Math.abs(displayTime));

  return (
    <motion.aside 
        initial={{ x: 340, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 340, opacity: 0 }}
        transition={{ type: "spring", damping: 25, stiffness: 200 }}
        className="fixed top-10 right-10 bottom-32 w-[340px] bg-[#11141b]/45 backdrop-blur-xl border border-white/10 flex flex-col overflow-hidden rounded-2xl shadow-2xl z-[60] p-6 gap-6 will-change-transform"
    >
        <button 
            onClick={onClose}
            className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
        >
            <X size={16} />
        </button>

        <section className="flex flex-col gap-6 h-full overflow-hidden">
            <div>
                <div className="text-[10px] uppercase tracking-[2px] text-gray-500 mb-1 font-bold">SYSTEM DATA // FLIGHT CONTROL</div>
                <div className="flex items-center justify-between">
                  <div className="text-emerald-500 font-extrabold text-[12px] uppercase">Autopilot Terminal</div>
                  {isRunning && (
                    <div className="flex items-center gap-2 mr-8">
                      {isCountdown && (
                        <button
                          onClick={() => {
                            const diff = sim.targetLaunchTime! - sim.missionTime;
                            sim.missionTime += diff;
                            onAddLog?.(`Time warp: Skipped ${diff.toFixed(1)}s to T-0`);
                          }}
                          className="text-[8px] bg-orange-500/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded hover:bg-orange-500/30 transition-colors uppercase font-bold tracking-wider whitespace-nowrap"
                        >
                          Launch Now
                        </button>
                      )}
                      <div className="text-[11px] text-blue-400 font-mono bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/20">
                        T{displayTime < 0 ? '-' : '+'}{formattedTime}s
                      </div>
                    </div>
                  )}
                </div>
            </div>

            {/* Script Editor Section */}
            <div className="flex flex-col flex-1 min-h-0 gap-2">
                <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Mission Script</span>
                    {error && <span className="text-[10px] text-red-400 font-bold animate-pulse truncate max-w-[150px]">{error}</span>}
                </div>
                <textarea
                    value={script}
                    onChange={(e) => onScriptChange(e.target.value)}
                    className="flex-1 bg-black/40 border border-white/5 rounded-xl p-3 text-emerald-400 focus:outline-none focus:border-blue-500/50 resize-none font-mono text-[10px] leading-relaxed scrollbar-thin scrollbar-thumb-white/10"
                    spellCheck={false}
                />
            </div>

            {/* Control Button */}
            <button 
                onClick={toggleAutopilot}
                className={`w-full py-3 rounded-xl text-[12px] font-bold tracking-widest transition-all transform active:scale-95 shadow-lg ${
                    isRunning 
                        ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30' 
                        : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/30'
                }`}
            >
                {isRunning ? 'DISENGAGE' : 'ENGAGE SYSTEMS'}
            </button>

            {/* Telemetry Log Section */}
            <div className="flex flex-col h-48 gap-2">
                <span className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Telemetry Log</span>
                <div className="flex-1 bg-black/60 border border-white/5 rounded-xl p-3 font-mono text-[10px] overflow-y-auto scrollbar-thin scrollbar-thumb-white/10">
                    {logs.length === 0 && <div className="text-slate-700 italic">No telemetry data...</div>}
                    {logs.map((log, i) => (
                        <div key={i} className="flex gap-2 border-b border-white/5 pb-1 mb-1 last:border-0 last:mb-0">
                            <span className="text-slate-600 shrink-0">[{log.time.toFixed(1)}s]</span>
                            <span className={log.msg.includes('Error') ? 'text-red-400' : 'text-slate-300'}>{log.msg}</span>
                        </div>
                    ))}
                    <div ref={logEndRef} />
                </div>
            </div>
        </section>
    </motion.aside>
  );
};

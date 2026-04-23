import React, { useEffect, useState, useRef } from 'react';
import { Simulation } from '../lib/Simulation';
import { motion, AnimatePresence } from 'motion/react';
import { Rocket, Play, Square, Terminal, Target } from 'lucide-react';

interface VehicleFleetHUDProps {
  sim: Simulation;
}

export const VehicleFleetHUD: React.FC<VehicleFleetHUDProps> = ({ sim }) => {
  const [vehicles, setVehicles] = useState<any[]>([]);
  const [, setTick] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollInfo, setScrollInfo] = useState({ left: 0, width: 0, clientWidth: 0 });

  const updateScrollInfo = () => {
    if (!scrollRef.current) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
    setScrollInfo({ left: scrollLeft, width: scrollWidth, clientWidth });
  };

  useEffect(() => {
    const interval = setInterval(() => {
      const vList = sim.bodies.filter(b =>
        (b as any).type === 'rocket' ||
        (b as any).type === 'heatProtectedRocket' ||
        (b as any).script
      );
      setVehicles([...vList]);
      setTick(t => t + 1);
      updateScrollInfo();
    }, 200);
    return () => clearInterval(interval);
  }, [sim]);

  const fmtTime = (seconds: number) => {
    const neg = seconds < 0;
    const absS = Math.floor(Math.abs(seconds));
    const h = Math.floor(absS / 3600);
    const m = Math.floor((absS % 3600) / 60);
    const s = absS % 60;
    const prefix = neg ? 'T-' : 'T+';
    return `${prefix}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // Calculate dynamic fade percentages based on 10vw (10% of clientWidth)
  const scrollThreshold = scrollInfo.clientWidth * 0.1; // 10vw equivalent

  const leftFadePercent = scrollThreshold > 0
    ? Math.min((scrollInfo.left / scrollThreshold) * 10, 10)
    : 0;

  const remainingRight = scrollInfo.width - scrollInfo.clientWidth - scrollInfo.left;
  const rightFadePercent = scrollThreshold > 0
    ? Math.min((remainingRight / scrollThreshold) * 10, 10)
    : 0;

  const getMaskImage = () => {
    const leftPart = leftFadePercent > 0 ? `transparent 0%, black ${leftFadePercent}%` : `black 0%`;
    const rightPart = rightFadePercent > 0 ? `black ${100 - rightFadePercent}%, transparent 100%` : `black 100%`;
    return `linear-gradient(to right, ${leftPart}, ${rightPart})`;
  };

  if (vehicles.length === 0) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] pointer-events-none pt-4 h-48 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={updateScrollInfo}
        className="flex gap-3 overflow-x-auto no-scrollbar pb-24 pt-2 px-8 pointer-events-auto"
        style={{
          maskImage: getMaskImage(),
          WebkitMaskImage: getMaskImage(),
        }}
      >
        <AnimatePresence mode="popLayout">
          {vehicles.map((v, index) => {
            const isRunning = !!v.isAutopilotActive;
            const missionTime = sim.missionTime;
            const launchRef = v.launchEpoch !== undefined ? v.launchEpoch : (v.targetLaunchTime || 0);
            const tTime = missionTime - launchRef;
            const isCountdown = v.launchEpoch === undefined && missionTime < (v.targetLaunchTime || 0);
            const isFollowed = sim.camera.followingId === v.id;

            // Card position logic
            const cardWidth = 170;
            const cardGap = 12;
            const paddingLeft = 32; // matching px-8
            const cardX = paddingLeft + index * (cardWidth + cardGap);
            const cardCenter = cardX + cardWidth / 2;
            const relativeX = cardCenter - scrollInfo.left;

            const leftThreshold = (leftFadePercent / 100) * scrollInfo.clientWidth;
            const rightThreshold = (rightFadePercent / 100) * scrollInfo.clientWidth;

            let effectFactor = 1;
            if (leftThreshold > 0 && relativeX < leftThreshold) {
              effectFactor = Math.max(0, relativeX / leftThreshold);
            } else if (rightThreshold > 0 && relativeX > scrollInfo.clientWidth - rightThreshold) {
              effectFactor = Math.max(0, (scrollInfo.clientWidth - relativeX) / rightThreshold);
            }

            const scale = 0.8 + (0.2 * effectFactor);
            const blur = (1 - effectFactor) * 5;

            return (
              <motion.div
                key={v.id}
                layout
                initial={{ opacity: 0, scale: 0.9, x: -20 }}
                animate={{
                  opacity: 1,
                  scale,
                  x: 0,
                  backdropFilter: `blur(${blur}px)`
                }}
                transition={{
                  default: { duration: 0 }
                }} exit={{ opacity: 0, scale: 0.5, x: -20 }}
                className={`group relative flex items-center gap-3 px-4 h-12 bg-[#0c1016]/80 backdrop-blur-xl border ${isFollowed ? 'border-sky-500/50 shadow-[0_0_15px_rgba(14,165,233,0.2)]' : 'border-white/10'} rounded-xl cursor-pointer hover:bg-white/5 min-w-[170px] shrink-0 shadow-[0_8px_32px_rgba(0,0,0,0.4)]`}
                onClick={() => {
                  sim.camera.followingId = v.id;
                }}
              >
                {/* Vehicle Icon */}
                <div className="relative">
                  <Rocket
                    size={16}
                    className={isRunning ? 'text-emerald-400 animate-pulse' : 'text-gray-500'}
                  />
                  {isRunning && (
                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                  )}
                </div>

                {/* Info */}
                <div className="flex flex-col gap-0 min-w-0">
                  <span className="text-[10px] font-bold text-gray-200 uppercase tracking-widest truncate w-full">
                    {v.name}
                  </span>
                  <span className={`text-[10px] font-mono font-bold ${isCountdown ? 'text-amber-400' : isRunning ? 'text-blue-400' : 'text-gray-500'}`}>
                    {isRunning || v.targetLaunchTime ? fmtTime(tTime) : 'STANDBY'}
                  </span>
                </div>

                {/* ACTION MENU CONTAINER */}
                <div className="absolute top-10 left-0 right-0 h-12 bg-transparent" />

                <div className="absolute -bottom-[52px] left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 flex justify-center transition-all duration-300 pointer-events-none group-hover:pointer-events-auto translate-y-2 group-hover:translate-y-0 z-50">
                  <div className="bg-[#11141b]/95 backdrop-blur-2xl border border-white/20 rounded-xl p-1.5 flex gap-1.5 shadow-[0_20px_50px_rgba(0,0,0,0.7)]">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isRunning) sim.stopAutopilot(v.id);
                        else {
                          if (v.script) {
                            sim.startAutopilot(v.script, v.id, (msg) => {
                              (window as any)._logBuffer = (window as any)._logBuffer || [];
                              (window as any)._logBuffer.push({ time: sim.missionTime, msg });
                            });
                          }
                        }
                      }}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-200 ${isRunning ? 'bg-red-500/20 text-red-400 hover:bg-red-500/40' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40'}`}
                    >
                      {isRunning ? <Square size={12} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(`/?editor=${v.id}`, `Editor_${v.id}`, 'width=800,height=600,left=200,top=100');
                      }}
                      className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/15 transition-all text-white"
                    >
                      <Terminal size={14} />
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        sim.camera.followingId = v.id;
                      }}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all ${isFollowed ? 'bg-sky-500/20 text-sky-400' : 'bg-white/5 text-white/40 hover:bg-white/15'}`}
                    >
                      <Target size={14} />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

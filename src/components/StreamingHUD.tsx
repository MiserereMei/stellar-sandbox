import React, { useState, useEffect, useRef } from 'react';
import { Simulation } from '../lib/Simulation';
import { motion, AnimatePresence } from 'motion/react';

// Sim units → metres conversion (Earth radius = 6.371e6 m)
const EARTH_RADIUS_M = 6.371e6;
const SIM_TO_M = EARTH_RADIUS_M; // 1 sim unit = 1 Earth radius

function fmtAlt(simUnits: number): string {
  const m = simUnits * SIM_TO_M;
  if (m >= 1e6) return (m / 1e3).toFixed(1) + ' km';
  return m.toFixed(0) + ' m';
}

function fmtSpeed(simUnits: number): string {
  const ms = simUnits * SIM_TO_M;
  if (ms >= 1000) return (ms / 1000).toFixed(2) + ' km/s';
  return ms.toFixed(1) + ' m/s';
}

function fmtTime(seconds: number): string {
  const s = Math.floor(Math.abs(seconds));
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return `T+${String(h).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

interface StatBlockProps {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
}
const StatBlock: React.FC<StatBlockProps> = ({ label, value, unit, accent = '#32d2ff' }) => (
  <div className="flex flex-col gap-0.5">
    <span className="text-[9px] uppercase tracking-[2px] font-bold" style={{ color: accent + 'aa' }}>{label}</span>
    <div className="flex items-baseline gap-1">
      <span className="font-mono text-[22px] font-bold leading-none text-white">{value}</span>
      {unit && <span className="font-mono text-[10px]" style={{ color: accent + 'aa' }}>{unit}</span>}
    </div>
  </div>
);

interface StreamingHUDProps {
  sim: Simulation;
  isStreaming: boolean;
  autopilotLogs: { time: number; msg: string }[];
}

export const StreamingHUD: React.FC<StreamingHUDProps> = ({ sim, isStreaming, autopilotLogs }) => {
  const [tick, setTick] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isStreaming) return;
    const id = setInterval(() => setTick(t => t + 1), 150);
    return () => clearInterval(id);
  }, [isStreaming]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [autopilotLogs]);

  if (!isStreaming) return null;

  const alt    = sim.vehicle ? sim.getAltitude() : null;
  const vspeed = sim.vehicle ? sim.getRadialSpeed() : null;
  const hspeed = sim.vehicle ? sim.getTangentialSpeed() : null;
  const speed  = sim.vehicle ? sim.getRelativeSpeed() : null;
  const dom    = sim.vehicle ? sim.getDominantBody(sim.vehicle.position) : null;

  const rotation = sim.vehicle ? ((sim.vehicle as any).rotation ?? 0) : 0;
  const headingDeg = ((rotation * 180 / Math.PI) + 90 + 360) % 360;

  const thrustOn = sim.vehicle && (sim.vehicle as any).thrusting;

  return (
    <AnimatePresence>
      {isStreaming && (
        <motion.div
          key="streaming-hud"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.6 }}
          className="fixed inset-0 z-[200] pointer-events-none select-none"
          style={{ fontFamily: "'JetBrains Mono', 'Fira Code', 'Courier New', monospace" }}
        >
          {/* Cinematic bars */}
          <div className="absolute top-0 left-0 right-0 h-12 bg-black/70" />
          <div className="absolute bottom-0 left-0 right-0 h-14 bg-black/70" />

          {/* Corner scan-line effect */}
          <div className="absolute inset-0" style={{
            background: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,200,255,0.015) 3px, rgba(0,200,255,0.015) 4px)',
            pointerEvents: 'none'
          }} />

          {/* TOP BAR */}
          <div className="absolute top-0 left-0 right-0 h-12 flex items-center justify-between px-8">
            {/* Mission clock */}
            <div className="flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 text-[11px] font-bold tracking-[3px] uppercase">STREAMING</span>
              <span className="text-white/40 text-[11px] tracking-widest ml-2">{fmtTime(sim.missionTime)}</span>
            </div>

            {/* Vehicle name */}
            <span className="text-white/60 text-[11px] tracking-[2px] uppercase">
              {sim.vehicle?.name ?? 'No Vehicle'}
            </span>

            {/* Date */}
            <span className="text-white/40 text-[11px] tracking-wider">
              {sim.getCurrentDate().toUTCString().slice(0, 25)}
            </span>
          </div>

          {/* BOTTOM FLIGHT DATA STRIP */}
          <div className="absolute bottom-0 left-0 right-0 h-14 flex items-center justify-between px-8">
            {/* Altitude */}
            <StatBlock
              label="Altitude"
              value={alt !== null ? (alt * SIM_TO_M >= 1e6 ? (alt * SIM_TO_M / 1000).toFixed(1) : (alt * SIM_TO_M).toFixed(0)) : '—'}
              unit={alt !== null ? (alt * SIM_TO_M >= 1e6 ? 'km' : 'm') : ''}
              accent="#32d2ff"
            />

            {/* Vertical speed */}
            <StatBlock
              label="Vert. Speed"
              value={vspeed !== null ? (vspeed >= 0 ? '+' : '') + fmtSpeed(Math.abs(vspeed)).split(' ')[0] : '—'}
              unit={vspeed !== null ? (Math.abs(vspeed) * SIM_TO_M >= 1000 ? 'km/s' : 'm/s') : ''}
              accent={vspeed !== null && vspeed >= 0 ? '#4ade80' : '#f87171'}
            />

            {/* Horizontal speed */}
            <StatBlock
              label="Horiz. Speed"
              value={hspeed !== null ? fmtSpeed(hspeed).split(' ')[0] : '—'}
              unit={hspeed !== null ? (hspeed * SIM_TO_M >= 1000 ? 'km/s' : 'm/s') : ''}
              accent="#a78bfa"
            />

            {/* Heading */}
            <StatBlock label="Heading" value={headingDeg.toFixed(0)} unit="°" accent="#fbbf24" />

            {/* Dominant body */}
            <StatBlock label="SOI Body" value={dom?.name ?? '—'} accent="#fb923c" />

            {/* Thrust indicator */}
            <div className="flex flex-col gap-0.5 items-end">
              <span className="text-[9px] uppercase tracking-[2px] font-bold text-white/40">Thrust</span>
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${thrustOn ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/10 bg-white/5'}`}>
                {thrustOn && <div className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />}
                <span className={`font-mono text-[11px] font-bold ${thrustOn ? 'text-emerald-400' : 'text-white/30'}`}>
                  {thrustOn ? 'ACTIVE' : 'OFF'}
                </span>
              </div>
            </div>

            {/* Autopilot */}
            <div className="flex flex-col gap-0.5 items-end">
              <span className="text-[9px] uppercase tracking-[2px] font-bold text-white/40">Autopilot</span>
              <div className={`flex items-center gap-2 px-3 py-1 rounded-full border ${sim.isAutopilotActive ? 'border-sky-400/40 bg-sky-400/10' : 'border-white/10 bg-white/5'}`}>
                {sim.isAutopilotActive && <div className="w-1 h-1 rounded-full bg-sky-400 animate-pulse" />}
                <span className={`font-mono text-[11px] font-bold ${sim.isAutopilotActive ? 'text-sky-400' : 'text-white/30'}`}>
                  {sim.isAutopilotActive ? 'ENGAGED' : 'STANDBY'}
                </span>
              </div>
            </div>
          </div>

          {/* AUTOPILOT LOG PANEL — bottom left, above the bar */}
          {autopilotLogs.length > 0 && (
            <div className="absolute bottom-16 left-8 w-[360px] max-h-[200px] overflow-hidden flex flex-col">
              <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maskImage: 'linear-gradient(to bottom, transparent, black 20%)' }}>
                {autopilotLogs.slice(-12).map((log, i) => (
                  <div key={i} className="flex gap-2 items-baseline">
                    <span className="text-[9px] text-sky-400/50 shrink-0 font-mono">[{fmtTime(log.time)}]</span>
                    <span className="text-[10px] text-white/70 font-mono leading-relaxed">{log.msg}</span>
                  </div>
                ))}
                <div ref={logsEndRef} />
              </div>
            </div>
          )}


        </motion.div>
      )}
    </AnimatePresence>
  );
};

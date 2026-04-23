import React, { useState, useEffect, useMemo } from 'react';
import { Simulation } from '../lib/Simulation';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Layers, 
  Search, 
  X, 
  Rocket, 
  Sun, 
  Globe, 
  Circle, 
  Play, 
  Square,
  Crosshair,
  ChevronDown,
  ChevronRight
} from 'lucide-react';

interface OutlinerProps {
  sim: Simulation;
  isVisible: boolean;
  onClose: () => void;
  onSelectBody: (id: string | null) => void;
  selectedBodyId: string | null;
}

export const Outliner: React.FC<OutlinerProps> = ({ 
  sim, 
  isVisible, 
  onClose, 
  onSelectBody,
  selectedBodyId 
}) => {
  const [search, setSearch] = useState('');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    'star': true,
    'planet': true,
    'rocket': true,
    'other': true
  });
  const [, setTick] = useState(0);

  // Force update occasionally to sync state (like autopilot status)
  useEffect(() => {
    const interval = setInterval(() => setTick(t => t + 1), 500);
    return () => clearInterval(interval);
  }, []);

  const bodies = sim.bodies;

  const filteredGroups = useMemo(() => {
    const groups: Record<string, any[]> = {
      'star': [],
      'planet': [],
      'rocket': [],
      'other': []
    };

    bodies.forEach(b => {
      if (search && !b.name.toLowerCase().includes(search.toLowerCase())) return;

      const isRocket = (b as any).type?.includes('rocket');
      const isMassive = sim.isBodyBlackHole(b) || sim.isStar(b) || b.mass > 10000;
      
      if (isRocket) groups['rocket'].push(b);
      else if (isMassive) groups['star'].push(b);
      else groups['planet'].push(b);
    });

    return groups;
  }, [bodies, search]);

  const toggleGroup = (group: string) => {
    setExpandedGroups(prev => ({ ...prev, [group]: !prev[group] }));
  };

  const handleFocus = (body: any) => {
    sim.camera.followingId = body.id;
    onSelectBody(body.id);
  };

  const renderBodyItem = (b: any) => {
    const isSelected = selectedBodyId === b.id;
    const isRocket = b.type?.includes('rocket');
    const isActive = !!b.isAutopilotActive;

    return (
      <div 
        key={b.id}
        className={`group flex items-center justify-between px-3 py-2 rounded-lg transition-all cursor-pointer border ${
          isSelected 
            ? 'bg-blue-500/20 border-blue-500/40 text-blue-400' 
            : 'hover:bg-white/5 border-transparent text-gray-400 hover:text-white'
        }`}
        onClick={() => onSelectBody(b.id)}
      >
        <div className="flex items-center gap-3 overflow-hidden">
          <div 
            className="w-2 h-2 rounded-full shrink-0 shadow-[0_0_8px_rgba(255,255,255,0.3)]" 
            style={{ backgroundColor: b.type === 'blackhole' ? '#000' : (b as any).color || '#fff' }}
          />
          <span className="text-[11px] font-medium truncate tracking-tight">{b.name}</span>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {isRocket && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isActive) {
                  sim.stopAutopilot(b.id);
                } else if (b.script) {
                  sim.startAutopilot(b.script, b.id, () => {});
                } else {
                  window.open(`/?editor=${b.id}`, `Editor_${b.id}`, 'width=800,height=600');
                }
              }}
              className={`p-1.5 rounded-md transition-colors ${
                isActive ? 'bg-red-500/20 text-red-400 hover:bg-red-500/40' : 'bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/40'
              }`}
            >
              {isActive ? <Square size={10} fill="currentColor" /> : <Play size={10} fill="currentColor" />}
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleFocus(b);
            }}
            title="Focus Camera"
            className="p-1.5 rounded-md bg-white/5 text-gray-500 hover:bg-white/10 hover:text-white transition-colors"
          >
            <Crosshair size={12} />
          </button>
        </div>
      </div>
    );
  };

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          initial={{ x: -300, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: -300, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 200 }}
          className="fixed left-4 top-4 bottom-20 w-72 bg-[#11141b]/25 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl flex flex-col z-[40] overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-blue-400" />
              <span className="text-[10px] font-bold uppercase tracking-[2px] text-gray-400">Outliner</span>
            </div>
            <button 
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Search */}
          <div className="p-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600" size={14} />
              <input 
                type="text"
                placeholder="Search entities..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-black/40 border border-white/5 rounded-xl py-2.5 pl-9 pr-4 text-[12px] font-mono text-white outline-none focus:border-blue-500/50 transition-all placeholder:text-gray-600"
              />
            </div>
          </div>

          {/* List Container */}
          <div className="flex-1 overflow-y-auto no-scrollbar px-2 pb-4 space-y-4">
            {(Object.entries(filteredGroups) as [string, any[]][]).map(([group, members]) => {
              if (members.length === 0 && search) return null;
              const isExpanded = expandedGroups[group];
              const label = group === 'star' ? 'Stars & Massive' 
                          : group === 'planet' ? 'Celestial Bodies' 
                          : group === 'rocket' ? 'Mission Fleet' 
                          : 'Others';
              const Icon = group === 'star' ? Sun 
                         : group === 'planet' ? Globe 
                         : group === 'rocket' ? Rocket 
                         : Circle;

              return (
                <div key={group} className="space-y-1">
                  <button 
                    onClick={() => toggleGroup(group)}
                    className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-white/5 rounded-lg transition-colors group"
                  >
                    <div className="flex items-center gap-2">
                      <Icon size={12} className="text-gray-600 group-hover:text-blue-400 transition-colors" />
                      <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500 group-hover:text-gray-300">{label}</span>
                      <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/5 text-gray-600 font-mono">
                        {members.length}
                      </span>
                    </div>
                    {isExpanded ? <ChevronDown size={12} className="text-gray-700" /> : <ChevronRight size={12} className="text-gray-700" />}
                  </button>

                  <AnimatePresence initial={false}>
                    {isExpanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="overflow-hidden space-y-0.5"
                      >
                        {members.length > 0 ? (
                          members.map(renderBodyItem)
                        ) : (
                          <div className="px-8 py-2 text-[10px] text-gray-700 italic">No entities found</div>
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>

          {/* Footer Stats */}
          <div className="px-4 py-3 bg-white/5 border-t border-white/5">
            <div className="flex justify-between items-center text-[9px] font-bold text-gray-600 uppercase tracking-tight">
              <span>Total Entities</span>
              <span className="text-blue-400 font-mono">{bodies.length}</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
